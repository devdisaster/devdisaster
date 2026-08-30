// Demo bar: replays the Stripe 2022-11-15 story through the demo simulation
// module (convex/demo.ts). Visually separated from product UI. When Phase 2's
// real vendor/monitor handlers land, these buttons switch to calling them.
import { useState } from "react";
import { useMutation } from "convex/react";
import { RefreshCw, Zap } from "lucide-react";
import { api } from "../../../convex/_generated/api";

const buttonClass =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white px-2.5 text-[13px] font-medium text-neutral-900 transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-neutral-300 hover:bg-neutral-50 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]";

export function DemoControls() {
  const triggerUpgrade = useMutation(api.demo.triggerStripeUpgrade);
  const resetDemo = useMutation(api.demo.reset);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await action(), error: false });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Demo action failed",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--rb-r-2xl,14px)] border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-950/10">
      <span className="rounded-[var(--rb-r-xs,4px)] bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        Demo
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await triggerUpgrade({});
            return result.status === "started"
              ? "Stripe docs upgraded to 2022-11-15 — change detected, pipeline running."
              : "An incident for this change is already running.";
          })
        }
      >
        <Zap aria-hidden className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        Trigger Stripe docs change
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await resetDemo({});
            return "Demo reset — contract back on 2022-08-01, monitoring.";
          })
        }
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5 text-neutral-500" />
        Reset demo
      </button>
      {message ? (
        <p
          role="status"
          className={`min-w-0 flex-1 truncate text-[13px] ${
            message.error
              ? "text-red-600 dark:text-red-400"
              : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
