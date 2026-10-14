"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

const refreshIntervalMs = 30_000;

function RefreshIcon({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function StatusRefresh() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const interval = window.setInterval(refresh, refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span className="text-xs text-[var(--faint)]">
        Refreshes every 30 seconds
      </span>
      <button
        className="inline-flex min-w-32 items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-bold text-[var(--signal)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--signal-soft)] hover:bg-[var(--soft)] disabled:cursor-wait disabled:opacity-60"
        disabled={isRefreshing}
        onClick={refresh}
        type="button"
      >
        <RefreshIcon isRefreshing={isRefreshing} />
        {isRefreshing ? "Refreshing…" : "Refresh status"}
      </button>
    </div>
  );
}
