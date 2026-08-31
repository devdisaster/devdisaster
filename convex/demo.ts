import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, mutation } from "./_generated/server";

const OLD_VERSION = "2024-08-06" as const;

const EXTRACTION_SYSTEM_PROMPT =
  "You extract invoice fields from a pasted billing email. Reply with strict JSON only.";
const EXTRACTION_EMAIL =
  "Hi — invoice for Northstar Labs, $2,480.00 USD, due 2026-09-30. Thanks!";

const gatewayBase = (docsUrl: string) =>
  docsUrl.replace(/\/demo\/openai\/docs$/, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
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
