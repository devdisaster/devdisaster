import type { ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ExternalLink, X } from "lucide-react";
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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--rb-r-xs,4px)] bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      {dot ? <StatusDot className={dot} /> : null}
      {children}
    </span>
  );
}

export function PrLink({ session }: { session: SessionSummary | null }) {
  if (!session?.prUrl) {
    return <span className="text-[13px] text-neutral-500">No PR yet</span>;
  }
  return (
    <a
      href={session.prUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-[13px] text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600"
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
      <p className="text-[13px] text-neutral-600 dark:text-neutral-400">
        {title}
      </p>
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-1.5 p-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-11 animate-pulse rounded-[var(--rb-r-lg,10px)] bg-neutral-100 motion-reduce:animate-none dark:bg-neutral-800/50"
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
    <section className="border-t border-neutral-100 px-4 py-3 first:border-t-0 dark:border-neutral-800/70">
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-950/30 backdrop-blur-[1px] dark:bg-neutral-950/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-neutral-200 bg-white shadow-xl focus:outline-none sm:w-[32rem] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {title}
              </Dialog.Title>
              {subtitle ? (
                <div className="mt-1 text-xs text-neutral-500">{subtitle}</div>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
            >
              <X aria-hidden className="h-4 w-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
