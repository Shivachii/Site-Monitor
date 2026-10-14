import { hostname } from "node:os";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { checkHttpEndpoint } from "./http-check.mjs";
import { sendNotification } from "./notifications.mjs";

const workerVersion = "1.0.0";
const startedAt = new Date().toISOString();
let stopping = false;

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return value;
}

function readConfiguration() {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is required.",
    );
  }

  return {
    supabaseUrl,
    secretKey,
    workerId: (
      process.env.MONITOR_WORKER_ID ?? `${hostname()}-${process.pid}`
    ).slice(0, 120),
    batchSize: readInteger("MONITOR_BATCH_SIZE", 25, 1, 100),
    concurrency: readInteger("MONITOR_CONCURRENCY", 5, 1, 25),
    pollIntervalMs: readInteger(
      "MONITOR_POLL_INTERVAL_MS",
      5_000,
      1_000,
      60_000,
    ),
    leaseSeconds: readInteger("MONITOR_LEASE_SECONDS", 45, 15, 300),
    heartbeatIntervalMs: readInteger(
      "MONITOR_HEARTBEAT_INTERVAL_MS",
      30_000,
      5_000,
      300_000,
    ),
    notificationBatchSize: readInteger("NOTIFICATION_BATCH_SIZE", 10, 1, 100),
    notificationConcurrency: readInteger("NOTIFICATION_CONCURRENCY", 3, 1, 10),
    retentionDays: readInteger("CHECK_RESULT_RETENTION_DAYS", 30, 7, 365),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWithConcurrency(items, concurrency, task) {
  let cursor = 0;

  async function consume() {
    while (!stopping) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, consume),
  );
}

async function main() {
  const config = readConfiguration();
  const supabase = createClient(config.supabaseUrl, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function heartbeat() {
    const { error } = await supabase.rpc("record_worker_heartbeat", {
      p_worker_id: config.workerId,
      p_version: workerVersion,
      p_started_at: startedAt,
      p_metadata: {
        runtime: process.version,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
        notificationConcurrency: config.notificationConcurrency,
      },
    });

    if (error) throw new Error(`Heartbeat failed: ${error.message}`);
  }

  async function checkMonitor(monitor) {
    const result = await checkHttpEndpoint({
      url: monitor.url,
      timeoutMs: monitor.timeout_ms,
      expectedStatusCodes: monitor.expected_status_codes,
    });

    const { error } = await supabase.rpc("record_monitor_check", {
      p_worker_id: config.workerId,
      p_monitor_id: monitor.id,
      p_checked_at: result.checkedAt,
      p_completed_at: result.completedAt,
      p_outcome: result.outcome,
      p_http_status_code: result.httpStatusCode,
      p_response_time_ms: result.responseTimeMs,
      p_error_type: result.errorType,
      p_error_message: result.errorMessage,
      p_redirect_count: result.redirectCount,
    });

    if (error) {
      console.error(
        `[${monitor.name}] Could not save result: ${error.message}`,
      );
      return;
    }

    const status = result.outcome === "success" ? "active" : "failed";
    console.log(
      `[${monitor.name}] ${status} (${result.httpStatusCode ?? result.errorType}, ${result.responseTimeMs}ms)`,
    );
  }

  async function deliverNotification(delivery) {
    let succeeded = false;
    let errorMessage = null;

    try {
      await sendNotification(delivery);
      succeeded = true;
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Unknown notification error.";
    }

    const { error } = await supabase.rpc("record_notification_delivery", {
      p_worker_id: config.workerId,
      p_delivery_id: delivery.id,
      p_success: succeeded,
      p_error_message: errorMessage,
    });

    if (error) {
      console.error(
        `[notification ${delivery.id}] Could not save result: ${error.message}`,
      );
      return;
    }

    console.log(
      `[notification ${delivery.id}] ${succeeded ? "sent" : `failed: ${errorMessage}`}`,
    );
  }

  let nextHeartbeatAt = 0;
  let nextRetentionAt = 0;
  console.log(`Worker ${config.workerId} started; HTTP/HTTPS checks enabled.`);

  while (!stopping) {
    try {
      if (Date.now() >= nextHeartbeatAt) {
        await heartbeat();
        nextHeartbeatAt = Date.now() + config.heartbeatIntervalMs;
      }

      if (Date.now() >= nextRetentionAt) {
        const { data: deletedCount, error: retentionError } =
          await supabase.rpc("prune_check_results", {
            p_retention_days: config.retentionDays,
          });
        if (retentionError) {
          throw new Error(`Result retention failed: ${retentionError.message}`);
        }
        if (deletedCount > 0) {
          console.log(`Pruned ${deletedCount} expired check results.`);
        }
        nextRetentionAt = Date.now() + 24 * 60 * 60 * 1000;
      }

      const { data, error } = await supabase.rpc("claim_due_monitors", {
        p_worker_id: config.workerId,
        p_batch_size: config.batchSize,
        p_lease_seconds: config.leaseSeconds,
      });

      if (error) throw new Error(`Monitor claim failed: ${error.message}`);

      const monitors = data ?? [];
      if (monitors.length > 0) {
        await runWithConcurrency(monitors, config.concurrency, checkMonitor);
      }

      const { data: deliveries, error: notificationClaimError } =
        await supabase.rpc("claim_notification_deliveries", {
          p_worker_id: config.workerId,
          p_batch_size: config.notificationBatchSize,
          p_lease_seconds: config.leaseSeconds,
        });

      if (notificationClaimError) {
        throw new Error(
          `Notification claim failed: ${notificationClaimError.message}`,
        );
      }

      if ((deliveries ?? []).length > 0) {
        await runWithConcurrency(
          deliveries,
          config.notificationConcurrency,
          deliverNotification,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }

    if (!stopping) await wait(config.pollIntervalMs);
  }

  console.log(`Worker ${config.workerId} stopped.`);
}

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
