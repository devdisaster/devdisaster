import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { useIncidents, type IncidentRow } from "./hooks";
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
import {
  PanelEmpty,
  PanelLoading,
  Pill,
  PrLink,
  StatusDot,
} from "./primitives";

function IncidentRowItem({
  incident,
  onOpen,
}: {
  incident: IncidentRow;
  onOpen: () => void;
}) {
  const status = incidentStatus(incident.status);
  return (
    <li className="flex min-h-11 items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 transition-colors duration-150 hover:bg-neutral-100 dark:bg-neutral-800/50 dark:hover:bg-neutral-800">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-[var(--rb-r-sm,6px)] text-left focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
      >
        <StatusDot className={`mt-1.5 ${status.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-neutral-900 dark:text-neutral-100">
            {incident.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {status.label} · {timeAgo(incident.createdAt)}
            {incident.verdict
              ? ` · ${VERDICT_LABEL[incident.verdict] ?? incident.verdict}`
              : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {incident.sources.length === 0 ? (
              <Pill dot={NEUTRAL_DOT}>No trigger recorded</Pill>
            ) : (
              incident.sources.map((source) => (
                <Pill key={source} dot={source === "runtime" ? RED_DOT : AMBER_DOT}>
                  {source === "docs" ? "Docs" : "Runtime"}
                </Pill>
              ))
            )}
            {incident.session ? (
              <>
                <Pill dot={incident.session.prUrl ? GREEN_DOT : AMBER_DOT}>
                  Devin: {sessionStatusLabel(incident.session.status)}
                </Pill>
                {incident.session.testStatus ? (
                  <Pill dot={testDot(incident.session.testStatus)}>
                    Tests {incident.session.testStatus}
                  </Pill>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </button>
      <span className="shrink-0 self-center">
        <PrLink session={incident.session} />
      </span>
    </li>
  );
}

export function IncidentsPanel({
  onOpenIncident,
}: {
  onOpenIncident: (incidentId: Id<"incidents">) => void;
}) {
  const incidents = useIncidents();

  return (
    <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-12 items-center justify-between bg-neutral-50 px-4 dark:bg-neutral-900/60">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          API incidents
        </h2>
        {incidents !== undefined ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {incidents.length}
          </span>
        ) : null}
      </div>
      {incidents === undefined ? (
        <PanelLoading rows={4} />
      ) : incidents.length === 0 ? (
        <PanelEmpty
          title="No incidents yet"
          hint="Docs changes and runtime failures will open incidents here."
        />
      ) : (
        <ul className="flex flex-col gap-1.5 p-1.5">
          {incidents.map((incident) => (
            <IncidentRowItem
              key={incident._id}
              incident={incident}
              onOpen={() => onOpenIncident(incident._id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
