import { ExternalLink } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { timestampLabel } from "@/lib/format";
import { useIncidentDetail, type IncidentDetail } from "./hooks";
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
  Drawer,
  DrawerSection,
  PanelEmpty,
  PanelLoading,
  Pill,
  PrLink,
  StatusDot,
} from "./primitives";

function IncidentDrawerBody({
  detail,
}: {
  detail: IncidentDetail | undefined;
}) {
  if (detail === undefined) return <PanelLoading rows={5} />;
  if (detail === null) {
    return <PanelEmpty title="This incident no longer exists." />;
  }
  const { incident, integration, triggers, docChanges, errors, timeline, session } =
    detail;

  return (
    <>
      <DrawerSection title="Trigger received">
        {triggers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No trigger events recorded for this incident.
          </p>
        ) : (
          triggers.map((trigger) => (
            <div key={trigger._id} className="rounded-lg bg-muted px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Pill dot={trigger.source === "runtime" ? RED_DOT : AMBER_DOT}>
                  {trigger.source === "docs" ? "Docs change" : "Runtime failure"}
                </Pill>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {timestampLabel(trigger.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-foreground">
                {trigger.summary}
              </p>
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Context gathered">
        {integration ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Provider · endpoint</dt>
              <dd className="font-mono text-xs text-foreground">
                {integration.provider} {integration.endpoint}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Integration path</dt>
              <dd className="font-mono text-xs text-foreground">
                {integration.integrationPath}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Expected contract</dt>
              <dd className="text-foreground">
                {integration.expectedContract}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            The registered integration could not be loaded.
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Impact diagnosis">
        <div className="flex items-center gap-2">
          <Pill
            dot={
              incident.verdict === "impacted"
                ? RED_DOT
                : incident.verdict === "not_impacted"
                  ? GREEN_DOT
                  : AMBER_DOT
            }
          >
            {incident.verdict
              ? (VERDICT_LABEL[incident.verdict] ?? incident.verdict)
              : "No verdict yet"}
          </Pill>
          {incident.endpoint ? (
            <span className="font-mono text-xs text-muted-foreground">
              {incident.endpoint}
            </span>
          ) : null}
        </div>
        {incident.reason ? (
          <p className="text-[13px] text-foreground">
            {incident.reason}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Diagnosis has not produced a reason yet.
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Docs evidence">
        {docChanges.length === 0 && incident.docsEvidence.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No docs evidence attached.</p>
        ) : (
          <>
            {docChanges.map((change) => (
              <div key={change._id} className="rounded-lg bg-muted px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Pill dot={change.isBreaking ? RED_DOT : NEUTRAL_DOT}>
                    {change.isBreaking ? "Breaking" : "Non-breaking"}
                  </Pill>
                  <a
                    href={change.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Source docs
                    <ExternalLink aria-hidden className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-1.5 text-[13px] text-foreground">
                  {change.summary}
                </p>
                {change.affectedEndpoints.length ? (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {change.affectedEndpoints.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
            {incident.docsEvidence.map((line, i) => (
              <p key={i} className="text-[13px] text-foreground">
                {line}
              </p>
            ))}
          </>
        )}
      </DrawerSection>

      <DrawerSection title="Adapter / code evidence">
        {incident.codeEvidence.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No code evidence attached.</p>
        ) : (
          incident.codeEvidence.map((line, i) => (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground"
            >
              {line}
            </pre>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Runtime corroboration">
        {errors.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No runtime failures attached to this incident.
          </p>
        ) : (
          errors.map((error) => (
            <div key={error._id} className="rounded-lg bg-muted px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {error.endpoint ?? "unknown endpoint"}
                  {error.statusCode ? ` · ${error.statusCode}` : ""}
                  {error.contractVersion ? ` · v${error.contractVersion}` : ""}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {timestampLabel(error.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-foreground">
                {error.message}
              </p>
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Devin session">
        {session ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Pill dot={session.prUrl ? GREEN_DOT : AMBER_DOT}>
                {sessionStatusLabel(session.status)}
              </Pill>
              <Pill dot={testDot(session.testStatus)}>
                Tests: {session.testStatus ?? "not reported"}
              </Pill>
              <PrLink session={session} />
            </div>
            {session.testSummary ? (
              <p className="text-[13px] text-foreground">
                {session.testSummary}
              </p>
            ) : null}
            {session.devinUrl ? (
              <a
                href={session.devinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Open Devin session
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No Devin session yet — repairs launch only after an impacted verdict.
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Timeline">
        {timeline.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No events recorded.</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
            {timeline.map((event) => (
              <li key={event._id} className="relative">
                <StatusDot
                  className={`absolute -left-[19.5px] top-1.5 ${
                    event.level === "critical"
                      ? RED_DOT
                      : event.level === "warn"
                        ? AMBER_DOT
                        : NEUTRAL_DOT
                  }`}
                />
                <p className="text-[13px] text-foreground">
                  {event.message}
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {timestampLabel(event.at)} · {event.sentinel}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DrawerSection>
    </>
  );
}

export function IncidentDrawer({
  incidentId,
  onClose,
}: {
  incidentId: Id<"incidents"> | null;
  onClose: () => void;
}) {
  const detail = useIncidentDetail(incidentId);
  const incident = detail?.incident;
  return (
    <Drawer
      open={incidentId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={incident?.title ?? "Incident"}
      subtitle={
        incident ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot className={incidentStatus(incident.status).dot} />
            {incidentStatus(incident.status).label} ·{" "}
            {timestampLabel(incident.createdAt)}
          </span>
        ) : undefined
      }
    >
      {incidentId ? <IncidentDrawerBody detail={detail} /> : null}
    </Drawer>
  );
}
