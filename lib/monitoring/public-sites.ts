import "server-only";

import { createClient } from "@supabase/supabase-js";

type PublicSiteRow = {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  is_stale: boolean;
  status: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  incident_started_at: string | null;
  failure_category: string | null;
  http_status_code: number | null;
};

export type PublicMonitorStatus =
  "unknown" | "operational" | "degraded" | "recovering" | "down";

export type PublicFailureCategory =
  "http" | "timeout" | "dns" | "tls" | "slow" | "connection";

export type PublicSite = {
  id: string;
  name: string;
  url: string;
  status: PublicMonitorStatus;
  isStale: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  incidentStartedAt: string | null;
  failureCategory: PublicFailureCategory | null;
  httpStatusCode: number | null;
};

export type PublicSitesResult =
  { state: "ready"; sites: PublicSite[] } | { state: "unavailable"; sites: [] };

function isPublicWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isMonitorStatus(value: string): value is PublicMonitorStatus {
  return ["unknown", "operational", "degraded", "recovering", "down"].includes(
    value,
  );
}

function isFailureCategory(
  value: string | null,
): value is PublicFailureCategory {
  return (
    value !== null &&
    ["http", "timeout", "dns", "tls", "slow", "connection"].includes(value)
  );
}

export async function getPublicSites(): Promise<PublicSitesResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return { state: "unavailable", sites: [] };
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabase.rpc("get_public_site_statuses");

    if (error) {
      console.error("Unable to load public site statuses:", error.message);
      return { state: "unavailable", sites: [] };
    }

    const rows = (data ?? []) as PublicSiteRow[];

    return {
      state: "ready",
      sites: rows
        .filter((monitor) => isPublicWebUrl(monitor.url))
        .map((monitor) => ({
          id: monitor.id,
          name: monitor.name,
          url: monitor.url,
          status: isMonitorStatus(monitor.status)
            ? monitor.status
            : monitor.is_active
              ? "operational"
              : "unknown",
          isStale: monitor.is_stale,
          lastCheckedAt: monitor.last_checked_at,
          lastSuccessAt: monitor.last_success_at,
          incidentStartedAt: monitor.incident_started_at,
          failureCategory: isFailureCategory(monitor.failure_category)
            ? monitor.failure_category
            : null,
          httpStatusCode: Number.isInteger(monitor.http_status_code)
            ? monitor.http_status_code
            : null,
        })),
    };
  } catch (error) {
    console.error(
      "Unable to initialize public site status data:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { state: "unavailable", sites: [] };
  }
}
