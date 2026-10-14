import { Suspense } from "react";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { getPublicSites, type PublicSite } from "@/lib/monitoring/public-sites";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatLastChecked(value: string | null) {
  if (!value) return "Awaiting first check";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Check time unavailable";

  return `Checked ${dateFormatter.format(date)}`;
}

function SiteRow({ site }: { site: PublicSite }) {
  const statusLabel = site.isStale
    ? "Delayed"
    : site.isActive
      ? "Active"
      : "Inactive";
  const statusClasses = site.isStale
    ? "border-[#ead9a8] bg-[#fff9e8] text-[#826514]"
    : site.isActive
      ? "border-[#b8ded5] bg-[#edf8f5] text-[#16675f]"
      : "border-[#e7caca] bg-[#fff4f3] text-[var(--danger)]";
  const indicatorClasses = site.isStale
    ? "bg-[#d2a33b]"
    : site.isActive
      ? "bg-[#1c8b7f]"
      : "bg-[var(--danger)]";

  return (
    <li className="grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-7">
      <div className="min-w-0">
        <a
          className="group inline-flex max-w-full items-center gap-2 font-semibold tracking-[-0.01em] hover:text-[var(--signal)]"
          href={site.url}
          rel="noreferrer"
          target="_blank"
        >
          <span className="truncate">{site.name}</span>
          <span aria-hidden="true" className="text-xs text-[var(--muted)]">
            ↗
          </span>
        </a>
        <p className="mt-1 truncate text-sm text-[var(--muted)]">
          {getHostname(site.url)}
        </p>
      </div>
      <div className="flex items-center justify-between gap-6 sm:justify-end">
        <p className="text-xs text-[var(--muted)]">
          {formatLastChecked(site.lastCheckedAt)}
        </p>
        <span
          className={`inline-flex min-w-24 items-center justify-center gap-2 border px-3 py-1.5 text-xs font-semibold ${statusClasses}`}
        >
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${indicatorClasses}`}
          />
          {statusLabel}
        </span>
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-b border-[var(--line)] bg-white px-5 py-5 sm:px-7">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

async function SiteStatusContent() {
  await connection();
  const result = await getPublicSites();

  if (result.state === "unavailable") {
    return (
      <section className="mt-8 border border-[var(--line)] bg-white px-5 py-12 text-center sm:px-8">
        <span className="mx-auto block size-2 rounded-full bg-[#d2a33b]" />
        <h2 className="mt-4 text-lg font-semibold">
          Status data is unavailable
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
          The dashboard is public, but it cannot reach the monitoring service
          right now. Please check again shortly.
        </p>
      </section>
    );
  }

  const staleCount = result.sites.filter((site) => site.isStale).length;
  const activeCount = result.sites.filter(
    (site) => site.isActive && !site.isStale,
  ).length;
  const inactiveCount = result.sites.length - activeCount - staleCount;

  return (
    <>
      <section
        aria-label="Site status totals"
        className="mt-8 grid border-l border-t border-[var(--line)] sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric label="Sites monitored" value={result.sites.length} />
        <Metric label="Active" value={activeCount} />
        <Metric label="Inactive" value={inactiveCount} />
        <Metric label="Monitoring delayed" value={staleCount} />
      </section>

      <section className="mt-8 overflow-hidden border border-[var(--line)] bg-white">
        <div className="flex items-center justify-between gap-5 border-b border-[var(--line)] px-5 py-5 sm:px-7">
          <div>
            <h2 className="font-semibold tracking-[-0.02em]">All sites</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Current availability from the latest completed check.
            </p>
          </div>
          <span className="hidden font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] sm:block">
            Public status
          </span>
        </div>

        {result.sites.length > 0 ? (
          <ul className="divide-y divide-[var(--line)]">
            {result.sites.map((site) => (
              <SiteRow key={site.id} site={site} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center sm:px-8">
            <h3 className="font-semibold">No sites are listed yet</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Monitored sites will appear here as soon as they are added.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function StatusSkeleton() {
  return (
    <section
      aria-label="Loading site statuses"
      className="mt-8 border border-[var(--line)] bg-white px-5 py-16 text-center text-sm text-[var(--muted)]"
    >
      Loading site statuses…
    </section>
  );
}

export function PublicDashboard() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-tight">
                Shivachi Monitor
              </p>
              <p className="text-xs text-[var(--muted)]">Public site status</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--signal)]">
            <span className="size-2 rounded-full bg-[var(--signal)]" />
            Live overview
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:px-10 lg:py-14">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--signal)]">
            Service status
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Sites at a glance.
          </h1>
          <p className="mt-4 text-base leading-7 text-[var(--muted)]">
            A simple view of every monitored site and its latest availability.
            No sign-in required.
          </p>
        </div>

        <Suspense fallback={<StatusSkeleton />}>
          <SiteStatusContent />
        </Suspense>
      </main>

      <footer className="mx-auto flex max-w-6xl items-center justify-between border-t border-[var(--line)] px-5 py-6 text-xs text-[var(--muted)] sm:px-8 lg:px-10">
        <span>Shivachi Studio</span>
        <span>Website monitoring</span>
      </footer>
    </div>
  );
}
