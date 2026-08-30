import { v } from "convex/values";
import { api, internal } from "./_generated/api";
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
      if (version === NEW_VERSION) {
        await ctx.db.insert("events", {
          productId: integration.productId,
          sentinel: "integration",
          message:
            "Context monitor scan scheduled for the changed Stripe docs page.",
          level: "info",
        });
        await ctx.scheduler.runAfter(4000, internal.demo.monitorScan, {});
      }
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
  const isOld = version === OLD_VERSION;
  const contractAttribute = isOld
    ? `<article class="attribute changed"><div class="attribute-name"><code>charges</code><span>object</span></div><p>A list of charges associated with this PaymentIntent.</p><div class="subfield"><code>data</code> contains the expanded Charge, including its <code>status</code> and <code>receipt_url</code>.</div></article>`
    : `<article class="attribute changed"><div class="attribute-name"><code>latest_charge</code><span>nullable string</span></div><p>ID of the latest Charge created by this PaymentIntent.</p><div class="subfield">Use this ID to retrieve the Charge and its receipt details.</div></article>`;
  const changelog = isOld
    ? ""
    : `<section class="changelog" id="changelog"><div class="eyebrow">2022-11-15 changelog</div><h2>PaymentIntent charge access changed</h2><p>Removes the <code>charges</code> attribute from the PaymentIntent object — use <code>latest_charge</code> instead.</p></section>`;
  const responseField = isOld
    ? `<span class="key">"charges"</span>: {
    <span class="key">"object"</span>: <span class="string">"list"</span>,
    <span class="key">"data"</span>: [{
      <span class="key">"id"</span>: <span class="string">"ch_demo"</span>,
      <span class="key">"status"</span>: <span class="string">"succeeded"</span>,
      <span class="key">"receipt_url"</span>: <span class="string">"https://pay.stripe.com/receipts/..."</span>
    }],
    <span class="key">"has_more"</span>: <span class="bool">false</span>
  }`
    : `<span class="key">"latest_charge"</span>: <span class="string">"ch_demo"</span>`;
  const targetVersion = isOld ? NEW_VERSION : OLD_VERSION;
  const controlLabel = isOld
    ? "Trigger 2022-11-15 upgrade"
    : "Reset 2022-08-01 baseline";
  const controlDetail = isOld
    ? "Removes charges and adds latest_charge"
    : "Restores charges for the next demo run";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PaymentIntent object | Stripe API Reference</title>
  <style>
    :root { color-scheme: light; --ink: #1a1f36; --muted: #697386; --line: #e3e8ee; --purple: #635bff; --purple-dark: #4f46e5; --sidebar: #f7f9fc; --code: #0a2540; --green: #0e9f6e; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; color: var(--ink); background: white; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    code, pre, .method, .version-pill { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .topbar { height: 68px; border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 32px; position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,.96); backdrop-filter: blur(12px); }
    .brand { display: flex; align-items: center; gap: 11px; min-width: 248px; font-size: 21px; font-weight: 800; color: #635bff; letter-spacing: -.8px; }
    .brand-mark { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #7a73ff, #5046e5); color: white; display: grid; place-items: center; font-size: 18px; }
    .brand small { color: #8792a2; font-size: 12px; font-weight: 650; letter-spacing: .02em; border-left: 1px solid var(--line); padding-left: 11px; }
    .search { margin-left: auto; width: min(390px, 40vw); height: 38px; border: 1px solid #d8dee8; border-radius: 8px; display: flex; align-items: center; gap: 9px; padding: 0 12px; color: #8792a2; background: #f7f9fc; font-size: 13px; }
    .search kbd { margin-left: auto; border: 1px solid #d8dee8; background: white; border-radius: 5px; padding: 0 6px; font-size: 11px; }
    .layout { display: grid; grid-template-columns: 248px minmax(480px, 1fr) minmax(360px, 42%); min-height: calc(100vh - 68px); }
    .sidebar { background: var(--sidebar); border-right: 1px solid var(--line); padding: 30px 24px; }
    .nav-title { color: #8792a2; text-transform: uppercase; letter-spacing: .09em; font-size: 11px; font-weight: 750; margin: 22px 10px 8px; }
    .nav-title:first-child { margin-top: 0; }
    .nav-link { display: block; text-decoration: none; color: #4f566b; padding: 7px 10px; border-radius: 6px; font-size: 13px; }
    .nav-link.active { color: #635bff; background: #ebe9ff; font-weight: 650; }
    .nav-link.dim { color: #a3acb9; }
    .content { padding: 58px clamp(42px, 5vw, 82px) 100px; max-width: 850px; }
    .breadcrumbs { color: #8792a2; font-size: 13px; margin-bottom: 19px; }
    .breadcrumbs span { color: #a3acb9; margin: 0 7px; }
    h1 { font-size: 38px; line-height: 1.16; letter-spacing: -.035em; margin: 0 0 17px; }
    h2 { font-size: 22px; letter-spacing: -.02em; margin: 0 0 11px; }
    .lede { color: #4f566b; font-size: 17px; max-width: 650px; margin: 0 0 28px; }
    .endpoint { border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 2px rgba(50,50,93,.04); }
    .method { color: var(--green); background: #e7f8f1; font-weight: 800; font-size: 11px; border-radius: 5px; padding: 3px 7px; }
    .endpoint code { color: #3c4257; font-size: 13px; }
    .demo-control { margin: 28px 0 45px; padding: 18px; border: 1px solid #d9d6fe; background: linear-gradient(135deg, #f8f7ff, #f1f4ff); border-radius: 12px; display: flex; align-items: flex-start; flex-direction: column; gap: 14px; }
    .demo-copy { min-width: 0; }
    .demo-label { display: flex; align-items: center; gap: 9px; font-weight: 700; }
    .version-pill { color: #5046e5; background: #e5e2ff; padding: 2px 7px; border-radius: 99px; font-size: 11px; }
    .demo-copy p { margin: 2px 0 0; color: #697386; font-size: 13px; }
    .control-button { width: 100%; flex: none; border: 0; border-radius: 7px; padding: 10px 14px; color: white; background: var(--purple); font-weight: 700; cursor: pointer; box-shadow: 0 2px 5px rgba(99,91,255,.28); }
    .control-button:hover { background: var(--purple-dark); }
    .control-button:disabled { opacity: .6; cursor: wait; }
    .control-status { min-height: 20px; color: #b42318; font-size: 12px; margin-top: 5px; }
    .section-heading { border-bottom: 1px solid var(--line); padding-bottom: 11px; margin-bottom: 2px; }
    .attribute { padding: 22px 0; border-bottom: 1px solid var(--line); }
    .attribute.changed { margin: 12px -18px 0; padding: 20px 18px; border: 1px solid #d9d6fe; background: #fbfaff; border-radius: 9px; }
    .attribute-name { display: flex; align-items: baseline; gap: 10px; }
    .attribute-name code { font-weight: 750; color: #3c4257; }
    .attribute-name span { color: #8792a2; font-size: 12px; }
    .attribute p { color: #4f566b; margin: 5px 0 0; }
    .subfield { color: #697386; font-size: 13px; margin-top: 9px; padding-left: 12px; border-left: 2px solid #d9d6fe; }
    .changelog { margin-top: 48px; padding: 24px; border-radius: 11px; border: 1px solid #f3c4c4; background: #fff8f7; }
    .changelog .eyebrow { color: #c4320a; text-transform: uppercase; letter-spacing: .08em; font-size: 11px; font-weight: 800; margin-bottom: 5px; }
    .changelog p { margin: 0; color: #4f566b; }
    .changelog code { color: #b42318; background: #fee4e2; padding: 1px 4px; border-radius: 4px; }
    .code-panel { background: var(--code); color: #c1c9d2; padding: 46px 34px; overflow: auto; }
    .code-panel-inner { position: sticky; top: 112px; }
    .code-tabs { display: flex; gap: 20px; border-bottom: 1px solid #24435e; margin-bottom: 22px; }
    .code-tab { padding: 0 2px 10px; color: #7f9bb3; font-size: 12px; }
    .code-tab.active { color: white; border-bottom: 2px solid #80e9ff; }
    .code-title { color: white; font-size: 13px; font-weight: 700; margin-bottom: 10px; display: flex; justify-content: space-between; }
    .code-title span { color: #7f9bb3; font-weight: 400; }
    pre { margin: 0 0 28px; padding: 19px; background: #0d2e49; border: 1px solid #24435e; border-radius: 9px; font-size: 12px; line-height: 1.7; overflow: auto; white-space: pre-wrap; }
    .key { color: #80e9ff; } .string { color: #c5f7a6; } .number { color: #ffd080; } .bool { color: #ff9dce; }
    .response-meta { color: #7f9bb3; font-size: 11px; margin: -18px 0 8px; }
    @media (max-width: 1080px) { .layout { grid-template-columns: 210px 1fr; } .code-panel { grid-column: 2; } }
    @media (max-width: 760px) { .topbar { padding: 0 18px; } .brand { min-width: 0; } .brand small, .search { display: none; } .layout { display: block; } .sidebar { display: none; } .content { padding: 38px 22px 60px; } .code-panel { padding: 32px 22px; } .code-panel-inner { position: static; } .demo-control { align-items: flex-start; flex-direction: column; } .control-button { margin-left: 0; width: 100%; } }
  </style>
</head>
<body data-version="${version}">
  <header class="topbar">
    <div class="brand"><span class="brand-mark">S</span>stripe <small>API Reference mirror</small></div>
    <div class="search" aria-label="Search documentation"><span>⌕</span> Search the docs <kbd>⌘ K</kbd></div>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <div class="nav-title">Get started</div>
      <a class="nav-link" href="#">Introduction</a>
      <a class="nav-link" href="#">Authentication</a>
      <a class="nav-link" href="#">Errors</a>
      <div class="nav-title">Payment Intents</div>
      <a class="nav-link active" href="#payment-intent">The PaymentIntent object</a>
      <a class="nav-link dim" href="#">Create a PaymentIntent</a>
      <a class="nav-link dim" href="#">Retrieve a PaymentIntent</a>
      <a class="nav-link dim" href="#">Confirm a PaymentIntent</a>
      <div class="nav-title">Related objects</div>
      <a class="nav-link dim" href="#">Charges</a>
      <a class="nav-link dim" href="#">Payment Methods</a>
    </aside>
    <main class="content" id="payment-intent">
      <div class="breadcrumbs">API Reference <span>›</span> Payment Intents</div>
      <h1>The PaymentIntent object</h1>
      <p class="lede">A PaymentIntent guides you through the process of collecting a payment from your customer. Track it through its lifecycle as it transitions from creation to completion.</p>
      <div class="endpoint"><span class="method">OBJECT</span><code>payment_intent</code></div>
      <section class="demo-control" aria-label="Sentinel demo control">
        <div class="demo-copy">
          <div class="demo-label">Demo contract <span class="version-pill">${version}</span></div>
          <p>${controlDetail}</p>
          <div class="control-status" id="control-status" role="status"></div>
        </div>
        <button class="control-button" id="contract-control" data-target="${targetVersion}" type="button">${controlLabel}</button>
      </section>
      <h2 class="section-heading">Attributes</h2>
      <article class="attribute"><div class="attribute-name"><code>id</code><span>string</span></div><p>Unique identifier for the object.</p></article>
      <article class="attribute"><div class="attribute-name"><code>object</code><span>string</span></div><p>String representing the object's type. Objects of the same type share the same value.</p></article>
      <article class="attribute"><div class="attribute-name"><code>amount</code><span>integer</span></div><p>Amount intended to be collected by this PaymentIntent, in the smallest currency unit.</p></article>
      <article class="attribute"><div class="attribute-name"><code>currency</code><span>enum</span></div><p>Three-letter ISO currency code, in lowercase.</p></article>
      <article class="attribute"><div class="attribute-name"><code>status</code><span>enum</span></div><p>Status of this PaymentIntent, such as <code>requires_payment_method</code> or <code>succeeded</code>.</p></article>
      ${contractAttribute}
      ${changelog}
    </main>
    <aside class="code-panel">
      <div class="code-panel-inner">
        <div class="code-tabs"><div class="code-tab active">RESPONSE</div><div class="code-tab">REQUEST</div></div>
        <div class="code-title">PaymentIntent <span>JSON</span></div>
        <div class="response-meta">Stripe-Version: ${version}</div>
        <pre>{
  <span class="key">"id"</span>: <span class="string">"pi_demo"</span>,
  <span class="key">"object"</span>: <span class="string">"payment_intent"</span>,
  <span class="key">"amount"</span>: <span class="number">2000</span>,
  <span class="key">"currency"</span>: <span class="string">"usd"</span>,
  <span class="key">"status"</span>: <span class="string">"succeeded"</span>,
  ${responseField}
}</pre>
        <div class="code-title">Retrieve a PaymentIntent</div>
        <pre><span class="method">GET</span> /demo/stripe/v1/payment_intents/pi_demo</pre>
      </div>
    </aside>
  </div>
  <script>
    const button = document.getElementById("contract-control");
    const status = document.getElementById("control-status");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Applying change…";
      status.textContent = "";
      try {
        const response = await fetch(window.location.pathname, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: button.dataset.target })
        });
        if (!response.ok) throw new Error("The contract change could not be applied.");
        window.location.reload();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "The contract change could not be applied.";
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  </script>
</body>
</html>`;
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

export const handleDocsControl = httpAction(async (ctx, request) => {
  const payload: unknown = await request.json().catch(() => null);
  const version = isRecord(payload) ? payload.version : undefined;
  if (version !== OLD_VERSION && version !== NEW_VERSION) {
    return new Response(
      JSON.stringify({ error: { message: "Unsupported contract version" } }),
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
  const result = await ctx.runMutation(
    version === OLD_VERSION ? api.vendor.resetV1 : api.vendor.upgradeV2,
    {},
  );
  return jsonResponse(result, 200, result.activeContractVersion);
});
