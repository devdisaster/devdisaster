import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="flex min-w-0 flex-col items-start gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </Label>
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
    <Card className="overflow-hidden">
      <CardHeader className="flex h-12 flex-row items-center bg-muted/60 py-0">
        <CardTitle className="text-sm font-medium text-foreground">
          Onboard a product
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Product name">
              <Input name="name" required placeholder="InvoicePilot" className="text-sm" />
            </Field>
            <Field label="GitHub repository (optional — absent = observer mode)">
              <Input name="repo" placeholder="org/repo" className="text-sm" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Input
                  name="description"
                  required
                  placeholder="What the product does — feeds clustering and Devin prompts"
                  className="text-sm"
                />
              </Field>
            </div>
            <Field label="Subreddit (optional)">
              <Input name="subreddit" placeholder="InvoicePilot" className="text-sm" />
            </Field>
            <Field label="Feedback board URL (optional)">
              <Input name="feedbackUrl" type="url" placeholder="https://…/feedback" className="text-sm" />
            </Field>
            <Field label="Complaint threshold">
              <Input
                name="threshold"
                type="number"
                min={1}
                defaultValue={5}
                required
                className="text-sm"
              />
            </Field>
          </div>

          <div className="flex items-center gap-2 text-[13px] text-foreground">
            <Checkbox
              id="withIntegration"
              checked={withIntegration}
              onCheckedChange={(checked) => setWithIntegration(checked === true)}
            />
            <Label htmlFor="withIntegration" className="text-sm font-normal text-foreground">
              Register an API integration
            </Label>
          </div>

          {withIntegration ? (
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-muted p-3 sm:grid-cols-2">
              <Field label="Integration name">
                <Input name="integrationName" required placeholder="Stripe Payments" className="text-sm" />
              </Field>
              <Field label="Provider">
                <Input name="provider" required placeholder="stripe" className="text-sm" />
              </Field>
              <Field label="Docs URL">
                <Input name="docsUrl" type="url" required placeholder="https://…/docs" className="text-sm" />
              </Field>
              <Field label="Endpoint">
                <Input name="endpoint" required placeholder="/v1/payment_intents" className="text-sm" />
              </Field>
              <Field label="Integration path">
                <Input name="integrationPath" required placeholder="src/lib/stripe.ts" className="text-sm" />
              </Field>
              <Field label="Test command">
                <Input name="testCommand" required placeholder="npm test" className="text-sm" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Expected contract">
                  <Input
                    name="expectedContract"
                    required
                    placeholder="What the code assumes the response contains today"
                    className="text-sm"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={busy}
            >
              {busy ? "Registering…" : "Register product"}
            </Button>
            {result ? (
              <p
                role="status"
                className={`min-w-0 truncate text-[13px] ${
                  result.error
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {result.text}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
