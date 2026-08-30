"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Bell,
  ExternalLink,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Plug,
  Search,
  Settings,
  ShieldAlert,
  Sun,
} from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { timeAgo } from "@/lib/format";
import { useOverview, useSignals } from "../dashboard/hooks";
import { Pipeline } from "../dashboard/Pipeline";
import { SignalsFeed } from "../dashboard/SignalsFeed";
import { IncidentsPanel } from "../dashboard/IncidentsPanel";
import { IncidentDrawer } from "../dashboard/IncidentDrawer";
import { ClustersPanel } from "../dashboard/ClustersPanel";
import { OnboardingForm } from "../dashboard/OnboardingForm";
import { DemoControls } from "../dashboard/DemoControls";
import { PanelEmpty, StatusDot } from "../dashboard/primitives";
import { AMBER_DOT, GREEN_DOT, NEUTRAL_DOT, RED_DOT } from "../dashboard/status";

type View = "dashboard" | "incidents" | "integrations" | "feedback" | "settings";

const NAV_ITEMS: { view: View; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "incidents", label: "Incidents", icon: ShieldAlert },
  { view: "integrations", label: "Integrations", icon: Plug },
  { view: "feedback", label: "Feedback", icon: MessageSquare },
  { view: "settings", label: "Settings", icon: Settings },
];

const VIEW_TITLE: Record<View, string> = {
  dashboard: "Dashboard",
  incidents: "Incidents",
  integrations: "Integrations",
  feedback: "Feedback clusters",
  settings: "Settings",
};

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

function useTheme() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
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
  useEffect(() => {
    try {
      if (localStorage.getItem("theme") === "dark") {
        document.documentElement.classList.add("dark");
        setDark(true);
      }
    } catch {
      // ignore
    }
  }, []);
  return { dark, toggle };
}

function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-border bg-muted/40 lg:w-52">
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-border px-2 lg:justify-start lg:px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
          S
        </span>
        <span className="ml-2.5 hidden text-[15px] font-medium tracking-[-0.015em] text-foreground lg:inline">
          Sentinel
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_ITEMS.map(({ view: itemView, label, icon: Icon }) => {
          const active = view === itemView;
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
              <span className="hidden lg:inline">{label}</span>
            </Button>
          );
        })}
      </nav>
      <div className="border-t border-border p-2">
        <div className="flex items-center justify-center gap-2.5 rounded-lg px-0 py-1.5 lg:justify-start lg:px-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
            DD
          </span>
          <span className="hidden min-w-0 flex-col lg:flex">
            <span className="truncate text-[13px] font-medium text-foreground">
              Dev Disaster
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              dev@invoicepilot.io
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}

function NotificationsBell() {
  const signals = useSignals();
  const recent = signals?.slice(0, 5) ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell aria-hidden className="h-4 w-4" />
          {recent.length > 0 ? (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">
          Recent signals
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            No signals yet — monitoring.
          </p>
        ) : (
          <ul className="flex flex-col p-1">
            {recent.map((signal) => (
              <li
                key={signal._id}
                className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted"
              >
                <StatusDot
                  className={`mt-1.5 ${
                    signal.kind === "runtime"
                      ? RED_DOT
                      : signal.isBreaking
                        ? AMBER_DOT
                        : NEUTRAL_DOT
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-foreground line-clamp-2">
                    {signal.summary}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {signal.kind === "docs" ? "Docs change" : "Runtime failure"} ·{" "}
                    {timeAgo(signal.at)}
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

function IntegrationsView({
  overview,
}: {
  overview: ReturnType<typeof useOverview>;
}) {
  const integration = overview?.integration ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex h-12 flex-row items-center justify-between gap-3 bg-muted/60 py-0">
          <CardTitle className="text-sm font-medium text-foreground">
            Registered integration
          </CardTitle>
          {integration ? (
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <StatusDot className={integration.enabled ? GREEN_DOT : NEUTRAL_DOT} />
              {integration.enabled ? "Watching" : "Disabled"}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {integration ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name · provider</dt>
                <dd className="mt-0.5 text-foreground">
                  {integration.name} · {integration.provider}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">
                  {integration.endpoint}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active contract version</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">
                  v{integration.activeContractVersion}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Integration path</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">
                  {integration.integrationPath}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Context.dev monitor</dt>
                <dd className="mt-0.5 text-foreground">
                  {integration.monitorConfigured ? "Configured" : "Not configured yet"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Watched docs</dt>
                <dd className="mt-0.5">
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
          ) : (
            <PanelEmpty
              title="No integration registered"
              hint="Register a product with an API integration below to start watching."
            />
          )}
        </CardContent>
      </Card>
      <OnboardingForm />
    </div>
  );
}

function SettingsView({
  overview,
  dark,
  onToggleTheme,
}: {
  overview: ReturnType<typeof useOverview>;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="flex h-12 flex-row items-center bg-muted/60 py-0">
          <CardTitle className="text-sm font-medium text-foreground">
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
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
      <Card className="overflow-hidden">
        <CardHeader className="flex h-12 flex-row items-center bg-muted/60 py-0">
          <CardTitle className="text-sm font-medium text-foreground">
            Product
          </CardTitle>
        </CardHeader>
        <CardContent>
          {overview?.product ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="mt-0.5 text-foreground">{overview.product.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Repository</dt>
                <dd className="mt-0.5 font-mono text-xs text-foreground">
                  {overview.product.repo ?? "Observer mode (no repo)"}
                </dd>
              </div>
            </dl>
          ) : (
            <PanelEmpty title="No product registered yet" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard4() {
  const {
    ref: bodyRef,
    edges: bodyEdges,
    onScroll: handleBodyScroll,
  } = useScrollFade<HTMLDivElement>();
  const overview = useOverview();
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [openIncidentId, setOpenIncidentId] = useState<Id<"incidents"> | null>(
    null,
  );
  const { dark, toggle: toggleTheme } = useTheme();

  return (
    <div className="relative flex h-dvh min-h-[720px] w-full overflow-hidden bg-background text-foreground">
      <Sidebar view={view} onNavigate={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-sm font-medium text-foreground">
              {VIEW_TITLE[view]}
            </h1>
            {overview?.product ? (
              <span className="hidden items-center gap-1.5 truncate text-[13px] text-muted-foreground sm:inline-flex">
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
            <div className="mr-1.5 hidden h-8 w-56 items-center gap-2 rounded-lg border border-input bg-muted px-2.5 md:flex">
              <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search incidents…"
                aria-label="Search incidents"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (e.target.value && view !== "incidents" && view !== "dashboard") {
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
              <StatusDot className={GREEN_DOT} />
              Live via Convex
            </Badge>
            <Separator orientation="vertical" className="mx-1 hidden h-4 sm:block" />
            <NotificationsBell />
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
                  DD
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium">Dev Disaster</span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      dev@invoicepilot.io
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

        <div className="relative min-h-0 flex-1">
          <div
            ref={bodyRef}
            onScroll={handleBodyScroll}
            className="h-full overflow-y-auto p-4 sm:p-6"
          >
            {view === "dashboard" ? (
              <>
                <DemoControls />
                <Pipeline overview={overview} onOpenIncident={setOpenIncidentId} />
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SignalsFeed onOpenIncident={setOpenIncidentId} />
                  <IncidentsPanel
                    onOpenIncident={setOpenIncidentId}
                    search={search}
                  />
                </div>
              </>
            ) : view === "incidents" ? (
              <IncidentsPanel onOpenIncident={setOpenIncidentId} search={search} />
            ) : view === "integrations" ? (
              <IntegrationsView overview={overview} />
            ) : view === "feedback" ? (
              <ClustersPanel />
            ) : (
              <SettingsView
                overview={overview}
                dark={dark}
                onToggleTheme={toggleTheme}
              />
            )}
          </div>

          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent transition-opacity duration-200 ease-out",
              bodyEdges.start ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent transition-opacity duration-200 ease-out",
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
