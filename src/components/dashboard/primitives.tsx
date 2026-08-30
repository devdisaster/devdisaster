import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "./hooks";

export function StatusDot({ className }: { className: string }) {
  return (
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", className)} />
  );
}

export function Pill({
  dot,
  children,
}: {
  dot?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant="secondary" className="h-5 gap-1 px-2 text-xs font-medium">
      {dot ? <StatusDot className={dot} /> : null}
      {children}
    </Badge>
  );
}

export function PrLink({ session }: { session: SessionSummary | null }) {
  if (!session?.prUrl) {
    return <span className="text-[13px] text-muted-foreground">No PR yet</span>;
  }
  return (
    <a
      href={session.prUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[13px] text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {session.prNumber ? `PR #${session.prNumber}` : "View PR"}
      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
    </a>
  );
}

export function PanelEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-[13px] text-muted-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground/70">{hint}</p> : null}
    </div>
  );
}

export function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-1.5 p-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-11 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base font-medium">{title}</SheetTitle>
          {subtitle ? (
            <SheetDescription className="text-xs">
              {subtitle}
            </SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
