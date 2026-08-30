import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, mutation } from "./_generated/server";

const NEW_VERSION = "2022-11-15";
const OLD_VERSION = "2022-08-01" as const;

const gatewayBase = (docsUrl: string) =>
  docsUrl.replace(/\/demo\/stripe\/docs$/, "");

const monitorScanResult = v.object({
  changed: v.boolean(),
  incidentId: v.optional(v.id("incidents")),
  message: v.string(),
});

export const monitorScan = internalAction({
  args: {},
  returns: monitorScanResult,
  handler: async (ctx) => {
    const integration: Doc<"integrations"> = await ctx.runQuery(
      internal.vendor.getIntegration,
      {},
    );
    const response = await fetch(integration.docsUrl, {
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return {
        changed: false,
        message: `The docs mirror could not be retrieved (${response.status}).`,
      };
    }
    const html = await response.text();
    const versionMatch = html.match(/data-version="([^"]+)"/);
    const observedVersion = versionMatch?.[1] ?? integration.activeContractVersion;
    if (observedVersion !== NEW_VERSION) {
      return {
        changed: false,
        message: `Monitor run found no breaking change; the docs still describe ${observedVersion}.`,
      };
    }
    const summary =
      "The 2022-11-15 changelog removes the `charges` attribute from the PaymentIntent object — integrations must use `latest_charge` instead.";
    const result: { incidentId: Doc<"incidents">["_id"]; created: boolean } =
      await ctx.runMutation(internal.incidents.recordDocsTrigger, {
        integrationId: integration._id,
        url: integration.docsUrl,
        summary,
        isBreaking: true,
        affectedEndpoints: [integration.endpoint],
        observedVersion,
        raw: {
          source: "monitor-run",
          observedVersion,
          docsUrl: integration.docsUrl,
        },
      });
    return {
      changed: true,
      incidentId: result.incidentId,
      message: result.created
        ? "Breaking docs change detected; a new incident is being diagnosed."
        : "Breaking docs change detected; evidence attached to the existing incident.",
    };
  },
});

type MonitorScanResult = {
  changed: boolean;
  incidentId?: Doc<"incidents">["_id"];
  message: string;
};

export const runMonitorNow = action({
  args: {},
  returns: monitorScanResult,
  handler: async (ctx): Promise<MonitorScanResult> =>
    ctx.runAction(internal.demo.monitorScan, {}),
});

export const runIntegration = action({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    contractVersion: v.string(),
    message: v.string(),
  }),
  handler: async (ctx) => {
    const integration: Doc<"integrations"> = await ctx.runQuery(
      internal.vendor.getIntegration,
      {},
    );
    const base = gatewayBase(integration.docsUrl);
    const params = new URLSearchParams({
      amount: "1299",
      currency: "usd",
      confirm: "true",
      payment_method: "pm_card_visa",
    });
    params.append("payment_method_types[]", "card");
    const response = await fetch(`${base}/demo/stripe/v1/payment_intents`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const contractVersion =
      response.headers.get("Stripe-Version") ??
      integration.activeContractVersion;
    if (!response.ok) {
      return {
        ok: false,
        contractVersion,
        message: `The payment gateway request failed (${response.status}).`,
      };
    }
    const paymentIntent = (await response.json()) as Record<string, unknown>;
    const charges = paymentIntent.charges as
      | { data?: Record<string, unknown>[] }
      | undefined;
    const charge = charges?.data?.[0];
    if (charge && typeof charge.receipt_url === "string") {
      return {
        ok: true,
        contractVersion,
        message: `Payment collected under ${contractVersion}; receipt and paid status read from charges.data[0].`,
      };
    }

    const token = process.env.SENTINEL_INGEST_TOKEN;
    const message =
      "Stripe contract failure: PaymentIntent response is missing charges.data[0]; the adapter cannot read receipt_url or paid status.";
    if (token) {
      await fetch(`${base}/ingest/errors`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          endpoint: integration.endpoint,
          statusCode: response.status,
          contractVersion,
        }),
      });
    }
    return {
      ok: false,
      contractVersion,
      message: `The integration failed under ${contractVersion}: charges is missing from the PaymentIntent. The runtime failure was reported to Kevin (not Devin).`,
    };
  },
});

export const resetDemo = mutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of [
      "incidents",
      "triggerEvents",
      "docChanges",
      "errors",
      "sessions",
      "events",
      "clusters",
      "reviews",
    ] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(table, row._id);
        deleted += 1;
      }
    }
    const integrations = await ctx.db.query("integrations").collect();
    for (const integration of integrations) {
      if (integration.activeContractVersion !== OLD_VERSION) {
        await ctx.db.patch("integrations", integration._id, {
          activeContractVersion: OLD_VERSION,
        });
      }
    }
    for (const product of await ctx.db.query("products").collect()) {
      if (product.name.startsWith("Observer ")) {
        await ctx.db.delete("products", product._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});
