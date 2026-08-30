"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

type IncidentWithSession = Doc<"incidents"> & {
  session: Doc<"sessions"> | null;
};
type Overview = {
  product: Doc<"products">;
  integrations: Omit<Doc<"integrations">, "cachedResponse">[];
  incidents: IncidentWithSession[];
  sessions: Doc<"sessions">[];
  events: Doc<"events">[];
} | null;

const INCIDENT_DOT: Record<string, string> = {
  detected: "bg-amber-500",
  gathering_context: "bg-amber-500",
  diagnosing: "bg-amber-500",
  not_impacted: "bg-neutral-300 dark:bg-neutral-600",
  needs_review: "bg-amber-500",
  repair_queued: "bg-red-500",
  repairing: "bg-red-500",
  validating: "bg-red-500",
  repair_proposed: "bg-emerald-500",
  repair_failed: "bg-red-500",
};

const STATUS_WORD: Record<string, string> = {
  detected: "Detected",
  gathering_context: "Gathering context",
  diagnosing: "Diagnosing",
  not_impacted: "Not impacted",
  needs_review: "Needs review",
  repair_queued: "Repair queued",
  repairing: "Repairing",
  validating: "Validating",
  repair_proposed: "Repair PR proposed",
  repair_failed: "Repair failed",
};

const LEVEL_DOT: Record<string, string> = {
  info: "bg-neutral-300 dark:bg-neutral-600",
  warn: "bg-amber-500",
  critical: "bg-red-500",
};

const timeAgo = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

const card =
  "overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900";
const cardHeader =
  "flex h-12 items-center justify-between bg-neutral-50 px-4 dark:bg-neutral-900/60";
const cardTitle = "text-sm font-medium text-neutral-900 dark:text-neutral-100";
const countBadge =
  "inline-flex h-5 shrink-0 items-center rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
const buttonClass =
  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white px-4 text-[13px] font-medium text-neutral-900 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-800";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="truncate text-[13px] text-neutral-500">{label}</p>
      <p className="mt-2 truncate text-2xl font-medium tabular-nums tracking-[-0.02em] text-neutral-900 dark:text-neutral-100">
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 truncate text-[13px] text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

function IncidentTimeline({ incidentId }: { incidentId: Id<"incidents"> }) {
  const timeline = useQuery(api.dashboard.incidentTimeline, { incidentId }) as {
    incident: Doc<"incidents">;
    events: Doc<"events">[];
    session: Doc<"sessions"> | null;
  } | null | undefined;
  if (timeline === undefined) {
    return <p className="px-3 py-2 text-xs text-neutral-500">Loading timeline…</p>;
  }
  if (!timeline) return null;
  const { incident, events, session } = timeline;
  return (
    <div className="mt-2 rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white p-3 text-[13px] dark:border-neutral-800 dark:bg-neutral-900">
      {incident.diagnosisReason ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Diagnosis ({incident.diagnosisVerdict})
          </p>
          <p className="mt-1 text-neutral-900 dark:text-neutral-100">
            {incident.diagnosisReason}
          </p>
        </div>
      ) : null}
      {incident.codeEvidence?.length ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Cited adapter code
          </p>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-[11px] text-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-200">
            {incident.codeEvidence.join("\n")}
          </pre>
        </div>
      ) : null}
      {incident.diagnosisEvidence?.length ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Docs evidence
          </p>
          <ul className="mt-1 list-disc pl-4 text-neutral-700 dark:text-neutral-300">
            {incident.diagnosisEvidence.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {session ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Devin
          </p>
          <span className="text-neutral-900 dark:text-neutral-100">
            {session.status}
            {session.testStatus ? ` · tests ${session.testStatus}` : ""}
          </span>
          {session.devinUrl ? (
            <a
              href={session.devinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-neutral-600 underline dark:text-neutral-400"
            >
              session <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {session.prUrl ? (
            <a
              href={session.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-emerald-700 underline dark:text-emerald-400"
            >
              PR{session.prNumber ? ` #${session.prNumber}` : ""}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        Timeline
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {[...events]
          .sort((a, b) => a._creationTime - b._creationTime)
          .map((event) => (
            <li key={event._id} className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[event.level]}`}
              />
              <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-300">
                {event.message}
                <span className="ml-1 text-xs text-neutral-500">
                  {timeAgo(event._creationTime)}
                </span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export default function Dashboard4() {
  const overview: Overview | undefined = useQuery(api.dashboard.overview);
  const resetDemo = useMutation(api.demo.resetDemo);

  const [busy, setBusy] = useState(false);
  const [expandedIncident, setExpandedIncident] =
    useState<Id<"incidents"> | null>(null);

  const handleReset = async () => {
    setBusy(true);
    try {
      await resetDemo({});
    } finally {
      setBusy(false);
    }
  };

  if (overview === undefined) {
    return (
      <div className="flex h-full min-h-[720px] w-full items-center justify-center bg-white text-sm text-neutral-500 dark:bg-neutral-950">
        Loading Sentinel…
      </div>
    );
  }
  if (overview === null) {
    return (
      <div className="flex h-full min-h-[720px] w-full items-center justify-center bg-white text-sm text-neutral-500 dark:bg-neutral-950">
        No product is configured. Run seed:setupProducts.
      </div>
    );
  }

  const { product, integrations, incidents, events, sessions } = overview;
  const integration = integrations[0];
  const openIncidents = incidents.filter(
    (incident) =>
      !["not_impacted", "repair_proposed", "repair_failed"].includes(
        incident.status,
      ),
  );
  const activeSessions = sessions.filter((session) =>
    ["working", "blocked", "resumed", "launching"].includes(session.status),
  );
  const repairPRs = sessions.filter((session) => session.prUrl).length;
  const latestIncident = incidents[0];
  const integrationStatus = !integration
    ? { word: "Not configured", dot: "bg-neutral-300 dark:bg-neutral-600" }
    : latestIncident &&
        !["not_impacted", "repair_proposed"].includes(latestIncident.status)
      ? { word: STATUS_WORD[latestIncident.status], dot: INCIDENT_DOT[latestIncident.status] }
      : { word: "Operational", dot: "bg-emerald-500" };

  return (
    <div className="relative flex h-full min-h-[720px] w-full flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 sm:px-6 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-medium tracking-[-0.015em] text-neutral-900 dark:text-neutral-100">
            Sentinel
          </h1>
          <span className="hidden items-center gap-1.5 text-[13px] text-neutral-600 sm:inline-flex dark:text-neutral-400">
            <span
              className={cx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                openIncidents.length ? "bg-red-500" : "bg-emerald-500",
              )}
            />
            {product.name} · {openIncidents.length} active incident
            {openIncidents.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-neutral-500">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          live via Convex
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-1 rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-950">
          <StatCard
            label="Active contract"
            value={integration?.activeContractVersion ?? "—"}
            hint={integration ? `${integration.provider} · ${integration.endpoint}` : undefined}
          />
          <StatCard
            label="Active incidents"
            value={String(openIncidents.length)}
            hint={`${incidents.length} total`}
          />
          <StatCard
            label="Devin sessions"
            value={String(activeSessions.length)}
            hint={`${sessions.length} total`}
          />
          <StatCard
            label="Repair PRs"
            value={String(repairPRs)}
            hint="never auto-merged"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className={card}>
              <div className={cardHeader}>
                <h2 className={cardTitle}>Integration health</h2>
              </div>
              {integration ? (
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                        {integration.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-neutral-500">
                        {integration.endpoint} · {integration.integrationPath}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-neutral-600 dark:text-neutral-400">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${integrationStatus.dot}`}
                      />
                      {integrationStatus.word}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <div>
                      <dt className="text-neutral-500">Contract version</dt>
                      <dd className="font-mono text-neutral-900 dark:text-neutral-100">
                        {integration.activeContractVersion}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Monitor</dt>
                      <dd className="text-neutral-900 dark:text-neutral-100">
                        watching docs mirror
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Repository</dt>
                      <dd className="font-mono text-neutral-900 dark:text-neutral-100">
                        {product.repo ?? "observer mode"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Test command</dt>
                      <dd className="font-mono text-neutral-900 dark:text-neutral-100">
                        {integration.testCommand}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="p-4 text-[13px] text-neutral-500">
                  No integration is registered.
                </p>
              )}
            </div>

            <div className={card}>
              <div className={cardHeader}>
                <h2 className={cardTitle}>Live feed</h2>
                <span className={countBadge}>{events.length}</span>
              </div>
              {events.length ? (
                <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto p-1.5">
                  {events.map((event) => (
                    <li
                      key={event._id}
                      className="flex items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50"
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[event.level]}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-neutral-900 dark:text-neutral-100">
                          {event.message}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {event.sentinel} · {timeAgo(event._creationTime)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-[13px] text-neutral-500">
                  Waiting for the first event.
                </p>
              )}
            </div>
          </div>

          <div className={card}>
            <div className={cardHeader}>
              <h2 className={cardTitle}>API incidents</h2>
              <span className={countBadge}>{incidents.length}</span>
            </div>
            {incidents.length ? (
              <ul className="flex flex-col gap-1.5 p-1.5">
                {incidents.map((incident) => (
                  <li
                    key={incident._id}
                    className="rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/50"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedIncident(
                          expandedIncident === incident._id
                            ? null
                            : incident._id,
                        )
                      }
                      className="flex w-full cursor-pointer items-start gap-2.5 text-left"
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${INCIDENT_DOT[incident.status] ?? "bg-neutral-300"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                          {incident.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-neutral-500">
                          {STATUS_WORD[incident.status] ?? incident.status}
                          {incident.diagnosisVerdict
                            ? ` · verdict: ${incident.diagnosisVerdict}`
                            : ""}
                          {" · "}
                          {timeAgo(incident._creationTime)}
                        </span>
                      </span>
                    </button>
                    {expandedIncident === incident._id ? (
                      <IncidentTimeline incidentId={incident._id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-[13px] text-neutral-500">
                No incidents. Ship the vendor upgrade from the Stripe docs page
                to start the demo.
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-neutral-200 px-4 py-3 sm:px-6 dark:border-neutral-800">
        {integration ? (
          <a
            href={integration.docsUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClass}
          >
            Open Stripe docs <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleReset()}
          className={buttonClass}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          Reset demo
        </button>
      </footer>
    </div>
  );
}
