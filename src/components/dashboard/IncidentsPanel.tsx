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
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

function IncidentRowItem({
  incident,
  onOpen,
}: {
  incident: IncidentRow;
  onOpen: () => void;
}) {
  const status = incidentStatus(incident.status);
  return (
    <li className="flex min-h-11 items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5 transition-colors duration-150 hover:bg-muted/80">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <StatusDot className={`mt-1.5 ${status.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground">
            {incident.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
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
  search = "",
}: {
  onOpenIncident: (incidentId: Id<"incidents">) => void;
  search?: string;
}) {
  const allIncidents = useIncidents();
  const query = search.trim().toLowerCase();
  const incidents =
    allIncidents === undefined
      ? undefined
      : query
        ? allIncidents.filter((incident) => {
            const status = incidentStatus(incident.status).label;
            return (
              incident.title.toLowerCase().includes(query) ||
              status.toLowerCase().includes(query) ||
              (incident.verdict ?? "").toLowerCase().includes(query)
            );
          })
        : allIncidents;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex h-12 flex-row items-center justify-between gap-3 bg-muted/60 py-0">
        <CardTitle className="text-sm font-medium text-foreground">
          API incidents
        </CardTitle>
        {incidents !== undefined ? (
          <CardAction className="inline-flex h-5 shrink-0 items-center rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
            {incidents.length}
          </CardAction>
        ) : null}
      </CardHeader>
      {incidents === undefined ? (
        <CardContent className="p-1.5">
          <PanelLoading rows={4} />
        </CardContent>
      ) : incidents.length === 0 ? (
        <CardContent className="p-0">
          <PanelEmpty
            title={query ? `No incidents match "${search.trim()}"` : "No incidents yet"}
            hint={
              query
                ? "Try a different title, status, or verdict."
                : "Docs changes and runtime failures will open incidents here."
            }
          />
        </CardContent>
      ) : (
        <CardContent className="p-1.5">
          <ul className="flex flex-col gap-1.5">
            {incidents.map((incident) => (
              <IncidentRowItem
                key={incident._id}
                incident={incident}
                onOpen={() => onOpenIncident(incident._id)}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
