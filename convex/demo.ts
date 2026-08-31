import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction, mutation } from "./_generated/server";
import { retrieveDocs } from "./docs";

const NEW_VERSION = "2024-09-12";
const OLD_VERSION = "2024-08-06" as const;

const EXTRACTION_SYSTEM_PROMPT =
  "You extract invoice fields from a pasted billing email. Reply with strict JSON only.";
const EXTRACTION_EMAIL =
  "Hi — invoice for Northstar Labs, $2,480.00 USD, due 2026-09-30. Thanks!";

const gatewayBase = (docsUrl: string) =>
  docsUrl.replace(/\/demo\/openai\/docs$/, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    const scraped = await retrieveDocs(integration.docsUrl);
    const summary =
      "The 2024-09-12 changelog deprecates the max_tokens parameter on /v1/chat/completions — requests must send max_completion_tokens instead.";
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
          retrievedVia: scraped?.via ?? "unavailable",
          docsExcerpt: scraped?.text.slice(0, 1500),
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
    // Mirrors the request src/lib/openai.ts sends on every extraction.
    const response = await fetch(`${base}/demo/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: EXTRACTION_EMAIL },
        ],
        max_tokens: 256,
        temperature: 0,
      }),
    });
    const contractVersion =
      response.headers.get("X-Contract-Version") ??
      integration.activeContractVersion;
    const payload: unknown = await response.json().catch(() => null);

    if (response.ok) {
      return {
        ok: true,
        contractVersion,
        message: `Invoice fields extracted under ${contractVersion}; the adapter read the draft from choices[0].message.content.`,
      };
    }

    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    if (response.status !== 400 || error?.code !== "unsupported_parameter") {
      return {
        ok: false,
        contractVersion,
        message: `The chat completion request failed (${response.status}).`,
      };
    }

    const token = process.env.SENTINEL_INGEST_TOKEN;
    const message =
      "OpenAI contract failure: 'max_tokens' rejected as unsupported_parameter on /v1/chat/completions; the adapter cannot complete invoice extraction.";
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
      message: `The integration failed under ${contractVersion}: max_tokens is rejected as an unsupported parameter. ${
        token
          ? "The runtime failure was reported to Kevin (not Devin)."
          : "SENTINEL_INGEST_TOKEN is not configured, so the runtime failure was not reported."
      }`,
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
