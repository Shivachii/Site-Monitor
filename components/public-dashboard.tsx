import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { BrandMark } from "@/components/brand-mark";
import { StatusRefresh } from "@/components/status-refresh";
import {
  getPublicSites,
  type PublicFailureCategory,
  type PublicSite,
} from "@/lib/monitoring/public-sites";

const dateFormatter = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Nairobi",
});

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function formatLastChecked(value: string | null) {
  if (!value) return "Awaiting first check";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Check time unavailable";

  return dateFormatter.format(date);
}

function getFailureDescription(
  failureCategory: PublicFailureCategory | null,
  httpStatusCode: number | null,
) {
  if (failureCategory === "http") {
    return httpStatusCode
      ? `The site returned HTTP ${httpStatusCode}.`
      : "The site returned an unexpected response.";
  }

  if (failureCategory === "timeout") return "The request timed out.";
  if (failureCategory === "dns") return "The domain could not be resolved.";
  if (failureCategory === "tls") {
    return "A secure connection could not be established.";
  }
  if (failureCategory === "slow") {
    return "The site responded more slowly than expected.";
  }
  if (failureCategory === "connection") {
    return "The monitor could not connect to the site.";
  }

  return "The latest availability checks did not succeed.";
}

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M7 17 17 7M8 7h9v9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d="m7 12.5 3.2 3.2L17.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 8v4.5l3 1.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 8.5v4M12 16h.01M10.2 4.7 3.5 17a2 2 0 0 0 1.8 3h13.4a2 2 0 0 0 1.8-3L13.8 4.7a2 2 0 0 0-3.6 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SiteRow({ site }: { site: PublicSite }) {
  const statusLabel = site.isStale
    ? "Delayed"
    : site.status === "operational"
      ? "Operational"
      : site.status === "down"
        ? "Unavailable"
        : site.status === "recovering"
          ? "Recovering"
          : site.status === "degraded"
            ? "Investigating"
            : "Pending";
  const statusClasses = site.isStale
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : site.status === "operational"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : site.status === "down"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : site.status === "recovering"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-blue-200 bg-blue-50 text-blue-800";
  const indicatorClasses = site.isStale
    ? "bg-amber-500"
    : site.status === "operational"
      ? "status-pulse bg-emerald-500"
      : site.status === "down"
        ? "bg-rose-500"
        : site.status === "recovering"
          ? "bg-amber-500"
          : "bg-blue-500";
  const incidentDetail =
    !site.isStale && site.status === "recovering"
      ? "The site responded successfully; recovery is being confirmed."
      : !site.isStale && (site.status === "down" || site.status === "degraded")
        ? getFailureDescription(site.failureCategory, site.httpStatusCode)
        : null;

  return (
    <li className="site-row group grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6 lg:px-7">
      <div className="flex min-w-0 items-center gap-4">
        <div
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-2xl border border-[var(--line)] bg-[var(--soft)] text-xs font-bold tracking-[-0.02em] text-[var(--signal)] transition-colors group-hover:border-[var(--signal-soft)] group-hover:bg-white"
        >
          {getInitials(site.name)}
        </div>
        <div className="min-w-0">
          <a
            className="inline-flex max-w-full items-center gap-1.5 font-semibold tracking-[-0.02em] transition-colors hover:text-[var(--signal)]"
            href={site.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{site.name}</span>
            <span className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100">
              <ArrowUpRightIcon />
            </span>
          </a>
          <p className="mt-1 truncate text-sm text-[var(--muted)]">
            {getHostname(site.url)}
          </p>
          {incidentDetail ? (
            <p
              className={`mt-2 text-xs font-medium ${site.status === "down" ? "text-rose-700" : site.status === "recovering" ? "text-amber-700" : "text-blue-700"}`}
            >
              {incidentDetail}
              {site.incidentStartedAt ? (
                <>
                  {" "}
                  Since{" "}
                  <time dateTime={site.incidentStartedAt}>
                    {formatLastChecked(site.incidentStartedAt)}
                  </time>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 pl-[3.75rem] sm:justify-end sm:pl-0">
        <div className="text-left sm:min-w-32 sm:text-right">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">
            Last checked
          </p>
          {site.lastCheckedAt ? (
            <time
              className="mt-1 block text-xs font-medium text-[var(--muted)]"
              dateTime={site.lastCheckedAt}
            >
              {formatLastChecked(site.lastCheckedAt)}
            </time>
          ) : (
            <p className="mt-1 text-xs font-medium text-[var(--muted)]">
              {formatLastChecked(null)}
            </p>
          )}
        </div>
        <span
          className={`inline-flex min-w-28 shrink-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${statusClasses}`}
        >
          <span className="relative flex size-2">
            <span
              aria-hidden="true"
              className={`relative inline-flex size-2 rounded-full ${indicatorClasses}`}
            />
          </span>
          {statusLabel}
        </span>
      </div>
    </li>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="metric-card rounded-3xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-sm)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-[-0.05em]">{value}</p>
        </div>
        <span className="grid size-10 place-items-center rounded-2xl bg-[var(--soft)] text-[var(--signal)]">
          {icon}
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--faint)]">{detail}</p>
    </div>
  );
}

function OverallStatus({
  activeCount,
  downCount,
  investigatingCount,
  recoveringCount,
  staleCount,
  totalCount,
}: {
  activeCount: number;
  downCount: number;
  investigatingCount: number;
  recoveringCount: number;
  staleCount: number;
  totalCount: number;
}) {
  const allOperational = totalCount > 0 && activeCount === totalCount;
  const hasOutage = downCount > 0;
  const title = hasOutage
    ? `${downCount} ${downCount === 1 ? "site is" : "sites are"} unavailable`
    : recoveringCount > 0
      ? "Recovery is being confirmed"
      : investigatingCount > 0
        ? "A possible issue is being verified"
        : staleCount > 0
          ? "Monitoring updates are delayed"
          : allOperational
            ? "All systems operational"
            : "Monitoring is getting started";
  const description = hasOutage
    ? "Repeated checks confirmed an outage. Incident details appear below."
    : recoveringCount > 0
      ? "The site is responding again. The incident will close after the configured recovery checks pass."
      : investigatingCount > 0
        ? "A check failed or slowed down. More checks are running before an outage is confirmed."
        : staleCount > 0
          ? "The latest worker heartbeat is late. Site availability may be out of date."
          : allOperational
            ? "Every monitored website passed its latest HTTP availability check."
            : "Sites will appear here as soon as the first checks complete.";
  const bannerClasses = hasOutage
    ? "border-rose-200 bg-rose-50/80 text-rose-950"
    : staleCount > 0 || investigatingCount > 0 || recoveringCount > 0
      ? "border-amber-200 bg-amber-50/80 text-amber-950"
      : "border-emerald-200 bg-emerald-50/80 text-emerald-950";
  const iconClasses = hasOutage
    ? "bg-rose-600 text-white"
    : staleCount > 0 || investigatingCount > 0 || recoveringCount > 0
      ? "bg-amber-500 text-white"
      : "bg-emerald-600 text-white";

  return (
    <section
      aria-live="polite"
      className={`status-banner relative mt-10 overflow-hidden rounded-[2rem] border px-5 py-6 sm:px-7 sm:py-7 ${bannerClasses}`}
    >
      <div className="relative z-10 flex items-start gap-4 sm:items-center">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-2xl shadow-sm ${iconClasses}`}
        >
          {hasOutage ? (
            <AlertIcon />
          ) : staleCount > 0 ||
            investigatingCount > 0 ||
            recoveringCount > 0 ? (
            <ClockIcon />
          ) : (
            <CheckIcon />
          )}
        </span>
        <div>
          <p className="text-lg font-bold tracking-[-0.025em] sm:text-xl">
            {title}
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-6 opacity-70">
            {description}
          </p>
        </div>
      </div>
    </section>
  );
}

function ActiveIncidents({ sites }: { sites: PublicSite[] }) {
  if (sites.length === 0) return null;

  return (
    <section aria-labelledby="active-incidents-title" className="mt-5">
      <div className="flex items-center justify-between gap-4 px-1">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-700">
            Active incidents
          </p>
          <h2
            className="mt-2 text-xl font-bold tracking-[-0.03em]"
            id="active-incidents-title"
          >
            Confirmed outages
          </h2>
        </div>
      </div>

      <ul className="mt-4 grid gap-4 lg:grid-cols-2">
        {sites.map((site) => (
          <li
            className={`rounded-3xl border bg-white p-5 shadow-[var(--shadow-sm)] sm:p-6 ${site.status === "recovering" ? "border-amber-200" : "border-rose-200"}`}
            key={site.id}
          >
            <div className="flex items-start gap-4">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-2xl text-white ${site.status === "recovering" ? "bg-amber-500" : "bg-rose-600"}`}
              >
                {site.status === "recovering" ? <ClockIcon /> : <AlertIcon />}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold tracking-[-0.02em]">
                  {site.name}{" "}
                  {site.status === "recovering"
                    ? "is recovering"
                    : "is unavailable"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {site.status === "recovering"
                    ? "A successful response was received. Additional checks are running before this incident closes."
                    : getFailureDescription(
                        site.failureCategory,
                        site.httpStatusCode,
                      )}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[var(--faint)]">
                  {site.incidentStartedAt ? (
                    <span>
                      Down since{" "}
                      <time dateTime={site.incidentStartedAt}>
                        {formatLastChecked(site.incidentStartedAt)}
                      </time>
                    </span>
                  ) : null}
                  {site.lastSuccessAt ? (
                    <span>
                      Last successful check{" "}
                      <time dateTime={site.lastSuccessAt}>
                        {formatLastChecked(site.lastSuccessAt)}
                      </time>
                    </span>
                  ) : null}
                </div>
                <a
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--signal-strong)]"
                  href={site.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Try opening the site
                  <ArrowUpRightIcon />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function SiteStatusContent() {
  await connection();
  const result = await getPublicSites();

  if (result.state === "unavailable") {
    return (
      <section className="mt-10 rounded-[2rem] border border-amber-200 bg-amber-50 px-6 py-12 text-center shadow-[var(--shadow-sm)] sm:px-8">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-amber-500 text-white">
          <ClockIcon />
        </span>
        <h2 className="mt-5 text-xl font-bold tracking-[-0.025em]">
          Status data is temporarily unavailable
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-amber-950/65">
          The public dashboard cannot reach the monitoring service right now.
          Please check back in a moment.
        </p>
      </section>
    );
  }

  const staleCount = result.sites.filter((site) => site.isStale).length;
  const activeCount = result.sites.filter(
    (site) => site.status === "operational" && !site.isStale,
  ).length;
  const downSites = result.sites.filter(
    (site) => site.status === "down" && !site.isStale,
  );
  const investigatingCount = result.sites.filter(
    (site) => site.status === "degraded" && !site.isStale,
  ).length;
  const recoveringCount = result.sites.filter(
    (site) => site.status === "recovering" && !site.isStale,
  ).length;
  const pendingCount = result.sites.filter(
    (site) => site.status === "unknown" && !site.isStale,
  ).length;
  const reviewCount =
    investigatingCount + recoveringCount + pendingCount + staleCount;
  const incidentSites = result.sites.filter(
    (site) =>
      (site.status === "down" || site.status === "recovering") && !site.isStale,
  );

  return (
    <>
      <OverallStatus
        activeCount={activeCount}
        downCount={downSites.length}
        investigatingCount={investigatingCount}
        recoveringCount={recoveringCount}
        staleCount={staleCount}
        totalCount={result.sites.length}
      />

      <ActiveIncidents sites={incidentSites} />

      <section
        aria-label="Site status totals"
        className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric
          detail="Public endpoints in the monitor"
          icon={<span className="text-sm font-bold">#</span>}
          label="Sites monitored"
          value={result.sites.length}
        />
        <Metric
          detail="Passing their latest HTTP check"
          icon={<CheckIcon />}
          label="Operational"
          value={activeCount}
        />
        <Metric
          detail="Unavailable or recovery being confirmed"
          icon={<AlertIcon />}
          label="Active incidents"
          value={incidentSites.length}
        />
        <Metric
          detail="Investigating, pending, or delayed"
          icon={<ClockIcon />}
          label="Needs review"
          value={reviewCount}
        />
      </section>

      <section className="mt-8 overflow-hidden rounded-[2rem] border border-[var(--line)] bg-white shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--signal)]">
              Live endpoints
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-[-0.03em] sm:text-2xl">
              Monitored websites
            </h2>
          </div>
          <div className="sm:text-right">
            <p className="mb-3 max-w-sm text-sm leading-6 text-[var(--muted)]">
              Times shown in East Africa Time.
            </p>
            <StatusRefresh />
          </div>
        </div>

        {result.sites.length > 0 ? (
          <ul className="divide-y divide-[var(--line)]">
            {result.sites.map((site) => (
              <SiteRow key={site.id} site={site} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-14 text-center sm:px-8">
            <h3 className="font-bold">No sites are listed yet</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Monitored sites will appear after they are added.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function StatusSkeleton() {
  return (
    <div aria-label="Loading site statuses" className="mt-10" role="status">
      <div className="skeleton h-28 rounded-[2rem]" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton h-40 rounded-3xl" key={index} />
        ))}
      </div>
      <div className="skeleton mt-8 h-80 rounded-[2rem]" />
      <span className="sr-only">Loading site statuses…</span>
    </div>
  );
}

export function PublicDashboard() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/70 bg-[var(--canvas)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-bold tracking-[-0.02em]">
                Shivachi Monitor
              </p>
              <p className="text-[0.68rem] font-medium uppercase tracking-[0.12em] text-[var(--faint)]">
                Public status
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--signal)] shadow-[var(--shadow-sm)]">
            <span className="size-2 rounded-full bg-blue-500" />
            Live overview
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:px-10 lg:pb-24 lg:pt-20">
        <section className="hero-panel relative overflow-hidden rounded-[2.25rem] bg-[var(--ink)] px-6 py-10 text-white shadow-[var(--shadow-lg)] sm:px-10 sm:py-14 lg:px-14 lg:py-16">
          <div className="hero-orb hero-orb-one" />
          <div className="hero-orb hero-orb-two" />
          <div className="relative z-10">
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-blue-300/25 bg-blue-400/10 px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-blue-200">
                <span className="size-1.5 rounded-full bg-blue-300" />
                Service status
              </p>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
                Your sites,
                <span className="block text-blue-300">always on watch.</span>
              </h1>
            </div>
          </div>
        </section>

        <Suspense fallback={<StatusSkeleton />}>
          <SiteStatusContent />
        </Suspense>
      </main>

      <footer className="border-t border-[var(--line)] bg-white/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-7 text-xs text-[var(--faint)] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <span>© {new Date().getFullYear()} Shivachi Studio</span>
          <span>Independent website availability monitoring</span>
        </div>
      </footer>
    </div>
  );
}
