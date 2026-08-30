// Phase 4 demo simulation module. Seeds mock data and replays the Stripe
// 2022-11-15 breaking-change story through the REAL schema so the dashboard
// animates live. Clearly demo-only: Phase 2's real spine replaces these
// writes; this module never touches Phase 2's files.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";

const STEP_MS = 2200;
const PR_URL = "https://github.com/devdisaster/invoicepilot/pull/4";
const FINGERPRINT = "stripe:/v1/payment_intents:2022-11-15";

const ensureProduct = async (ctx: MutationCtx) => {
  let product = (await ctx.db.query("products").collect()).find(
    (candidate) => candidate.repo,
  );
  if (!product) {
    const productId = await ctx.db.insert("products", {
      name: "InvoicePilot",
      description:
        "A billing SaaS for creating invoices, collecting Stripe payments, and exporting invoice data.",
      repo: "devdisaster/invoicepilot",
      subreddit: "InvoicePilot",
      feedbackUrl: "https://invoicepilot.example/feedback",
      docsUrls: ["https://docs.stripe.com/api/payment_intents"],
      threshold: 5,
    });
    product = (await ctx.db.get("products", productId))!;
  }
  let integration = (
    await ctx.db
      .query("integrations")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect()
  )[0];
  if (!integration) {
    const integrationId = await ctx.db.insert("integrations", {
      productId: product._id,
      name: "Stripe Payments",
      provider: "stripe",
      docsUrl: "https://docs.stripe.com/api/payment_intents",
      endpoint: "/v1/payment_intents",
      integrationPath: "src/lib/stripe.ts",
      expectedContract:
        "PaymentIntent includes charges.data[0] with receipt_url and status.",
      activeContractVersion: "2022-08-01",
      testCommand: "npm test",
      monitorId: "mon_stripe_docs_demo",
      enabled: true,
    });
    integration = (await ctx.db.get("integrations", integrationId))!;
  }
  return { product, integration };
};

// Reset the demo: wipe pipeline tables, restore the 2022-08-01 contract, and
// lay down baseline "everything is healthy" mock history.
export const reset = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const tables: TableNames[] = [
      "incidents",
      "triggerEvents",
      "docChanges",
      "errors",
      "events",
      "sessions",
    ];
    for (const table of tables) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(table, row._id);
      }
    }
    const { product, integration } = await ensureProduct(ctx);
    await ctx.db.patch("integrations", integration._id, {
      activeContractVersion: "2022-08-01",
      monitorId: "mon_stripe_docs_demo",
    });

    await ctx.db.insert("docChanges", {
      productId: product._id,
      integrationId: integration._id,
      monitorId: "mon_stripe_docs_demo",
      url: "https://docs.stripe.com/changelog",
      summary:
        "Stripe docs updated: clarified error-code descriptions for /v1/payment_intents. No schema or field changes.",
      isBreaking: false,
      affectedEndpoints: [],
      raw: { demo: true },
    });
    await ctx.db.insert("events", {
      productId: product._id,
      sentinel: "integration",
      message:
        "Docs change reviewed: wording-only update, no contract impact. Monitoring continues.",
      level: "info",
    });
    await ctx.db.insert("events", {
      productId: product._id,
      sentinel: "system",
      message:
        "Context.dev monitor active on the Stripe PaymentIntents docs (10-minute interval).",
      level: "info",
    });
    return null;
  },
});

// The stage trigger: replay Stripe's real 2022-11-15 upgrade. Creates the
// docs-change signal + incident, then advances the pipeline step by step.
export const triggerStripeUpgrade = mutation({
  args: {},
  returns: v.union(
    v.object({ status: v.literal("started"), incidentId: v.id("incidents") }),
    v.object({ status: v.literal("already_running") }),
  ),
  handler: async (ctx) => {
    const { product, integration } = await ensureProduct(ctx);
    const existing = await ctx.db
      .query("incidents")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", FINGERPRINT))
      .first();
    if (
      existing &&
      existing.status !== "repair_proposed" &&
      existing.status !== "repair_failed" &&
      existing.status !== "not_impacted"
    ) {
      return { status: "already_running" as const };
    }

    await ctx.db.patch("integrations", integration._id, {
      activeContractVersion: "2022-11-15",
    });
    const incidentId = await ctx.db.insert("incidents", {
      productId: product._id,
      integrationId: integration._id,
      fingerprint: FINGERPRINT,
      title: "Stripe removed `charges` from PaymentIntent (2022-11-15)",
      status: "detected",
    });
    await ctx.db.insert("docChanges", {
      productId: product._id,
      integrationId: integration._id,
      monitorId: "mon_stripe_docs_demo",
      url: "https://docs.stripe.com/changelog/2022-11-15",
      summary:
        "2022-11-15: Removes the `charges` attribute from the PaymentIntent object — use `latest_charge` instead.",
      isBreaking: true,
      affectedEndpoints: ["/v1/payment_intents"],
      raw: { demo: true },
      incidentId,
    });
    await ctx.db.insert("triggerEvents", {
      productId: product._id,
      integrationId: integration._id,
      source: "docs",
      fingerprint: FINGERPRINT,
      summary:
        "Context.dev detected a semantic change: PaymentIntent no longer documents `charges`; `latest_charge` added.",
      raw: { demo: true },
      incidentId,
    });
    await ctx.db.insert("events", {
      productId: product._id,
      incidentId,
      sentinel: "integration",
      message:
        "Signed webhook received from Context.dev: breaking change detected on the Stripe PaymentIntents docs.",
      level: "warn",
    });
    await ctx.scheduler.runAfter(STEP_MS, internal.demo.advance, {
      incidentId,
      step: 1,
    });
    return { status: "started" as const, incidentId };
  },
});

export const advance = internalMutation({
  args: { incidentId: v.id("incidents"), step: v.number() },
  returns: v.null(),
  handler: async (ctx, { incidentId, step }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident) return null;
    const productId = incident.productId;
    const post = (message: string, level: "info" | "warn" | "critical") =>
      ctx.db.insert("events", {
        productId,
        incidentId,
        sentinel: "integration",
        message,
        level,
      });
    let next: number | null = step + 1;

    switch (step) {
      case 1: {
        await ctx.db.patch("incidents", incidentId, {
          status: "gathering_context",
        });
        await post(
          "Gathering context: retrieved the latest Stripe docs and fetched src/lib/stripe.ts from devdisaster/invoicepilot.",
          "info",
        );
        break;
      }
      case 2: {
        await ctx.db.patch("incidents", incidentId, { status: "diagnosing" });
        await post(
          "Diagnosing impact: comparing the changed contract against the adapter's actual field usage.",
          "info",
        );
        break;
      }
      case 3: {
        await ctx.db.patch("incidents", incidentId, {
          status: "repair_queued",
          diagnosisVerdict: "impacted",
          diagnosisReason:
            "The adapter reads pi.charges.data[0].receipt_url and .status, but the 2022-11-15 contract removes `charges` in favor of `latest_charge`.",
          affectedEndpoint: "/v1/payment_intents",
          diagnosisEvidence: [
            "Changelog 2022-11-15: Removes the `charges` attribute from the PaymentIntent object — use `latest_charge` instead.",
          ],
          codeEvidence: [
            'src/lib/stripe.ts:42 — const receiptUrl = pi.charges.data[0].receipt_url;',
            'src/lib/stripe.ts:43 — const paid = pi.charges.data[0].status === "succeeded";',
          ],
        });
        await post(
          "Verdict: IMPACTED — the adapter reads the removed `charges` field. Repair queued.",
          "critical",
        );
        break;
      }
      case 4: {
        const sessionId = await ctx.db.insert("sessions", {
          productId,
          trigger: "incident",
          incidentId,
          devinSessionId: "devin-demo-simulation",
          devinUrl: "https://app.devin.ai/sessions/demo",
          status: "working",
          prompt: "(demo simulation)",
        });
        await ctx.db.patch("incidents", incidentId, {
          status: "repairing",
          sessionId,
        });
        await post("Evidence packet compiled; Devin session launched.", "info");
        break;
      }
      case 5: {
        const integration = await ctx.db.get(
          "integrations",
          incident.integrationId,
        );
        await ctx.db.insert("errors", {
          productId,
          integrationId: incident.integrationId,
          message:
            "Contract violation: expected charges.data[0] on PaymentIntent, got undefined",
          endpoint: integration?.endpoint ?? "/v1/payment_intents",
          statusCode: 200,
          contractVersion: "2022-11-15",
          fingerprint: FINGERPRINT,
          incidentId,
        });
        await ctx.db.insert("triggerEvents", {
          productId,
          integrationId: incident.integrationId,
          source: "runtime",
          fingerprint: FINGERPRINT,
          summary:
            "InvoicePilot reported a live contract failure on /v1/payment_intents (Stripe-Version 2022-11-15).",
          raw: { demo: true },
          incidentId,
        });
        await post(
          "Runtime failure received from InvoicePilot — attached as corroborating evidence. No duplicate repair launched.",
          "warn",
        );
        break;
      }
      case 6: {
        if (incident.sessionId) {
          await ctx.db.patch("sessions", incident.sessionId, {
            prUrl: PR_URL,
            prNumber: 4,
          });
        }
        await post("Devin opened pull request #4 on devdisaster/invoicepilot.", "info");
        break;
      }
      case 7: {
        if (incident.sessionId) {
          await ctx.db.patch("sessions", incident.sessionId, {
            status: "finished",
            testStatus: "passed",
            testSummary:
              "12 passed, including the new 2022-11-15 regression fixture for latest_charge.",
          });
        }
        await ctx.db.patch("incidents", incidentId, { status: "validating" });
        await post("Devin reported tests passed; validating results.", "info");
        break;
      }
      case 8: {
        await ctx.db.patch("incidents", incidentId, {
          status: "repair_proposed",
        });
        await post(
          "Repair PR proposed with passing tests. Human review required — Sentinel never merges.",
          "info",
        );
        next = null;
        break;
      }
      default:
        next = null;
    }

    if (next !== null) {
      await ctx.scheduler.runAfter(STEP_MS, internal.demo.advance, {
        incidentId,
        step: next,
      });
    }
    return null;
  },
});
