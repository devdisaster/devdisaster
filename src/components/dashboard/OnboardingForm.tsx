import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const inputClass =
  "h-9 w-full rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]";

const labelClass = "text-xs font-medium text-neutral-600 dark:text-neutral-400";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export function OnboardingForm() {
  const registerProduct = useMutation(api.onboarding.registerProduct);
  const [withIntegration, setWithIntegration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => (data.get(name) as string | null)?.trim() ?? "";
    const optional = (name: string) => text(name) || undefined;

    setBusy(true);
    setResult(null);
    try {
      const response = await registerProduct({
        name: text("name"),
        description: text("description"),
        repo: optional("repo"),
        subreddit: optional("subreddit"),
        feedbackUrl: optional("feedbackUrl"),
        threshold: Number(text("threshold") || "5"),
        integration: withIntegration
          ? {
              name: text("integrationName"),
              provider: text("provider"),
              docsUrl: text("docsUrl"),
              endpoint: text("endpoint"),
              integrationPath: text("integrationPath"),
              expectedContract: text("expectedContract"),
              testCommand: text("testCommand"),
            }
          : undefined,
      });
      setResult({
        text: `Registered product ${response.productId}${
          response.integrationId ? ` with integration ${response.integrationId}` : ""
        }. The dashboard stays pinned to the primary demo product.`,
        error: false,
      });
      form.reset();
      setWithIntegration(false);
    } catch (error) {
      setResult({
        text: error instanceof Error ? error.message : "Registration failed",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-12 items-center bg-neutral-50 px-4 dark:bg-neutral-900/60">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Onboard a product
        </h2>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Product name">
            <input name="name" required placeholder="InvoicePilot" className={inputClass} />
          </Field>
          <Field label="GitHub repository (optional — absent = observer mode)">
            <input name="repo" placeholder="org/repo" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <input
                name="description"
                required
                placeholder="What the product does — feeds clustering and Devin prompts"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Subreddit (optional)">
            <input name="subreddit" placeholder="InvoicePilot" className={inputClass} />
          </Field>
          <Field label="Feedback board URL (optional)">
            <input name="feedbackUrl" type="url" placeholder="https://…/feedback" className={inputClass} />
          </Field>
          <Field label="Complaint threshold">
            <input
              name="threshold"
              type="number"
              min={1}
              defaultValue={5}
              required
              className={inputClass}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={withIntegration}
            onChange={(e) => setWithIntegration(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
          />
          Register an API integration
        </label>

        {withIntegration ? (
          <div className="grid grid-cols-1 gap-3 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 p-3 sm:grid-cols-2 dark:bg-neutral-800/50">
            <Field label="Integration name">
              <input name="integrationName" required placeholder="Stripe Payments" className={inputClass} />
            </Field>
            <Field label="Provider">
              <input name="provider" required placeholder="stripe" className={inputClass} />
            </Field>
            <Field label="Docs URL">
              <input name="docsUrl" type="url" required placeholder="https://…/docs" className={inputClass} />
            </Field>
            <Field label="Endpoint">
              <input name="endpoint" required placeholder="/v1/payment_intents" className={inputClass} />
            </Field>
            <Field label="Integration path">
              <input name="integrationPath" required placeholder="src/lib/stripe.ts" className={inputClass} />
            </Field>
            <Field label="Test command">
              <input name="testCommand" required placeholder="npm test" className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Expected contract">
                <input
                  name="expectedContract"
                  required
                  placeholder="What the code assumes the response contains today"
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 cursor-pointer items-center rounded-[var(--rb-r-md,8px)] bg-neutral-900 px-4 text-sm font-medium text-white transition-[transform,opacity] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
          >
            {busy ? "Registering…" : "Register product"}
          </button>
          {result ? (
            <p
              role="status"
              className={`min-w-0 truncate text-[13px] ${
                result.error
                  ? "text-red-600 dark:text-red-400"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {result.text}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
