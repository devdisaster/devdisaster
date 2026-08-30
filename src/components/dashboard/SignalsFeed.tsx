import type { Id } from "../../../convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { useSignals, type Signal } from "./hooks";
import { AMBER_DOT, NEUTRAL_DOT, RED_DOT } from "./status";
import { PanelEmpty, PanelLoading, Pill, StatusDot } from "./primitives";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
        <p className="whitespace-normal text-[13px] text-foreground line-clamp-2">
          {signal.summary}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
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
      <li className="flex min-h-11 items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5">
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
        className={cn(
          "flex w-full min-h-11 cursor-pointer items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
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
    <Card className="overflow-hidden">
      <CardHeader className="flex h-12 flex-row items-center justify-between gap-3 bg-muted/60 py-0">
        <CardTitle className="text-sm font-medium text-foreground">
          Detected changes
        </CardTitle>
        {signals !== undefined ? (
          <CardAction className="inline-flex h-5 shrink-0 items-center rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-secondary-foreground">
            {signals.length}
          </CardAction>
        ) : null}
      </CardHeader>
      {signals === undefined ? (
        <CardContent className="p-1.5">
          <PanelLoading rows={4} />
        </CardContent>
      ) : signals.length === 0 ? (
        <CardContent className="p-0">
          <PanelEmpty
            title="Watching — no changes yet"
            hint="Docs changes and runtime failures appear here the moment they are detected."
          />
        </CardContent>
      ) : (
        <CardContent className="p-1.5">
          <ul className="flex flex-col gap-1.5">
            {signals.map((signal) => (
              <SignalRow
                key={signal._id}
                signal={signal}
                onOpenIncident={onOpenIncident}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
