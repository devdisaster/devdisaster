import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { useSignals, type Signal } from "./hooks";
import { AMBER_DOT, NEUTRAL_DOT, RED_DOT } from "./status";
import { PanelEmpty, PanelLoading, Pill, StatusDot } from "./primitives";

function signalDot(signal: Signal) {
  if (signal.kind === "runtime") return RED_DOT;
  return signal.isBreaking ? AMBER_DOT : NEUTRAL_DOT;
}

function SignalRow({
  signal,
  onOpenIncident,
}: {
  signal: Signal;
  onOpenIncident: (incidentId: Id<"incidents">) => void;
}) {
  const meta =
    signal.kind === "docs"
      ? [
          signal.isBreaking ? "Breaking" : "Non-breaking",
          ...(signal.affectedEndpoints?.length
            ? [signal.affectedEndpoints.join(", ")]
            : []),
        ]
      : [
          signal.endpoint ?? "unknown endpoint",
          ...(signal.contractVersion ? [`v${signal.contractVersion}`] : []),
        ];
  const body = (
    <>
      <StatusDot className={`mt-1.5 ${signalDot(signal)}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] whitespace-normal text-neutral-900 line-clamp-2 dark:text-neutral-100">
          {signal.summary}
        </p>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {meta.join(" · ")} · {timeAgo(signal.at)}
        </p>
      </div>
      <span className="shrink-0 self-start">
        <Pill dot={signal.kind === "runtime" ? RED_DOT : AMBER_DOT}>
          {signal.kind === "docs" ? "Docs" : "Runtime"}
        </Pill>
      </span>
    </>
  );

  if (!signal.incidentId) {
    return (
      <li className="flex min-h-11 items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/50">
        {body}
      </li>
    );
  }
  const incidentId = signal.incidentId;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenIncident(incidentId)}
        aria-label={`Open incident for signal: ${signal.summary}`}
        className="flex w-full min-h-11 cursor-pointer items-start gap-2.5 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-neutral-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800/50 dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
      >
        {body}
      </button>
    </li>
  );
}

export function SignalsFeed({
  onOpenIncident,
}: {
  onOpenIncident: (incidentId: Id<"incidents">) => void;
}) {
  const signals = useSignals();
  return (
    <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-12 items-center justify-between bg-neutral-50 px-4 dark:bg-neutral-900/60">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Detected changes
        </h2>
        {signals !== undefined ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {signals.length}
          </span>
        ) : null}
      </div>
      {signals === undefined ? (
        <PanelLoading rows={4} />
      ) : signals.length === 0 ? (
        <PanelEmpty
          title="Watching — no changes yet"
          hint="Docs changes and runtime failures appear here the moment they are detected."
        />
      ) : (
        <ul className="flex flex-col gap-1.5 p-1.5">
          {signals.map((signal) => (
            <SignalRow
              key={signal._id}
              signal={signal}
              onOpenIncident={onOpenIncident}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
