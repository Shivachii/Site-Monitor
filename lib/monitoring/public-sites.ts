import "server-only";

import { createClient } from "@supabase/supabase-js";

type PublicSiteRow = {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  is_stale: boolean;
  last_checked_at: string | null;
};

export type PublicSite = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  isStale: boolean;
  lastCheckedAt: string | null;
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
          isActive: monitor.is_active,
          isStale: monitor.is_stale,
          lastCheckedAt: monitor.last_checked_at,
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
