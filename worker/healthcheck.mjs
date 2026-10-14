import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const maximumAgeMs = Number.parseInt(
  process.env.MONITOR_HEALTH_MAX_AGE_MS ?? "90000",
  10,
);
const workerId = process.env.MONITOR_WORKER_ID;

if (!supabaseUrl || !secretKey) {
  console.error("Worker healthcheck is missing Supabase configuration.");
  process.exit(1);
}

if (!Number.isInteger(maximumAgeMs) || maximumAgeMs < 10_000) {
  console.error("MONITOR_HEALTH_MAX_AGE_MS must be at least 10000.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
let heartbeatQuery = supabase
  .from("worker_heartbeats")
  .select("worker_id, heartbeat_at")
  .order("heartbeat_at", { ascending: false });

if (workerId) {
  heartbeatQuery = heartbeatQuery.eq("worker_id", workerId);
}

const { data, error } = await heartbeatQuery.limit(1).maybeSingle();

if (error) {
  console.error(`Worker heartbeat query failed: ${error.message}`);
  process.exit(1);
}

if (!data) {
  console.error(
    workerId
      ? `No heartbeat has been recorded for ${workerId}.`
      : "No worker heartbeat has been recorded.",
  );
  process.exit(1);
}

const ageMs = Date.now() - new Date(data.heartbeat_at).getTime();
if (!Number.isFinite(ageMs) || ageMs > maximumAgeMs) {
  console.error(
    `Latest worker heartbeat is stale (${Math.round(ageMs / 1000)}s).`,
  );
  process.exit(1);
}

console.log(`Worker heartbeat is healthy (${Math.round(ageMs / 1000)}s old).`);
