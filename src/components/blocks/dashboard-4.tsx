"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  not_impacted: "bg-muted-foreground/50",
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
  info: "bg-muted-foreground/50",
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

const panelHeader =
  "flex h-12 flex-row items-center justify-between gap-3 bg-muted/60 py-0";
const panelTitle = "text-sm font-medium text-foreground";
const countBadge =
  "inline-flex h-5 shrink-0 items-center rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-secondary-foreground";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm" className="rounded-lg py-4">
      <CardContent className="px-4">
        <p className="truncate text-[13px] text-muted-foreground">{label}</p>
        <p className="mt-2 truncate text-2xl font-medium tabular-nums tracking-[-0.02em] text-foreground">
          {value}
        </p>
        {hint ? (
          <p className="mt-1.5 truncate text-[13px] text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IncidentTimeline({ incidentId }: { incidentId: Id<"incidents"> }) {
  const timeline = useQuery(api.dashboard.incidentTimeline, { incidentId }) as {
    incident: Doc<"incidents">;
    events: Doc<"events">[];
    session: Doc<"sessions"> | null;
  } | null | undefined;
  if (timeline === undefined) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading timeline…</p>;
  }
  if (!timeline) return null;
  const { incident, events, session } = timeline;
  return (
    <div className="mt-2 rounded-lg border bg-card p-3 text-[13px] text-card-foreground">
      {incident.diagnosisReason ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Diagnosis ({incident.diagnosisVerdict})
          </p>
          <p className="mt-1 text-foreground">
            {incident.diagnosisReason}
          </p>
        </div>
      ) : null}
      {incident.codeEvidence?.length ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cited adapter code
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">
            {incident.codeEvidence.join("\n")}
          </pre>
        </div>
      ) : null}
      {incident.diagnosisEvidence?.length ? (
        <div className="mb-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Docs evidence
          </p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {incident.diagnosisEvidence.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {session ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Devin
          </p>
          <span className="text-foreground">
            {session.status}
            {session.testStatus ? ` · tests ${session.testStatus}` : ""}
          </span>
          {session.devinUrl ? (
            <a
              href={session.devinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              session <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {session.prUrl ? (
            <a
              href={session.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
            >
              PR{session.prNumber ? ` #${session.prNumber}` : ""}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
              <span className="min-w-0 flex-1 text-muted-foreground">
                {event.message}
                <span className="ml-1 text-xs text-muted-foreground/70">
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
      <div className="flex h-full min-h-[720px] w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading Kevin (not Devin)…
      </div>
    );
  }
  if (overview === null) {
    return (
      <div className="flex h-full min-h-[720px] w-full items-center justify-center bg-background text-sm text-muted-foreground">
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
    ? { word: "Not configured", dot: "bg-muted-foreground/50" }
    : latestIncident &&
        !["not_impacted", "repair_proposed"].includes(latestIncident.status)
      ? { word: STATUS_WORD[latestIncident.status], dot: INCIDENT_DOT[latestIncident.status] }
      : { word: "Operational", dot: "bg-emerald-500" };

  return (
    <div className="relative flex h-full min-h-[720px] w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-medium tracking-[-0.015em] text-foreground">
            Kevin (not Devin)
          </h1>
          <span className="hidden items-center gap-1.5 text-[13px] text-muted-foreground sm:inline-flex">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                openIncidents.length ? "bg-red-500" : "bg-emerald-500",
              )}
            />
            {product.name} · {openIncidents.length} active incident
            {openIncidents.length === 1 ? "" : "s"}
          </span>
        </div>
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          live via Convex
        </Badge>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1 lg:grid-cols-4">
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
            <Card className="overflow-hidden">
              <CardHeader className={panelHeader}>
                <CardTitle className={panelTitle}>Integration health</CardTitle>
              </CardHeader>
              {integration ? (
                <CardContent>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {integration.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {integration.endpoint} · {integration.integrationPath}
                      </p>
                    </div>
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${integrationStatus.dot}`}
                      />
                      {integrationStatus.word}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <div>
                      <dt className="text-muted-foreground">Contract version</dt>
                      <dd className="font-mono text-foreground">
                        {integration.activeContractVersion}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Monitor</dt>
                      <dd className="text-foreground">
                        watching docs mirror
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Repository</dt>
                      <dd className="font-mono text-foreground">
                        {product.repo ?? "observer mode"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Test command</dt>
                      <dd className="font-mono text-foreground">
                        {integration.testCommand}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              ) : (
                <CardContent>
                  <p className="text-[13px] text-muted-foreground">
                    No integration is registered.
                  </p>
                </CardContent>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className={panelHeader}>
                <CardTitle className={panelTitle}>Live feed</CardTitle>
                <CardAction className={countBadge}>{events.length}</CardAction>
              </CardHeader>
              {events.length ? (
                <CardContent className="p-1.5">
                  <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
                    {events.map((event) => (
                      <li
                        key={event._id}
                        className="flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[event.level]}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-foreground">
                            {event.message}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {event.sentinel} · {timeAgo(event._creationTime)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              ) : (
                <CardContent>
                  <p className="text-[13px] text-muted-foreground">
                    Waiting for the first event.
                  </p>
                </CardContent>
              )}
            </Card>
          </div>

          <Card className="h-fit overflow-hidden">
            <CardHeader className={panelHeader}>
              <CardTitle className={panelTitle}>API incidents</CardTitle>
              <CardAction className={countBadge}>{incidents.length}</CardAction>
            </CardHeader>
            {incidents.length ? (
              <CardContent className="p-1.5">
                <ul className="flex flex-col gap-1.5">
                  {incidents.map((incident) => (
                    <li
                      key={incident._id}
                      className="rounded-lg bg-muted px-3 py-2.5"
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
                        className="flex w-full cursor-pointer items-start gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${INCIDENT_DOT[incident.status] ?? "bg-muted-foreground/50"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-foreground">
                            {incident.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
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
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-[13px] text-muted-foreground">
                  No incidents. Ship the vendor upgrade from the Stripe docs page
                  to start the demo.
                </p>
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3 sm:px-6">
        {integration ? (
          <Button variant="outline" size="lg" asChild>
            <a href={integration.docsUrl} target="_blank" rel="noreferrer">
              Open Stripe docs <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={busy}
          onClick={() => void handleReset()}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          Reset demo
        </Button>
      </footer>
    </div>
  );
}
