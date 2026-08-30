"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

import type { Id } from "../../../convex/_generated/dataModel";
import { useOverview } from "../dashboard/hooks";
import { Pipeline } from "../dashboard/Pipeline";
import { SignalsFeed } from "../dashboard/SignalsFeed";
import { IncidentsPanel } from "../dashboard/IncidentsPanel";
import { IncidentDrawer } from "../dashboard/IncidentDrawer";
import { DemoControls } from "../dashboard/DemoControls";
import { StatusDot } from "../dashboard/primitives";
import { AMBER_DOT, GREEN_DOT } from "../dashboard/status";

function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

export default function Dashboard4() {
  const {
    ref: bodyRef,
    edges: bodyEdges,
    onScroll: handleBodyScroll,
  } = useScrollFade<HTMLDivElement>();
  const overview = useOverview();
  const [openIncidentId, setOpenIncidentId] = useState<Id<"incidents"> | null>(
    null,
  );

  return (
    <div className="relative flex h-full min-h-[720px] w-full flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 sm:px-6 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-xl font-medium tracking-[-0.015em] text-neutral-900 dark:text-neutral-100">
            Sentinel
          </h1>
          {overview?.product ? (
            <span className="hidden items-center gap-1.5 truncate text-[13px] text-neutral-600 sm:inline-flex dark:text-neutral-400">
              <StatusDot
                className={overview.openIncidents > 0 ? AMBER_DOT : GREEN_DOT}
              />
              {overview.product.name} ·{" "}
              {overview.openIncidents === 0
                ? "no open incidents"
                : `${overview.openIncidents} incident${
                    overview.openIncidents === 1 ? "" : "s"
                  } open`}
            </span>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-neutral-500">
          <StatusDot className={GREEN_DOT} />
          Live via Convex
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={bodyRef}
          onScroll={handleBodyScroll}
          className="h-full overflow-y-auto p-4 sm:p-6"
        >
          <DemoControls />

          <Pipeline overview={overview} onOpenIncident={setOpenIncidentId} />

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SignalsFeed onOpenIncident={setOpenIncidentId} />
            <IncidentsPanel onOpenIncident={setOpenIncidentId} />
          </div>
        </div>

        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
            bodyEdges.start ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
            bodyEdges.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      <IncidentDrawer
        incidentId={openIncidentId}
        onClose={() => setOpenIncidentId(null)}
      />
    </div>
  );
}
