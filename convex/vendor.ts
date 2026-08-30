import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

const OLD_VERSION = "2022-08-01" as const;
const NEW_VERSION = "2022-11-15" as const;
const STRIPE_API_URL = "https://api.stripe.com/v1/payment_intents";
const MAX_REQUEST_BYTES = 64 * 1024;

type ContractVersion = typeof OLD_VERSION | typeof NEW_VERSION;
type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const copyFields = (source: JsonRecord, fields: readonly string[]) =>
  Object.fromEntries(
    fields.flatMap((field) =>
      source[field] === undefined ? [] : [[field, source[field]]],
    ),
  );

const sanitizeCharge = (value: unknown): JsonRecord | null => {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return copyFields(value, [
    "id",
    "object",
    "amount",
    "amount_captured",
    "amount_refunded",
    "currency",
    "status",
    "paid",
    "captured",
    "created",
    "livemode",
    "receipt_url",
    "failure_code",
  ]);
};

export const sanitizePaymentIntent = (value: unknown): JsonRecord => {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Stripe returned an invalid PaymentIntent");
  }
  const paymentIntent = copyFields(value, [
    "id",
    "object",
    "amount",
    "amount_capturable",
    "amount_received",
    "currency",
    "status",
    "created",
    "livemode",
    "capture_method",
    "confirmation_method",
    "payment_method_types",
    "canceled_at",
    "cancellation_reason",
  ]);
  const latestCharge = value.latest_charge;
  if (latestCharge === null || latestCharge === undefined) {
    paymentIntent.latest_charge = null;
  } else if (typeof latestCharge === "string") {
    paymentIntent.latest_charge = latestCharge;
  } else {
    const charge = sanitizeCharge(latestCharge);
    if (!charge) throw new Error("Stripe returned an invalid expanded charge");
    paymentIntent.latest_charge = charge;
  }
  return paymentIntent;
};

export const shapePaymentIntent = (
  value: unknown,
  version: ContractVersion,
): JsonRecord => {
  const paymentIntent = sanitizePaymentIntent(value);
  const latestCharge = paymentIntent.latest_charge;
  if (version === OLD_VERSION) {
    const charge = sanitizeCharge(latestCharge);
    delete paymentIntent.latest_charge;
    paymentIntent.charges = {
      object: "list",
      data: charge ? [charge] : [],
      has_more: false,
    };
    return paymentIntent;
  }
  delete paymentIntent.charges;
  paymentIntent.latest_charge = isRecord(latestCharge)
    ? latestCharge.id
    : latestCharge;
  return paymentIntent;
};

const findStripeIntegration = async (
  ctx: Pick<QueryCtx, "db">,
): Promise<Doc<"integrations">> => {
  const integrations: Doc<"integrations">[] = await ctx.db
    .query("integrations")
    .collect();
  const matches = integrations.filter(
    (integration) =>
      integration.provider === "stripe" &&
      integration.endpoint === "/v1/payment_intents" &&
      integration.enabled,
  );
  if (matches.length !== 1) {
    throw new Error(
      "Expected exactly one enabled Stripe PaymentIntent integration",
    );
  }
  return matches[0];
};

export const getIntegration = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => findStripeIntegration(ctx),
});

export const cacheResponse = internalMutation({
  args: { integrationId: v.id("integrations"), response: v.any() },
  returns: v.null(),
  handler: async (ctx, { integrationId, response }) => {
    const integration = await ctx.db.get("integrations", integrationId);
    if (!integration || integration.provider !== "stripe") {
      throw new Error("Stripe integration not found");
    }
    await ctx.db.patch("integrations", integrationId, {
      cachedResponse: sanitizePaymentIntent(response),
    });
    return null;
  },
});

export const recordFallback = internalMutation({
  args: { integrationId: v.id("integrations") },
  returns: v.null(),
  handler: async (ctx, { integrationId }) => {
    const integration = await ctx.db.get("integrations", integrationId);
    if (!integration || integration.provider !== "stripe") {
      throw new Error("Stripe integration not found");
    }
    await ctx.db.insert("events", {
      productId: integration.productId,
      sentinel: "system",
      message:
        "Stripe gateway served sanitized last-good fallback data after an upstream connectivity failure.",
      level: "warn",
    });
    return null;
  },
});

const setVersion = (version: ContractVersion) =>
  mutation({
    args: {},
    returns: v.object({
      changed: v.boolean(),
      activeContractVersion: v.union(
        v.literal(OLD_VERSION),
        v.literal(NEW_VERSION),
      ),
    }),
    handler: async (ctx) => {
      const integration = await findStripeIntegration(ctx);
      if (integration.activeContractVersion === version) {
        return { changed: false, activeContractVersion: version };
      }
      await ctx.db.patch("integrations", integration._id, {
        activeContractVersion: version,
      });
      await ctx.db.insert("events", {
        productId: integration.productId,
        sentinel: "integration",
        message: `Stripe PaymentIntent contract changed to ${version}.`,
        level: "info",
      });
      return { changed: true, activeContractVersion: version };
    },
  });

export const resetV1 = setVersion(OLD_VERSION);
export const upgradeV2 = setVersion(NEW_VERSION);

const jsonResponse = (
  body: unknown,
  status: number,
  version: ContractVersion,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Stripe-Version": version,
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const sanitizeStripeError = (value: unknown) => {
  const error = isRecord(value) && isRecord(value.error) ? value.error : {};
  return {
    error: {
      ...copyFields(error, ["type", "code", "decline_code"]),
      message: "Stripe request failed",
    },
  };
};

class StripeConnectivityError extends Error {}

const fetchStripe = async (input: URL | string, init: RequestInit) => {
  try {
    return await fetch(input, init);
  } catch {
    throw new StripeConnectivityError("Stripe is unreachable");
  }
};

const stripeRequest = async (
  request: Request,
  key: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const prefix = "/demo/stripe/v1/payment_intents/";
  if (request.method === "GET") {
    const id = url.pathname.slice(prefix.length);
    if (!/^pi_[A-Za-z0-9]+$/.test(id)) {
      return new Response(null, { status: 404 });
    }
    const upstream = new URL(`${STRIPE_API_URL}/${id}`);
    upstream.searchParams.append("expand[]", "latest_charge");
    return fetchStripe(upstream, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": NEW_VERSION,
      },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    return new Response(
      JSON.stringify({
        error: { message: "Expected form-encoded Stripe parameters" },
      }),
      {
        status: 415,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return new Response(null, { status: 413 });
  }
  const params = new URLSearchParams(body);
  for (const key of [...params.keys()]) {
    if (key === "expand" || key.startsWith("expand[")) params.delete(key);
  }
  params.append("expand[]", "latest_charge");
  return fetchStripe(STRIPE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": NEW_VERSION,
    },
    body: params.toString(),
  });
};

export const handlePaymentIntents = httpAction(async (ctx, request) => {
  const integration: Doc<"integrations"> = await ctx.runQuery(
    internal.vendor.getIntegration,
    {},
  );
  const version = integration.activeContractVersion;
  const fallbackResponse = async () => {
    if (integration.cachedResponse === undefined) {
      return jsonResponse(
        {
          error: {
            message: "Stripe is unavailable and no cached response exists",
          },
        },
        503,
        version,
      );
    }
    const body = shapePaymentIntent(integration.cachedResponse, version);
    await ctx.runMutation(internal.vendor.recordFallback, {
      integrationId: integration._id,
    });
    return jsonResponse(body, 200, version, { "X-Sentinel-Fallback": "true" });
  };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return jsonResponse(
      { error: { message: "Stripe gateway is not configured" } },
      503,
      version,
    );
  }

  let upstream: Response;
  try {
    upstream = await stripeRequest(request, key);
  } catch (error) {
    if (error instanceof StripeConnectivityError) return fallbackResponse();
    return jsonResponse(
      { error: { message: "Invalid Stripe gateway request" } },
      400,
      version,
    );
  }

  if (!upstream.ok) {
    const payload: unknown = await upstream.json().catch(() => null);
    if (upstream.status >= 500 || upstream.status === 429) {
      return fallbackResponse();
    }
    return jsonResponse(sanitizeStripeError(payload), upstream.status, version);
  }

  let sanitized: JsonRecord;
  try {
    sanitized = sanitizePaymentIntent(await upstream.json());
  } catch {
    return fallbackResponse();
  }
  await ctx.runMutation(internal.vendor.cacheResponse, {
    integrationId: integration._id,
    response: sanitized,
  });
  return jsonResponse(
    shapePaymentIntent(sanitized, version),
    upstream.status,
    version,
  );
});

const docsPage = (version: ContractVersion) => {
  const oldAttributes = `<dt><code>charges</code></dt><dd>List of charges associated with this PaymentIntent.</dd>`;
  const newAttributes = `<dt><code>latest_charge</code></dt><dd>ID of the latest Charge created by this PaymentIntent.</dd>`;
  const changelog = `<section><h2>Changelog</h2><p>Removes the <code>charges</code> attribute from the PaymentIntent object — use <code>latest_charge</code> instead.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stripe PaymentIntent ${version}</title></head><body><main><h1>PaymentIntent object</h1><p>API version: <strong>${version}</strong></p><p>A PaymentIntent guides you through the process of collecting a payment.</p><h2>Attributes</h2><dl><dt><code>id</code></dt><dd>Unique identifier for the object.</dd><dt><code>object</code></dt><dd>String representing the object's type.</dd><dt><code>status</code></dt><dd>Status of this PaymentIntent.</dd>${version === OLD_VERSION ? oldAttributes : newAttributes}</dl>${version === NEW_VERSION ? changelog : ""}</main></body></html>`;
};

export const handleDocs = httpAction(async (ctx) => {
  const integration: Doc<"integrations"> = await ctx.runQuery(
    internal.vendor.getIntegration,
    {},
  );
  return new Response(docsPage(integration.activeContractVersion), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Stripe-Version": integration.activeContractVersion,
      "Cache-Control": "no-store",
    },
  });
});
