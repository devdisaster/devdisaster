// Demo bar: replays the Stripe 2022-11-15 story through the demo simulation
// module (convex/demo.ts). Visually separated from product UI. When Phase 2's
// real vendor/monitor handlers land, these buttons switch to calling them.
import { useState } from "react";
import { useMutation } from "convex/react";
import { RefreshCw, Zap } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 dark:bg-amber-950/10">
      <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Demo
      </Badge>
      <Button
        type="button"
        variant="outline"
        size="sm"
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
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await resetDemo({});
            return "Demo reset — contract back on 2022-08-01, monitoring.";
          })
        }
      >
        <RefreshCw aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        Reset demo
      </Button>
      {message ? (
        <p
          role="status"
          className={`min-w-0 flex-1 truncate text-[13px] ${
            message.error
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
