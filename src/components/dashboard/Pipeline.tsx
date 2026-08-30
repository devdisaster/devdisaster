import { ChevronRight, ExternalLink } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Overview } from "./hooks";
import {
  incidentStatus,
  sessionStatusLabel,
  AMBER_DOT,
  GREEN_DOT,
  NEUTRAL_DOT,
  RED_DOT,
  testDot,
  VERDICT_LABEL,
} from "./status";
import { PrLink, StatusDot } from "./primitives";

type StageState = "idle" | "active" | "done" | "failed";

const STATE_DOT: Record<StageState, string> = {
  idle: NEUTRAL_DOT,
  active: AMBER_DOT,
  done: GREEN_DOT,
  failed: RED_DOT,
};

function StageCard({
  step,
  title,
  state,
  onClick,
  children,
}: {
  step: number;
  title: string;
  state: StageState;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative h-full rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900",
        onClick &&
          "transition-colors duration-150 has-[button:hover]:bg-neutral-50 dark:has-[button:hover]:bg-neutral-800/50",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={`Open incident details from stage: ${title}`}
          className="absolute inset-0 cursor-pointer rounded-[var(--rb-r-lg,10px)] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
        />
      ) : null}
      <div className="pointer-events-none relative">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13px] text-neutral-500">
            <span className="tabular-nums">{step}</span> · {title}
          </p>
          <StatusDot
            className={cn(
              STATE_DOT[state],
              state === "active" && "animate-pulse motion-reduce:animate-none",
            )}
          />
        </div>
        <div className="mt-2 flex min-h-16 flex-col gap-1 [&_a]:pointer-events-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function StageConnector() {
  return (
    <ChevronRight
      aria-hidden
      className="pointer-events-none absolute top-1/2 -right-[13px] z-10 hidden h-4 w-4 -translate-y-1/2 text-neutral-300 lg:block dark:text-neutral-700"
    />
  );
}

const line = "truncate text-[13px] text-neutral-900 dark:text-neutral-100";
const subline = "truncate text-xs text-neutral-500";

export function Pipeline({
  overview,
  onOpenIncident,
}: {
  overview: Overview | undefined;
  onOpenIncident: (incidentId: Id<"incidents">) => void;
}) {
  if (overview === undefined) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading pipeline"
        className="grid grid-cols-1 gap-1 rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 sm:grid-cols-2 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-950"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white motion-reduce:animate-none dark:border-neutral-800 dark:bg-neutral-900"
          />
        ))}
      </div>
    );
  }

  const integration = overview?.integration ?? null;
  const change = overview?.latestChange ?? null;
  const incident = overview?.currentIncident ?? null;
  const session = incident?.session ?? null;

  const watchingState: StageState = integration
    ? integration.enabled
      ? "done"
      : "idle"
    : "idle";

  const changeState: StageState = change
    ? change.isBreaking
      ? "failed"
      : "done"
    : integration
      ? "active"
      : "idle";

  const verdictState: StageState = !incident
    ? "idle"
    : incident.verdict === "impacted"
      ? "failed"
      : incident.verdict
        ? "done"
        : incident.active
          ? "active"
          : "idle";

  const repairState: StageState = !session
    ? "idle"
    : incident?.status === "repair_failed"
      ? "failed"
      : incident?.status === "repair_proposed"
        ? "done"
        : "active";

  return (
    <div className="grid grid-cols-1 gap-1 rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 sm:grid-cols-2 lg:grid-cols-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="relative">
        <StageCard step={1} title="Watching" state={watchingState}>
          {integration ? (
            <>
              <p className={line}>
                {integration.name}
                <span className="ml-1.5 text-neutral-500">
                  · {integration.provider}
                </span>
              </p>
              <p className="truncate font-mono text-[11px] text-neutral-500">
                {integration.endpoint} · v{integration.activeContractVersion}
              </p>
              <p className={subline}>
                {integration.monitorConfigured
                  ? "Context.dev monitor active"
                  : "Monitor not configured yet"}
              </p>
              <a
                href={integration.docsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
              >
                Watched docs
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            </>
          ) : (
            <p className={subline}>No integration registered.</p>
          )}
        </StageCard>
        <StageConnector />
      </div>

      <div className="relative">
        <StageCard
          step={2}
          title="Change detected"
          state={changeState}
          onClick={
            change?.incidentId
              ? () => onOpenIncident(change.incidentId!)
              : undefined
          }
        >
          {change ? (
            <>
              <p className={cn(line, "whitespace-normal line-clamp-2")}>
                {change.summary}
              </p>
              <p className={subline}>
                {change.isBreaking ? "Breaking" : "Non-breaking"} ·{" "}
                {timeAgo(change.at)}
                {change.affectedEndpoints.length
                  ? ` · ${change.affectedEndpoints.join(", ")}`
                  : ""}
              </p>
            </>
          ) : (
            <p className={subline}>
              {integration
                ? "No changes detected — monitoring."
                : "Waiting for an integration to watch."}
            </p>
          )}
        </StageCard>
        <StageConnector />
      </div>

      <div className="relative">
        <StageCard
          step={3}
          title="Impact verdict"
          state={verdictState}
          onClick={incident ? () => onOpenIncident(incident._id) : undefined}
        >
          {incident ? (
            <>
              <p className={line}>
                {incident.verdict
                  ? (VERDICT_LABEL[incident.verdict] ?? incident.verdict)
                  : incidentStatus(incident.status).label}
              </p>
              <p className={cn(subline, "whitespace-normal line-clamp-2")}>
                {incident.reason ?? incident.title}
              </p>
            </>
          ) : (
            <p className={subline}>No incident under diagnosis.</p>
          )}
        </StageCard>
        <StageConnector />
      </div>

      <StageCard
        step={4}
        title="Devin repair"
        state={repairState}
        onClick={incident ? () => onOpenIncident(incident._id) : undefined}
      >
        {session ? (
          <>
            <p className={line}>{sessionStatusLabel(session.status)}</p>
            <p className={subline}>
              <StatusDot
                className={cn("mr-1 inline-block", testDot(session.testStatus))}
              />
              Tests: {session.testStatus ?? "not reported"}
            </p>
            <PrLink session={session} />
          </>
        ) : (
          <p className={subline}>
            {incident?.verdict === "impacted"
              ? "Repair queued — launching Devin."
              : "Launches only on an impacted verdict."}
          </p>
        )}
      </StageCard>
    </div>
  );
}
