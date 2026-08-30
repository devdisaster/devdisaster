import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const MAX_INGEST_BYTES = 16 * 1024;
const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

export const buildFingerprint = (
  integrationId: Id<"integrations">,
  endpoint: string,
  observedVersion: string,
) => `${integrationId}:${endpoint}:${observedVersion}`;

const activeIncidentStatuses = new Set([
  "detected",
  "gathering_context",
  "diagnosing",
  "needs_review",
  "repair_queued",
  "repairing",
  "validating",
  "repair_proposed",
]);

type ReceiveTriggerInput = {
  integration: Doc<"integrations">;
  source: "docs" | "runtime";
  observedVersion: string;
  summary: string;
  raw: unknown;
};

type ReceiveTriggerResult = {
  incidentId: Id<"incidents">;
  triggerEventId: Id<"triggerEvents">;
  created: boolean;
};

const receiveTrigger = async (
  ctx: MutationCtx,
  { integration, source, observedVersion, summary, raw }: ReceiveTriggerInput,
): Promise<ReceiveTriggerResult> => {
  const fingerprint = buildFingerprint(
    integration._id,
    integration.endpoint,
    observedVersion,
  );
  const triggerEventId = await ctx.db.insert("triggerEvents", {
    productId: integration.productId,
    integrationId: integration._id,
    source,
    fingerprint,
    summary,
    raw,
  });

  const existing = (
    await ctx.db
      .query("incidents")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .collect()
  ).find((incident) => activeIncidentStatuses.has(incident.status));

  if (existing) {
    await ctx.db.patch("triggerEvents", triggerEventId, {
      incidentId: existing._id,
    });
    await ctx.db.insert("events", {
      productId: integration.productId,
      incidentId: existing._id,
      sentinel: "integration",
      message: `Corroborating ${source === "docs" ? "docs-change" : "runtime-failure"} evidence attached to the existing incident; no duplicate repair was started.`,
      level: "info",
    });
    return { incidentId: existing._id, triggerEventId, created: false };
  }

  const title =
    source === "docs"
      ? `${integration.provider} ${integration.endpoint} contract change (${observedVersion})`
      : `${integration.provider} ${integration.endpoint} runtime contract failure (${observedVersion})`;
  const incidentId = await ctx.db.insert("incidents", {
    productId: integration.productId,
    integrationId: integration._id,
    fingerprint,
    title,
    status: "detected",
  });
  await ctx.db.patch("triggerEvents", triggerEventId, { incidentId });
  await ctx.db.insert("events", {
    productId: integration.productId,
    incidentId,
    sentinel: "integration",
    message: `Incident detected from a ${source === "docs" ? "provider docs change" : "runtime integration failure"}: ${summary}`,
    level: "warn",
  });
  await ctx.db.patch("incidents", incidentId, { status: "gathering_context" });
  await ctx.db.insert("events", {
    productId: integration.productId,
    incidentId,
    sentinel: "integration",
    message:
      "Gathering context: retrieving the latest provider docs and the registered integration file.",
    level: "info",
  });
  await ctx.scheduler.runAfter(0, internal.docs.gatherAndDiagnose, {
    incidentId,
  });
  return { incidentId, triggerEventId, created: true };
};

export const recordDocsTrigger = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    url: v.string(),
    summary: v.string(),
    isBreaking: v.boolean(),
    affectedEndpoints: v.array(v.string()),
    observedVersion: v.string(),
    raw: v.any(),
  },
  returns: v.object({
    incidentId: v.id("incidents"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const integration = await ctx.db.get("integrations", args.integrationId);
    if (!integration) throw new Error("Integration not found");
    const result = await receiveTrigger(ctx, {
      integration,
      source: "docs",
      observedVersion: args.observedVersion,
      summary: args.summary,
      raw: args.raw,
    });
    await ctx.db.insert("docChanges", {
      productId: integration.productId,
      integrationId: integration._id,
      monitorId: integration.monitorId ?? "manual-run",
      url: args.url,
      summary: args.summary,
      isBreaking: args.isBreaking,
      affectedEndpoints: args.affectedEndpoints,
      raw: args.raw,
      incidentId: result.incidentId,
    });
    return { incidentId: result.incidentId, created: result.created };
  },
});

export const recordRuntimeTrigger = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    message: v.string(),
    stack: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    statusCode: v.optional(v.number()),
    contractVersion: v.optional(v.string()),
  },
  returns: v.object({
    incidentId: v.id("incidents"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const integration = await ctx.db.get("integrations", args.integrationId);
    if (!integration) throw new Error("Integration not found");
    const observedVersion = args.contractVersion ?? "unknown";
    const result = await receiveTrigger(ctx, {
      integration,
      source: "runtime",
      observedVersion,
      summary: args.message,
      raw: {
        message: args.message,
        endpoint: args.endpoint,
        statusCode: args.statusCode,
        contractVersion: args.contractVersion,
      },
    });
    await ctx.db.insert("errors", {
      productId: integration.productId,
      integrationId: integration._id,
      message: args.message,
      stack: args.stack,
      endpoint: args.endpoint,
      statusCode: args.statusCode,
      contractVersion: args.contractVersion,
      fingerprint: buildFingerprint(
        integration._id,
        integration.endpoint,
        observedVersion,
      ),
      incidentId: result.incidentId,
    });
    return { incidentId: result.incidentId, created: result.created };
  },
});

export const markDiagnosing = internalMutation({
  args: { incidentId: v.id("incidents") },
  returns: v.boolean(),
  handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident || incident.status !== "gathering_context") return false;
    await ctx.db.patch("incidents", incidentId, { status: "diagnosing" });
    await ctx.db.insert("events", {
      productId: incident.productId,
      incidentId,
      sentinel: "integration",
      message:
        "Diagnosing: comparing the changed contract against the registered integration code.",
      level: "info",
    });
    return true;
  },
});

export const applyDiagnosis = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    verdict: v.union(
      v.literal("impacted"),
      v.literal("not_impacted"),
      v.literal("uncertain"),
    ),
    reason: v.string(),
    affectedEndpoint: v.optional(v.string()),
    evidence: v.array(v.string()),
    codeEvidence: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident || incident.status !== "diagnosing") return null;
    const status =
      args.verdict === "impacted"
        ? "repair_queued"
        : args.verdict === "not_impacted"
          ? "not_impacted"
          : "needs_review";
    await ctx.db.patch("incidents", args.incidentId, {
      status,
      diagnosisVerdict: args.verdict,
      diagnosisReason: args.reason,
      affectedEndpoint: args.affectedEndpoint,
      diagnosisEvidence: args.evidence,
      codeEvidence: args.codeEvidence,
    });
    const message =
      args.verdict === "impacted"
        ? `Impact confirmed: ${args.reason} Queueing a Devin repair.`
        : args.verdict === "not_impacted"
          ? `No impact: ${args.reason} Stopping without a repair.`
          : `Diagnosis uncertain: ${args.reason} Routing to human review.`;
    await ctx.db.insert("events", {
      productId: incident.productId,
      incidentId: args.incidentId,
      sentinel: "integration",
      message,
      level: args.verdict === "impacted" ? "critical" : "info",
    });
    if (args.verdict === "impacted") {
      await ctx.scheduler.runAfter(0, internal.devin.launch, {
        productId: incident.productId,
        incidentId: args.incidentId,
      });
    }
    return null;
  },
});

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
};

const hmacHex = async (secret: string, payload: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const parseSignatureHeader = (header: string | null) => {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.trim().split("=", 2) as [string, string]),
  );
  if (!parts.t || !parts.v1) return null;
  return { timestamp: parts.t, signature: parts.v1 };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findString = (payload: unknown, keys: string[]): string | undefined => {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  for (const value of Object.values(payload)) {
    if (isRecord(value)) {
      const nested = findString(value, keys);
      if (nested) return nested;
    }
  }
  return undefined;
};

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export const handleContextWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.CONTEXT_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse(
      { error: "CONTEXT_WEBHOOK_SECRET is not configured" },
      503,
    );
  }
  const rawBody = await request.text();
  const parsed = parseSignatureHeader(request.headers.get("X-Context-Signature"));
  if (!parsed) return jsonResponse({ error: "Missing signature" }, 401);
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(parsed.timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_MAX_AGE_SECONDS) {
    return jsonResponse({ error: "Stale webhook timestamp" }, 401);
  }
  const expected = await hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  if (!timingSafeEqual(expected, parsed.signature)) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const integration: Doc<"integrations"> = await ctx.runQuery(
    internal.vendor.getIntegration,
    {},
  );
  const monitorId = findString(payload, ["monitor_id", "monitorId", "id"]);
  if (
    integration.monitorId &&
    monitorId &&
    integration.monitorId !== monitorId
  ) {
    return jsonResponse({ error: "Unknown monitor" }, 404);
  }
  const summary =
    findString(payload, ["summary", "change_summary", "description", "diff"]) ??
    "Context.dev detected a change on the monitored docs page.";
  const url = findString(payload, ["url", "target_url", "page_url"]) ??
    integration.docsUrl;

  const result = await ctx.runMutation(internal.incidents.recordDocsTrigger, {
    integrationId: integration._id,
    url,
    summary,
    isBreaking: true,
    affectedEndpoints: [integration.endpoint],
    observedVersion: integration.activeContractVersion,
    raw: payload,
  });
  return jsonResponse({ received: true, incidentId: result.incidentId }, 200);
});

export const handleErrorIngest = httpAction(async (ctx, request) => {
  const token = process.env.SENTINEL_INGEST_TOKEN;
  if (!token) {
    return jsonResponse({ error: "Ingest is not configured" }, 503);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!timingSafeEqual(authorization, `Bearer ${token}`)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_INGEST_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }
  if (!isRecord(payload) || typeof payload.message !== "string") {
    return jsonResponse({ error: "message is required" }, 400);
  }

  const integration: Doc<"integrations"> = await ctx.runQuery(
    internal.vendor.getIntegration,
    {},
  );
  const result = await ctx.runMutation(
    internal.incidents.recordRuntimeTrigger,
    {
      integrationId: integration._id,
      message: payload.message.slice(0, 2000),
      stack:
        typeof payload.stack === "string"
          ? payload.stack.slice(0, 4000)
          : undefined,
      endpoint:
        typeof payload.endpoint === "string" ? payload.endpoint : undefined,
      statusCode:
        typeof payload.statusCode === "number" ? payload.statusCode : undefined,
      contractVersion:
        typeof payload.contractVersion === "string"
          ? payload.contractVersion
          : undefined,
    },
  );
  return jsonResponse({ received: true, incidentId: result.incidentId }, 200);
});
