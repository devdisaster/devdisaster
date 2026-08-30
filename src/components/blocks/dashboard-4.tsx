"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

import {
  Bell,
  CircleHelp,
  LayoutDashboard,
  Plug,
  Search,
  Settings,
  ShieldAlert,
  FileBarChart,
} from "lucide-react";

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

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Incidents", icon: ShieldAlert, active: false },
  { label: "Integrations", icon: Plug, active: false },
  { label: "Reports", icon: FileBarChart, active: false },
  { label: "Settings", icon: Settings, active: false },
];

function Sidebar() {
  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/60 lg:w-52 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-neutral-200 px-2 lg:justify-start lg:px-4 dark:border-neutral-800">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--rb-r-md,8px)] bg-neutral-900 text-[13px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
          S
        </span>
        <span className="ml-2.5 hidden text-[15px] font-medium tracking-[-0.015em] text-neutral-900 lg:inline dark:text-neutral-100">
          Sentinel
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-9 cursor-pointer items-center justify-center gap-2.5 rounded-[var(--rb-r-md,8px)] px-0 text-[13px] font-medium transition-colors duration-150 lg:justify-start lg:px-2.5",
              active
                ? "bg-neutral-200/70 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
            )}
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </nav>
      <div className="border-t border-neutral-200 p-2 dark:border-neutral-800">
        <div className="flex items-center justify-center gap-2.5 rounded-[var(--rb-r-md,8px)] px-0 py-1.5 lg:justify-start lg:px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
            DD
          </span>
          <span className="hidden min-w-0 flex-col lg:flex">
            <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
              Dev Disaster
            </span>
            <span className="truncate text-[11px] text-neutral-500">
              dev@invoicepilot.io
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function HeaderIconButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
    >
      {children}
    </button>
  );
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
    <div className="relative flex h-full min-h-[720px] w-full overflow-hidden bg-white dark:bg-neutral-950">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-4 sm:px-6 dark:border-neutral-800">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Dashboard
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
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="mr-1.5 hidden h-8 w-56 items-center gap-2 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-neutral-50 px-2.5 md:flex dark:border-neutral-800 dark:bg-neutral-900">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <input
                type="search"
                placeholder="Search incidents…"
                aria-label="Search"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100"
              />
              <kbd className="shrink-0 rounded-[var(--rb-r-xs,4px)] bg-neutral-200/70 px-1 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800">
                ⌘K
              </kbd>
            </div>
            <span className="hidden items-center gap-1.5 text-[13px] text-neutral-500 sm:inline-flex">
              <StatusDot className={GREEN_DOT} />
              Live via Convex
            </span>
            <span
              aria-hidden
              className="mx-1 hidden h-4 w-px bg-neutral-200 sm:block dark:bg-neutral-800"
            />
            <HeaderIconButton label="Notifications">
              <Bell aria-hidden className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </HeaderIconButton>
            <HeaderIconButton label="Help">
              <CircleHelp aria-hidden className="h-4 w-4" />
            </HeaderIconButton>
            <HeaderIconButton label="Settings">
              <Settings aria-hidden className="h-4 w-4" />
            </HeaderIconButton>
            <button
              type="button"
              aria-label="Account"
              className="ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold text-neutral-700 transition-opacity hover:opacity-80 dark:bg-neutral-700 dark:text-neutral-200"
            >
              DD
            </button>
          </div>
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
      </div>

      <IncidentDrawer
        incidentId={openIncidentId}
        onClose={() => setOpenIncidentId(null)}
      />
    </div>
  );
}
