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
          <p className="text-[13px] text-neutral-500">
            No trigger events recorded for this incident.
          </p>
        ) : (
          triggers.map((trigger) => (
            <div key={trigger._id} className="rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between gap-2">
                <Pill dot={trigger.source === "runtime" ? RED_DOT : AMBER_DOT}>
                  {trigger.source === "docs" ? "Docs change" : "Runtime failure"}
                </Pill>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {timestampLabel(trigger.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-neutral-700 dark:text-neutral-300">
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
              <dt className="text-neutral-500">Provider · endpoint</dt>
              <dd className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
                {integration.provider} {integration.endpoint}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Integration path</dt>
              <dd className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
                {integration.integrationPath}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-500">Expected contract</dt>
              <dd className="text-neutral-700 dark:text-neutral-300">
                {integration.expectedContract}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-[13px] text-neutral-500">
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
            <span className="font-mono text-xs text-neutral-500">
              {incident.endpoint}
            </span>
          ) : null}
        </div>
        {incident.reason ? (
          <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
            {incident.reason}
          </p>
        ) : (
          <p className="text-[13px] text-neutral-500">
            Diagnosis has not produced a reason yet.
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Docs evidence">
        {docChanges.length === 0 && incident.docsEvidence.length === 0 ? (
          <p className="text-[13px] text-neutral-500">No docs evidence attached.</p>
        ) : (
          <>
            {docChanges.map((change) => (
              <div key={change._id} className="rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
                <div className="flex items-center justify-between gap-2">
                  <Pill dot={change.isBreaking ? RED_DOT : NEUTRAL_DOT}>
                    {change.isBreaking ? "Breaking" : "Non-breaking"}
                  </Pill>
                  <a
                    href={change.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300"
                  >
                    Source docs
                    <ExternalLink aria-hidden className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-1.5 text-[13px] text-neutral-700 dark:text-neutral-300">
                  {change.summary}
                </p>
                {change.affectedEndpoints.length ? (
                  <p className="mt-1 font-mono text-[11px] text-neutral-500">
                    {change.affectedEndpoints.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
            {incident.docsEvidence.map((line, i) => (
              <p key={i} className="text-[13px] text-neutral-700 dark:text-neutral-300">
                {line}
              </p>
            ))}
          </>
        )}
      </DrawerSection>

      <DrawerSection title="Adapter / code evidence">
        {incident.codeEvidence.length === 0 ? (
          <p className="text-[13px] text-neutral-500">No code evidence attached.</p>
        ) : (
          incident.codeEvidence.map((line, i) => (
            <pre
              key={i}
              className="overflow-x-auto rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-300"
            >
              {line}
            </pre>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Runtime corroboration">
        {errors.length === 0 ? (
          <p className="text-[13px] text-neutral-500">
            No runtime failures attached to this incident.
          </p>
        ) : (
          errors.map((error) => (
            <div key={error._id} className="rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-neutral-500">
                  {error.endpoint ?? "unknown endpoint"}
                  {error.statusCode ? ` · ${error.statusCode}` : ""}
                  {error.contractVersion ? ` · v${error.contractVersion}` : ""}
                </span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {timestampLabel(error.at)}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-neutral-700 dark:text-neutral-300">
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
              <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
                {session.testSummary}
              </p>
            ) : null}
            {session.devinUrl ? (
              <a
                href={session.devinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[13px] text-neutral-600 underline underline-offset-2 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Open Devin session
                <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-neutral-500">
            No Devin session yet — repairs launch only after an impacted verdict.
          </p>
        )}
      </DrawerSection>

      <DrawerSection title="Timeline">
        {timeline.length === 0 ? (
          <p className="text-[13px] text-neutral-500">No events recorded.</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l border-neutral-200 pl-4 dark:border-neutral-800">
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
                <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
                  {event.message}
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-neutral-500">
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
