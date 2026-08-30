"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");
import { RefreshCw } from "lucide-react";

type Status = "operational" | "degraded" | "down" | "maintenance";

const DOT: Record<Status, string> = {
  operational: "bg-neutral-300 dark:bg-neutral-600",
  degraded: "bg-amber-500",
  down: "bg-red-500",
  maintenance: "bg-neutral-300 dark:bg-neutral-600",
};

const WORD: Record<Status, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  maintenance: "Maintenance",
};

const STATS = [
  {
    label: "Uptime, 30 days",
    value: "99.98%",
    delta: "+0.02 pp",
    positive: true,
    spark: [96, 97, 95, 98, 97, 99, 98, 99],
  },
  {
    label: "Open incidents",
    value: "2",
    delta: "+1",
    positive: false,
    spark: [1, 0, 1, 2, 1, 1, 2, 2],
  },
  {
    label: "P95 latency",
    value: "142 ms",
    delta: "+18 ms",
    positive: false,
    spark: [118, 124, 121, 130, 128, 135, 138, 142],
  },
  {
    label: "Error rate",
    value: "0.04%",
    delta: "−0.01 pp",
    positive: true,
    spark: [6, 7, 5, 6, 4, 5, 4, 4],
  },
];

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 92 - ((v - min) / span) * 84;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className="hidden h-8 w-16 shrink-0 sm:block"
    >
      <polyline
        points={points}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-neutral-900 dark:stroke-neutral-100"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Service = {
  name: string;
  region: string;
  latency: string;
  uptime: string;
  status: Status;
};

const SERVICES: Service[] = [
  {
    name: "REST API",
    region: "us-east-1",
    latency: "142 ms",
    uptime: "99.98%",
    status: "operational",
  },
  {
    name: "REST API",
    region: "eu-west-1",
    latency: "168 ms",
    uptime: "99.95%",
    status: "operational",
  },
  {
    name: "Web app",
    region: "global edge",
    latency: "61 ms",
    uptime: "100.00%",
    status: "operational",
  },
  {
    name: "Auth service",
    region: "us-east-1",
    latency: "118 ms",
    uptime: "99.99%",
    status: "operational",
  },
  {
    name: "Postgres primary",
    region: "us-east-1",
    latency: "4 ms",
    uptime: "99.97%",
    status: "operational",
  },
  {
    name: "Search cluster",
    region: "us-west-2",
    latency: "402 ms",
    uptime: "99.62%",
    status: "degraded",
  },
  {
    name: "Webhooks worker",
    region: "us-east-1",
    latency: "-",
    uptime: "96.20%",
    status: "down",
  },
  {
    name: "Object storage",
    region: "eu-west-1",
    latency: "33 ms",
    uptime: "99.99%",
    status: "operational",
  },
  {
    name: "Analytics pipeline",
    region: "us-west-2",
    latency: "-",
    uptime: "-",
    status: "maintenance",
  },
];

type Incident = {
  title: string;
  state: string;
  when: string;
  dot: string;
};

const INCIDENTS: Incident[] = [
  {
    title: "Elevated search latency in us-west-2",
    state: "Investigating",
    when: "14 min ago",
    dot: "bg-amber-500",
  },
  {
    title: "Webhook delivery failures",
    state: "Identified",
    when: "38 min ago",
    dot: "bg-red-500",
  },
  {
    title: "Analytics backfill maintenance",
    state: "Scheduled",
    when: "2 hours ago",
    dot: "bg-neutral-300 dark:bg-neutral-600",
  },
  {
    title: "Auth latency spike",
    state: "Resolved",
    when: "Yesterday",
    dot: "bg-neutral-300 dark:bg-neutral-600",
  },
  {
    title: "CDN cache purge delays",
    state: "Resolved",
    when: "2 days ago",
    dot: "bg-neutral-300 dark:bg-neutral-600",
  },
  {
    title: "Postgres failover drill",
    state: "Resolved",
    when: "Mar 4",
    dot: "bg-neutral-300 dark:bg-neutral-600",
  },
  {
    title: "Rate limit errors on /v1/events",
    state: "Resolved",
    when: "Mar 2",
    dot: "bg-neutral-300 dark:bg-neutral-600",
  },
];

function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

export default function Dashboard4() {
  const {
    ref: bodyRef,
    edges: bodyEdges,
    onScroll: handleBodyScroll,
  } = useScrollFade<HTMLDivElement>();
  const [refreshing, setRefreshing] = useState(false);
  const [freshlyLoaded, setFreshlyLoaded] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const refresh = () => {
    window.clearTimeout(timerRef.current);
    setRefreshing(true);
    timerRef.current = window.setTimeout(() => {
      setRefreshing(false);
      setFreshlyLoaded(true);
    }, 900);
  };

  return (
    <div className="relative flex h-full min-h-[720px] w-full flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 sm:px-6 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-medium tracking-[-0.015em] text-neutral-900 dark:text-neutral-100">
            System status
          </h1>
          <span className="hidden items-center gap-1.5 text-[13px] text-neutral-600 sm:inline-flex dark:text-neutral-400">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />2
            incidents open
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            aria-live="polite"
            className="hidden text-[13px] tabular-nums text-neutral-500 sm:inline"
          >
            {refreshing
              ? "Refreshing…"
              : freshlyLoaded
                ? "Updated just now"
                : "Updated 2 min ago"}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-neutral-300 hover:bg-neutral-50 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
          >
            <RefreshCw
              aria-hidden
              className={cx(
                "h-4 w-4 shrink-0 text-neutral-500",
                refreshing && "animate-spin motion-reduce:animate-none",
              )}
            />
            Refresh
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={bodyRef}
          onScroll={handleBodyScroll}
          className="h-full overflow-y-auto p-4 sm:p-6"
        >
          <div className="grid grid-cols-2 gap-1 rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-950">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <p className="truncate text-[13px] text-neutral-500">
                  {s.label}
                </p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="truncate text-2xl font-medium tabular-nums tracking-[-0.02em] text-neutral-900 dark:text-neutral-100">
                    {s.value}
                  </p>
                  <Sparkline values={s.spark} />
                </div>
                <p className="mt-1.5 truncate text-[13px] tabular-nums">
                  <span
                    className={
                      s.positive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {s.delta}
                  </span>
                  <span className="hidden text-neutral-500 sm:inline">
                    {" "}
                    vs. prior period
                  </span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex h-12 items-center bg-neutral-50 px-4 dark:bg-neutral-900/60">
                <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Services
                </h2>
              </div>
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Service health</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="h-9 px-3 text-xs font-medium text-neutral-500 first:pl-4"
                    >
                      Service
                    </th>
                    <th
                      scope="col"
                      className="hidden h-9 px-3 text-right text-xs font-medium text-neutral-500 sm:table-cell"
                    >
                      Latency
                    </th>
                    <th
                      scope="col"
                      className="hidden h-9 px-3 text-right text-xs font-medium text-neutral-500 sm:table-cell"
                    >
                      Uptime
                    </th>
                    <th
                      scope="col"
                      className="h-9 px-3 text-right text-xs font-medium text-neutral-500 last:pr-4"
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {SERVICES.map((s, i) => (
                    <tr
                      key={`${s.name}-${i}`}
                      className="h-11 transition-colors duration-150 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <td className="min-w-0 px-3 first:pl-4">
                        <p className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                          {s.name}
                        </p>
                        <p className="truncate font-mono text-[11px] text-neutral-500">
                          {s.region}
                        </p>
                      </td>
                      <td className="hidden px-3 text-right text-[13px] tabular-nums text-neutral-600 sm:table-cell dark:text-neutral-400">
                        {s.latency}
                      </td>
                      <td className="hidden px-3 text-right text-[13px] tabular-nums text-neutral-600 sm:table-cell dark:text-neutral-400">
                        {s.uptime}
                      </td>
                      <td className="px-3 last:pr-4">
                        <span className="flex items-center justify-end gap-1.5 whitespace-nowrap text-[13px] text-neutral-600 dark:text-neutral-400">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.status]}`}
                          />
                          {WORD[s.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex h-12 items-center justify-between bg-neutral-50 px-4 dark:bg-neutral-900/60">
                <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Incidents
                </h2>
                <span className="inline-flex h-5 shrink-0 items-center rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {INCIDENTS.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5 p-1.5">
                {INCIDENTS.map((inc, i) => (
                  <li
                    key={i}
                    className="flex min-h-11 items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/50"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${inc.dot}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                        {inc.title}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {inc.state} · {inc.when}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
            bodyEdges.start ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
            bodyEdges.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
}
