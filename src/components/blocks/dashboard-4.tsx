"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  ExternalLink,
  LayoutDashboard,
  Moon,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ── Data shapes from api.dashboard.overview ──────────────────────────────────

type IncidentWithSession = Doc<"incidents"> & {
  session: Doc<"sessions"> | null;
};
type Integration = Omit<Doc<"integrations">, "cachedResponse">;
type Overview = {
  product: Doc<"products">;
  integrations: Integration[];
  incidents: IncidentWithSession[];
  sessions: Doc<"sessions">[];
  events: Doc<"events">[];
} | null;

// ── Presentation maps ────────────────────────────────────────────────────────

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

// ── Shared bits ──────────────────────────────────────────────────────────────

const panelHeader =
  "flex h-12 flex-row items-center justify-between gap-3 border-b border-border px-4 py-0 [.border-b]:pb-0";
const panelTitle = "text-sm font-medium tracking-tight text-foreground";
const countBadge =
  "inline-flex h-5 shrink-0 items-center self-center rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-secondary-foreground";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card size="sm" className="rounded-lg py-4">
      <CardContent className="px-4">
        <p className="truncate text-[13px] text-muted-foreground">{label}</p>
        <p className="mt-2 truncate text-2xl font-medium tabular-nums tracking-[-0.02em] text-foreground">
          {value}
        </p>
        {hint ? (
          <p className="mt-1.5 truncate text-[13px] text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <CardContent>
      <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">{title}</p>
        {hint ? (
          <p className="text-xs text-muted-foreground/70">{hint}</p>
        ) : null}
      </div>
    </CardContent>
  );
}

function IncidentTimeline({ incidentId }: { incidentId: Id<"incidents"> }) {
  const timeline = useQuery(api.dashboard.incidentTimeline, { incidentId }) as {
    incident: Doc<"incidents">;
    events: Doc<"events">[];
    session: Doc<"sessions"> | null;
  } | null | undefined;
  if (timeline === undefined) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Loading timeline…
      </p>
    );
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
          <p className="mt-1 text-foreground">{incident.diagnosisReason}</p>
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

function IncidentList({
  incidents,
  search = "",
}: {
  incidents: IncidentWithSession[];
  search?: string;
}) {
  const [expandedIncident, setExpandedIncident] =
    useState<Id<"incidents"> | null>(null);
  const query = search.trim().toLowerCase();
  const visible = query
    ? incidents.filter((incident) => {
        const status = STATUS_WORD[incident.status] ?? incident.status;
        return (
          incident.title.toLowerCase().includes(query) ||
          status.toLowerCase().includes(query) ||
          (incident.diagnosisVerdict ?? "").toLowerCase().includes(query)
        );
      })
    : incidents;

  if (visible.length === 0) {
    return (
      <EmptyState
        title={query ? `No incidents match "${search.trim()}"` : "No incidents"}
        hint={
          query
            ? "Try a different title, status, or verdict."
            : "Ship the vendor upgrade from the Stripe docs page to start the demo."
        }
      />
    );
  }

  return (
    <CardContent className="p-1.5">
      <ul className="flex flex-col gap-1.5">
        {visible.map((incident) => (
          <li key={incident._id} className="rounded-lg bg-muted px-3 py-2.5">
            <button
              type="button"
              onClick={() =>
                setExpandedIncident(
                  expandedIncident === incident._id ? null : incident._id,
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
  );
}

// ── Theme ────────────────────────────────────────────────────────────────────

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return false;
    try {
      if (localStorage.getItem("theme") === "dark") {
        document.documentElement.classList.add("dark");
        return true;
      }
    } catch {
      // localStorage unavailable — fall back to the DOM class
    }
    return document.documentElement.classList.contains("dark");
  });
  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {
        // localStorage unavailable — theme just won't persist
      }
      return next;
    });
  }, []);
  return { dark, toggle };
}

// ── Shell ────────────────────────────────────────────────────────────────────

type View = "dashboard" | "incidents" | "integrations" | "settings";

const NAV_ITEMS: { view: View; label: string; icon: typeof LayoutDashboard }[] =
  [
    { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { view: "incidents", label: "Incidents", icon: ShieldAlert },
    { view: "integrations", label: "Integrations", icon: Plug },
    { view: "settings", label: "Settings", icon: Settings },
  ];

const VIEW_TITLE: Record<View, string> = {
  dashboard: "Dashboard",
  incidents: "Incidents",
  integrations: "Integrations",
  settings: "Settings",
};

function Sidebar({
  view,
  onNavigate,
  openIncidentCount,
}: {
  view: View;
  onNavigate: (view: View) => void;
  openIncidentCount: number;
}) {
  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-border bg-muted/40 lg:w-52">
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-border px-2 lg:justify-start lg:px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
          K
        </span>
        <span className="ml-2.5 hidden text-[15px] font-medium tracking-[-0.015em] text-foreground lg:inline">
          Kevin
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_ITEMS.map(({ view: itemView, label, icon: Icon }) => {
          const active = view === itemView;
          const showBadge = itemView === "incidents" && openIncidentCount > 0;
          return (
            <Button
              key={itemView}
              type="button"
              variant={active ? "secondary" : "ghost"}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(itemView)}
              className={cn(
                "h-9 w-full justify-center gap-0 px-0 text-[13px] font-medium lg:justify-start lg:gap-2.5 lg:px-2.5",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span className="hidden min-w-0 flex-1 text-left lg:inline">
                {label}
              </span>
              {showBadge ? (
                <span
                  aria-label={`${openIncidentCount} open incidents`}
                  className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/15 px-1 text-[10px] font-medium text-red-600 dark:text-red-400"
                >
                  {openIncidentCount}
                </span>
              ) : null}
            </Button>
          );
        })}
      </nav>
      <div className="border-t border-border p-2">
        <div className="flex items-center justify-center gap-2.5 rounded-lg px-0 py-1.5 lg:justify-start lg:px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
            K
          </span>
          <span className="hidden min-w-0 flex-col lg:flex">
            <span className="truncate text-[13px] font-medium text-foreground">
              Kevin
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              Integration sentinel
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function NotificationsBell({ events }: { events: Doc<"events">[] }) {
  const recent = [...events]
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, 5);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="relative"
        >
          <Bell aria-hidden className="h-4 w-4" />
          {recent.some((event) => event.level !== "info") ? (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">
          Recent activity
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            Nothing yet — waiting for the first event.
          </p>
        ) : (
          <ul className="flex flex-col p-1">
            {recent.map((event) => (
              <li
                key={event._id}
                className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[event.level]}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] text-foreground">
                    {event.message}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {event.sentinel} · {timeAgo(event._creationTime)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Views ────────────────────────────────────────────────────────────────────

function IntegrationHealthCard({
  integration,
  status,
}: {
  integration: Integration | undefined;
  status: { word: string; dot: string };
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className={panelHeader}>
        <CardTitle className={panelTitle}>Integration health</CardTitle>
      </CardHeader>
      {integration ? (
        <CardContent className="p-4">
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
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`}
              />
              {status.word}
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
              <dd className="text-foreground">watching docs mirror</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Test command</dt>
              <dd className="font-mono text-foreground">
                {integration.testCommand}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Watched docs</dt>
              <dd>
                <a
                  href={integration.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
                >
                  {integration.provider} docs
                  <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                </a>
              </dd>
            </div>
          </dl>
        </CardContent>
      ) : (
        <EmptyState title="No integration is registered." />
      )}
    </Card>
  );
}

function LiveFeedCard({ events }: { events: Doc<"events">[] }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
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
                  <p className="text-[13px] text-foreground">{event.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {event.sentinel} · {timeAgo(event._creationTime)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : (
        <EmptyState title="Waiting for the first event." />
      )}
    </Card>
  );
}

function DashboardView({
  overview,
  search,
  busy,
  onResetDemo,
}: {
  overview: NonNullable<Overview>;
  search: string;
  busy: boolean;
  onResetDemo: () => void;
}) {
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
      ? {
          word: STATUS_WORD[latestIncident.status],
          dot: INCIDENT_DOT[latestIncident.status],
        }
      : { word: "Operational", dot: "bg-emerald-500" };

  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1 lg:grid-cols-4">
        <StatCard
          label="Active contract"
          value={integration?.activeContractVersion ?? "—"}
          hint={
            integration
              ? `${integration.provider} · ${integration.endpoint}`
              : undefined
          }
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
        <StatCard label="Repair PRs" value={String(repairPRs)} hint="never auto-merged" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <IntegrationHealthCard
            integration={integration}
            status={integrationStatus}
          />
          <LiveFeedCard events={events} />
        </div>

        <Card className="h-fit gap-0 overflow-hidden py-0">
          <CardHeader className={panelHeader}>
            <CardTitle className={panelTitle}>API incidents</CardTitle>
            <CardAction className={countBadge}>{incidents.length}</CardAction>
          </CardHeader>
          <IncidentList incidents={incidents} search={search} />
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3">
        <Badge variant="secondary" className="font-normal">
          Demo
        </Badge>
        {integration ? (
          <Button variant="outline" size="sm" asChild>
            <a href={integration.docsUrl} target="_blank" rel="noreferrer">
              Open Stripe docs
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onResetDemo}
        >
          <RefreshCw
            aria-hidden
            className={cn("h-3.5 w-3.5", busy && "animate-spin")}
          />
          Reset demo
        </Button>
      </div>

      <p className="sr-only">{product.name}</p>
    </>
  );
}

function IntegrationsView({ overview }: { overview: NonNullable<Overview> }) {
  const { integrations } = overview;
  if (integrations.length === 0) {
    return (
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className={panelHeader}>
          <CardTitle className={panelTitle}>Integrations</CardTitle>
        </CardHeader>
        <EmptyState
          title="No integrations registered"
          hint="Integrations are registered through the seed/demo flow."
        />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {integrations.map((integration) => (
        <Card key={integration._id} className="gap-0 overflow-hidden py-0">
          <CardHeader className={panelHeader}>
            <CardTitle className={panelTitle}>{integration.name}</CardTitle>

            <CardAction className="self-center">
              <Badge variant="secondary" className="gap-1.5 font-normal">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {integration.provider}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="p-4">
            <dl className="grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="font-mono text-xs text-foreground">
                  {integration.endpoint}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contract version</dt>
                <dd className="font-mono text-xs text-foreground">
                  {integration.activeContractVersion}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Integration path</dt>
                <dd className="font-mono text-xs text-foreground">
                  {integration.integrationPath}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Test command</dt>
                <dd className="font-mono text-xs text-foreground">
                  {integration.testCommand}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Watched docs</dt>
                <dd>
                  <a
                    href={integration.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
                  >
                    {integration.docsUrl}
                    <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                  </a>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SettingsView({
  overview,
  dark,
  onToggleTheme,
  busy,
  onResetDemo,
}: {
  overview: NonNullable<Overview>;
  dark: boolean;
  onToggleTheme: () => void;
  busy: boolean;
  onResetDemo: () => void;
}) {
  const { product, integrations } = overview;
  const integration = integrations[0];
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className={panelHeader}>
          <CardTitle className={panelTitle}>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[13px] text-foreground">Theme</p>
            <p className="text-xs text-muted-foreground">
              Currently using the {dark ? "dark" : "light"} theme.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onToggleTheme}>
            {dark ? (
              <Sun aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <Moon aria-hidden className="h-3.5 w-3.5" />
            )}
            Switch to {dark ? "light" : "dark"}
          </Button>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className={panelHeader}>
          <CardTitle className={panelTitle}>Product</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="mt-0.5 text-foreground">{product.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="mt-0.5 font-mono text-xs text-foreground">
                {product.repo ?? "Observer mode (no repo)"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className={panelHeader}>
          <CardTitle className={panelTitle}>Demo controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          {integration ? (
            <Button variant="outline" size="sm" asChild>
              <a href={integration.docsUrl} target="_blank" rel="noreferrer">
                Open Stripe docs
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onResetDemo}
          >
            {busy ? (
              <RefreshCw aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            )}
            Reset demo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function Dashboard4() {
  const overview: Overview | undefined = useQuery(api.dashboard.overview);
  const resetDemo = useMutation(api.demo.resetDemo);

  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { dark, toggle: toggleTheme } = useTheme();

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
        Loading Kevin…
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

  const { product, incidents } = overview;
  const openIncidents = incidents.filter(
    (incident) =>
      !["not_impacted", "repair_proposed", "repair_failed"].includes(
        incident.status,
      ),
  );

  return (
    <div className="relative flex h-dvh min-h-[720px] w-full overflow-hidden bg-background text-foreground">
      <Sidebar
        view={view}
        onNavigate={setView}
        openIncidentCount={openIncidents.length}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-sm font-medium text-foreground">
              {VIEW_TITLE[view]}
            </h1>
            <span className="hidden items-center gap-1.5 truncate text-[13px] text-muted-foreground sm:inline-flex">
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
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="mr-1.5 hidden h-8 w-56 items-center gap-2 rounded-lg border border-input bg-muted px-2.5 md:flex">
              <Search
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
              <Input
                type="search"
                placeholder="Search incidents…"
                aria-label="Search incidents"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (
                    e.target.value &&
                    (view === "integrations" || view === "settings")
                  ) {
                    setView("incidents");
                  }
                }}
                className="h-7 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
              />
            </div>
            <Badge
              variant="secondary"
              className="hidden items-center gap-1.5 font-normal sm:inline-flex"
            >
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              Live via Convex
            </Badge>
            <Separator
              orientation="vertical"
              className="mx-1 hidden h-4 sm:block"
            />
            <NotificationsBell events={overview.events} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={toggleTheme}
            >
              {dark ? (
                <Sun aria-hidden className="h-4 w-4" />
              ) : (
                <Moon aria-hidden className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  aria-label="Account"
                  variant="ghost"
                  size="icon"
                  className="ml-1 rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground hover:bg-secondary/80"
                >
                  K
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium">
                      {product.name}
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {product.repo ?? "Observer mode"}
                    </span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView("settings")}>
                  <Settings aria-hidden className="h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme}>
                  {dark ? (
                    <Sun aria-hidden className="h-4 w-4" />
                  ) : (
                    <Moon aria-hidden className="h-4 w-4" />
                  )}
                  Toggle theme
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {view === "dashboard" ? (
            <DashboardView
              overview={overview}
              search={search}
              busy={busy}
              onResetDemo={() => void handleReset()}
            />
          ) : view === "incidents" ? (
            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className={panelHeader}>
                <CardTitle className={panelTitle}>API incidents</CardTitle>
                <CardAction className={countBadge}>
                  {incidents.length}
                </CardAction>
              </CardHeader>
              <IncidentList incidents={incidents} search={search} />
            </Card>
          ) : view === "integrations" ? (
            <IntegrationsView overview={overview} />
          ) : (
            <SettingsView
              overview={overview}
              dark={dark}
              onToggleTheme={toggleTheme}
              busy={busy}
              onResetDemo={() => void handleReset()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
