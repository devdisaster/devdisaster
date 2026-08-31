import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { httpAction, internalQuery, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

const OLD_VERSION = "2024-08-06" as const;
const NEW_VERSION = "2024-09-12" as const;
const MAX_REQUEST_BYTES = 64 * 1024;

// The simulated extraction result the customer adapter parses out of
// choices[0].message.content — it must stay a JSON string, not an object.
const EXTRACTED_INVOICE = JSON.stringify({
  customer: "Northstar Labs",
  amountCents: 248000,
  currency: "usd",
  dueDate: "2026-09-30",
});

type ContractVersion = typeof OLD_VERSION | typeof NEW_VERSION;
type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findIntegration = async (
  ctx: Pick<QueryCtx, "db">,
): Promise<Doc<"integrations">> => {
  const integrations: Doc<"integrations">[] = await ctx.db
    .query("integrations")
    .collect();
  const matches = integrations.filter(
    (integration) =>
      integration.provider === "openai" &&
      integration.endpoint === "/v1/chat/completions" &&
      integration.enabled,
  );
  if (matches.length !== 1) {
    throw new Error(
      "Expected exactly one enabled OpenAI Chat Completions integration",
    );
  }
  return matches[0];
};

export const getIntegration = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => findIntegration(ctx),
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
      const integration = await findIntegration(ctx);
      if (integration.activeContractVersion === version) {
        return { changed: false, activeContractVersion: version };
      }
      await ctx.db.patch("integrations", integration._id, {
        activeContractVersion: version,
      });
      await ctx.db.insert("events", {
        productId: integration.productId,
        sentinel: "integration",
        message:
          version === NEW_VERSION
            ? `OpenAI Chat Completions contract changed: max_tokens is deprecated in ${NEW_VERSION}.`
            : `OpenAI Chat Completions contract reset to ${OLD_VERSION}.`,
        level: "info",
      });
      if (version === NEW_VERSION) {
        await ctx.db.insert("events", {
          productId: integration.productId,
          sentinel: "integration",
          message:
            "Context monitor scan scheduled for the changed OpenAI docs page.",
          level: "info",
        });
        await ctx.scheduler.runAfter(4000, internal.demo.monitorScan, {});
      }
      return { changed: true, activeContractVersion: version };
    },
  });

export const resetBaseline = setVersion(OLD_VERSION);
export const shipBreakingChange = setVersion(NEW_VERSION);

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
      "X-Contract-Version": version,
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const requestError = (message: string) => ({
  error: {
    message,
    type: "invalid_request_error",
    param: null,
    code: null,
  },
});

// The verbatim rejection OpenAI returns once max_tokens is unsupported.
const unsupportedParameterError = {
  error: {
    message:
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    type: "invalid_request_error",
    param: "max_tokens",
    code: "unsupported_parameter",
  },
};

const chatCompletion = (model: string, promptBytes: number) => {
  const completionTokens = Math.ceil(EXTRACTED_INVOICE.length / 4);
  const promptTokens = Math.max(24, Math.ceil(promptBytes / 4));
  return {
    id: "chatcmpl-DemoInvoice0001",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "fp_2f2a1c4b9d",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: EXTRACTED_INVOICE,
          refusal: null,
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
};

export const handleChatCompletions = httpAction(async (ctx, request) => {
  const integration: Doc<"integrations"> = await ctx.runQuery(
    internal.vendor.getIntegration,
    {},
  );
  const version = integration.activeContractVersion;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonResponse(
      requestError("Expected a JSON request body"),
      415,
      version,
    );
  }

  const rawBody = await request.text();
  const promptBytes = new TextEncoder().encode(rawBody).byteLength;
  if (promptBytes > MAX_REQUEST_BYTES) {
    return jsonResponse(
      requestError("Request body is too large"),
      413,
      version,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse(
      requestError("Request body is not valid JSON"),
      400,
      version,
    );
  }
  if (
    !isRecord(payload) ||
    typeof payload.model !== "string" ||
    !Array.isArray(payload.messages)
  ) {
    return jsonResponse(
      requestError("Invalid chat completion request"),
      400,
      version,
    );
  }

  // Key presence on the parsed body — never a substring scan of the raw text,
  // because the adapter is free to order or nest its JSON however it likes.
  const sendsMaxTokens = Object.prototype.hasOwnProperty.call(
    payload,
    "max_tokens",
  );
  if (version === NEW_VERSION && sendsMaxTokens) {
    return jsonResponse(unsupportedParameterError, 400, version);
  }

  return jsonResponse(chatCompletion(payload.model, promptBytes), 200, version);
});

const docsPage = (version: ContractVersion) => {
  const isOld = version === OLD_VERSION;
  const tokenParameters = isOld
    ? `<article class="attribute changed">
        <div class="attribute-name"><code>max_tokens</code><span>integer or null</span><span class="pill">Optional</span></div>
        <p>The maximum number of tokens that can be generated in the chat completion. The total length of input tokens and generated tokens is limited by the model's context length.</p>
        <div class="subfield">Send <code>max_tokens</code> to cap completion length and to keep the cost of each request predictable.</div>
      </article>`
    : `<article class="attribute changed">
        <div class="attribute-name"><code>max_completion_tokens</code><span>integer or null</span><span class="pill">Optional</span></div>
        <p>An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens.</p>
        <div class="subfield">This parameter replaces <code>max_tokens</code>. Send <code>max_completion_tokens</code> on every chat completion request.</div>
      </article>
      <article class="attribute deprecated">
        <div class="attribute-name"><code>max_tokens</code><span>integer or null</span><span class="pill warn">Deprecated</span></div>
        <p><strong>Deprecated.</strong> The maximum number of tokens that can be generated in the chat completion. This value is now deprecated in favor of max_completion_tokens, and is not compatible with o-series reasoning models.</p>
        <div class="subfield">Requests that still send max_tokens are rejected with HTTP 400 and the error code unsupported_parameter: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."</div>
      </article>`;
  const changelog = isOld
    ? ""
    : `<section class="changelog" id="changelog">
        <div class="eyebrow">Changelog</div>
        <h2>2024-09-12 — max_tokens is deprecated</h2>
        <p>2024-09-12 — max_tokens is deprecated and not supported for o-series reasoning models; use max_completion_tokens instead.</p>
        <p>Every chat completion request that caps output length must rename the max_tokens field to max_completion_tokens. Requests that keep sending max_tokens fail with HTTP 400 and the error code unsupported_parameter.</p>
      </section>`;
  const requestParameter = isOld
    ? `<span class="key">"max_tokens"</span>: <span class="number">256</span>`
    : `<span class="key">"max_completion_tokens"</span>: <span class="number">256</span>`;
  const targetVersion = isOld ? NEW_VERSION : OLD_VERSION;
  const controlLabel = isOld
    ? "Ship the 2024-09-12 change"
    : "Revert to 2024-08-06";
  const controlDetail = isOld
    ? "Deprecates max_tokens and introduces max_completion_tokens"
    : "Restores max_tokens for the next demo run";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Create chat completion | OpenAI Chat Completions reference mirror</title>
  <style>
    :root { color-scheme: light; --ink: #14161a; --muted: #656d78; --line: #e4e7ec; --accent: #2b3445; --accent-dark: #161d2b; --sidebar: #f8f9fb; --code: #101620; --green: #0e9f6e; --warn: #b42318; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; color: var(--ink); background: white; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    code, pre, .method, .version-pill { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .topbar { height: 68px; border-bottom: 1px solid var(--line); display: flex; align-items: center; padding: 0 32px; position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,.96); backdrop-filter: blur(12px); }
    .brand { display: flex; align-items: center; gap: 11px; min-width: 248px; font-size: 17px; font-weight: 700; color: var(--ink); letter-spacing: -.3px; }
    .brand-mark { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: white; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
    .brand small { color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .02em; border-left: 1px solid var(--line); padding-left: 11px; }
    .search { margin-left: auto; width: min(390px, 40vw); height: 38px; border: 1px solid #d9dee6; border-radius: 8px; display: flex; align-items: center; gap: 9px; padding: 0 12px; color: #8b939f; background: var(--sidebar); font-size: 13px; }
    .search kbd { margin-left: auto; border: 1px solid #d9dee6; background: white; border-radius: 5px; padding: 0 6px; font-size: 11px; }
    .layout { display: grid; grid-template-columns: 248px minmax(480px, 1fr) minmax(360px, 42%); min-height: calc(100vh - 68px); }
    .sidebar { background: var(--sidebar); border-right: 1px solid var(--line); padding: 30px 24px; }
    .nav-title { color: #8b939f; text-transform: uppercase; letter-spacing: .09em; font-size: 11px; font-weight: 750; margin: 22px 10px 8px; }
    .nav-title:first-child { margin-top: 0; }
    .nav-link { display: block; text-decoration: none; color: #4d545f; padding: 7px 10px; border-radius: 6px; font-size: 13px; }
    .nav-link.active { color: white; background: var(--accent); font-weight: 650; }
    .nav-link.dim { color: #a2a9b4; }
    .content { padding: 58px clamp(42px, 5vw, 82px) 100px; max-width: 850px; }
    .breadcrumbs { color: #8b939f; font-size: 13px; margin-bottom: 19px; }
    .breadcrumbs span { color: #a2a9b4; margin: 0 7px; }
    h1 { font-size: 38px; line-height: 1.16; letter-spacing: -.035em; margin: 0 0 17px; }
    h2 { font-size: 22px; letter-spacing: -.02em; margin: 0 0 11px; }
    .lede { color: #4d545f; font-size: 17px; max-width: 650px; margin: 0 0 28px; }
    .endpoint { border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 2px rgba(20,22,26,.04); }
    .method { color: var(--green); background: #e7f8f1; font-weight: 800; font-size: 11px; border-radius: 5px; padding: 3px 7px; }
    .endpoint code { color: #3a4250; font-size: 13px; }
    .demo-control { margin: 28px 0 45px; padding: 18px; border: 1px solid #d5dae3; background: linear-gradient(135deg, #f7f8fb, #eef1f6); border-radius: 12px; display: flex; align-items: flex-start; flex-direction: column; gap: 14px; }
    .demo-copy { min-width: 0; }
    .demo-label { display: flex; align-items: center; gap: 9px; font-weight: 700; }
    .version-pill { color: white; background: var(--accent); padding: 2px 7px; border-radius: 99px; font-size: 11px; }
    .demo-copy p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
    .control-button { width: 100%; flex: none; border: 0; border-radius: 7px; padding: 10px 14px; color: white; background: var(--accent); font-weight: 700; cursor: pointer; box-shadow: 0 2px 5px rgba(43,52,69,.24); }
    .control-button:hover { background: var(--accent-dark); }
    .control-button:disabled { opacity: .6; cursor: wait; }
    .control-status { min-height: 20px; color: var(--warn); font-size: 12px; margin-top: 5px; }
    .section-heading { border-bottom: 1px solid var(--line); padding-bottom: 11px; margin-bottom: 2px; }
    .attribute { padding: 22px 0; border-bottom: 1px solid var(--line); }
    .attribute.changed { margin: 12px -18px 0; padding: 20px 18px; border: 1px solid #d5dae3; background: #f8f9fc; border-radius: 9px; }
    .attribute.deprecated { margin: 12px -18px 0; padding: 20px 18px; border: 1px solid #f3c4c4; background: #fff8f7; border-radius: 9px; }
    .attribute-name { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .attribute-name code { font-weight: 750; color: #39404c; }
    .attribute-name span { color: #8b939f; font-size: 12px; }
    .pill { border: 1px solid var(--line); border-radius: 99px; padding: 1px 8px; font-size: 11px; color: var(--muted); }
    .pill.warn { border-color: #f3c4c4; background: #fee4e2; color: var(--warn); font-weight: 700; }
    .attribute p { color: #4d545f; margin: 5px 0 0; }
    .subfield { color: var(--muted); font-size: 13px; margin-top: 9px; padding-left: 12px; border-left: 2px solid #d5dae3; }
    .attribute.deprecated .subfield { border-left-color: #f3c4c4; }
    .changelog { margin-top: 48px; padding: 24px; border-radius: 11px; border: 1px solid #f3c4c4; background: #fff8f7; }
    .changelog .eyebrow { color: #c4320a; text-transform: uppercase; letter-spacing: .08em; font-size: 11px; font-weight: 800; margin-bottom: 5px; }
    .changelog p { margin: 0 0 10px; color: #4d545f; }
    .changelog p:last-child { margin-bottom: 0; }
    .changelog code { color: var(--warn); background: #fee4e2; padding: 1px 4px; border-radius: 4px; }
    .page-footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); color: #8b939f; font-size: 12px; }
    .code-panel { background: var(--code); color: #c3ccd8; padding: 46px 34px; overflow: auto; }
    .code-panel-inner { position: sticky; top: 112px; }
    .code-tabs { display: flex; gap: 20px; border-bottom: 1px solid #27354a; margin-bottom: 22px; }
    .code-tab { padding: 0 2px 10px; color: #8195ad; font-size: 12px; }
    .code-tab.active { color: white; border-bottom: 2px solid #80e9ff; }
    .code-title { color: white; font-size: 13px; font-weight: 700; margin-bottom: 10px; display: flex; justify-content: space-between; }
    .code-title span { color: #8195ad; font-weight: 400; }
    pre { margin: 0 0 28px; padding: 19px; background: #16202f; border: 1px solid #27354a; border-radius: 9px; font-size: 12px; line-height: 1.7; overflow: auto; white-space: pre-wrap; }
    .key { color: #80e9ff; } .string { color: #c5f7a6; } .number { color: #ffd080; } .bool { color: #ff9dce; }
    .response-meta { color: #8195ad; font-size: 11px; margin: -18px 0 8px; }
    @media (max-width: 1080px) { .layout { grid-template-columns: 210px 1fr; } .code-panel { grid-column: 2; } }
    @media (max-width: 760px) { .topbar { padding: 0 18px; } .brand { min-width: 0; } .brand small, .search { display: none; } .layout { display: block; } .sidebar { display: none; } .content { padding: 38px 22px 60px; } .code-panel { padding: 32px 22px; } .code-panel-inner { position: static; } .demo-control { align-items: flex-start; flex-direction: column; } .control-button { margin-left: 0; width: 100%; } }
  </style>
</head>
<body data-version="${version}">
  <header class="topbar">
    <div class="brand"><span class="brand-mark">{ }</span>OpenAI Chat Completions <small>API Reference mirror</small></div>
    <div class="search" aria-label="Search documentation"><span>⌕</span> Search the docs <kbd>⌘ K</kbd></div>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <div class="nav-title">Get started</div>
      <a class="nav-link" href="#">Introduction</a>
      <a class="nav-link" href="#">Authentication</a>
      <a class="nav-link" href="#">Errors</a>
      <div class="nav-title">Chat</div>
      <a class="nav-link active" href="#create-chat-completion">Create chat completion</a>
      <a class="nav-link dim" href="#">Get chat completion</a>
      <a class="nav-link dim" href="#">List chat completions</a>
      <a class="nav-link dim" href="#">The chat completion object</a>
      <div class="nav-title">Related</div>
      <a class="nav-link dim" href="#">Models</a>
      <a class="nav-link dim" href="#changelog">Changelog</a>
    </aside>
    <main class="content" id="create-chat-completion">
      <div class="breadcrumbs">API Reference <span>›</span> Chat</div>
      <h1>Create chat completion</h1>
      <p class="lede">Creates a model response for the given chat conversation. Send the conversation as a list of messages and read the generated reply from choices[0].message.content.</p>
      <div class="endpoint"><span class="method">POST</span><code>/v1/chat/completions</code></div>
      <section class="demo-control" aria-label="Demo contract control">
        <div class="demo-copy">
          <div class="demo-label">Demo contract <span class="version-pill">${version}</span></div>
          <p>${controlDetail}</p>
          <div class="control-status" id="control-status" role="status"></div>
        </div>
        <button class="control-button" id="contract-control" data-target="${targetVersion}" type="button">${controlLabel}</button>
      </section>
      <h2 class="section-heading">Request body</h2>
      <article class="attribute"><div class="attribute-name"><code>model</code><span>string</span><span class="pill">Required</span></div><p>ID of the model to use. See the model endpoint compatibility table for details on which models work with the Chat Completions API.</p></article>
      <article class="attribute"><div class="attribute-name"><code>messages</code><span>array</span><span class="pill">Required</span></div><p>A list of messages comprising the conversation so far. Each message has a role of system, user, or assistant, and string content.</p></article>
      <article class="attribute"><div class="attribute-name"><code>temperature</code><span>number or null</span><span class="pill">Optional</span></div><p>What sampling temperature to use, between 0 and 2. Higher values make the output more random; lower values make it more focused and deterministic.</p></article>
      ${tokenParameters}
      <article class="attribute"><div class="attribute-name"><code>stop</code><span>string or array</span><span class="pill">Optional</span></div><p>Up to four sequences where the API stops generating further tokens.</p></article>
      <article class="attribute"><div class="attribute-name"><code>stream</code><span>boolean or null</span><span class="pill">Optional</span></div><p>If set, partial message deltas are sent as server-sent events as they become available.</p></article>
      ${changelog}
      <p class="page-footer">Demo docs mirror — replays a real change OpenAI shipped in 2024.</p>
    </main>
    <aside class="code-panel">
      <div class="code-panel-inner">
        <div class="code-tabs"><div class="code-tab active">REQUEST</div><div class="code-tab">RESPONSE</div></div>
        <div class="code-title">Create chat completion <span>JSON</span></div>
        <div class="response-meta">X-Contract-Version: ${version}</div>
        <pre><span class="method">POST</span> /v1/chat/completions
{
  <span class="key">"model"</span>: <span class="string">"gpt-4o-mini"</span>,
  <span class="key">"messages"</span>: [
    { <span class="key">"role"</span>: <span class="string">"system"</span>, <span class="key">"content"</span>: <span class="string">"Extract invoice fields as strict JSON."</span> },
    { <span class="key">"role"</span>: <span class="string">"user"</span>, <span class="key">"content"</span>: <span class="string">"Invoice for Northstar Labs…"</span> }
  ],
  ${requestParameter},
  <span class="key">"temperature"</span>: <span class="number">0</span>
}</pre>
        <div class="code-title">Response <span>chat.completion</span></div>
        <pre>{
  <span class="key">"id"</span>: <span class="string">"chatcmpl-DemoInvoice0001"</span>,
  <span class="key">"object"</span>: <span class="string">"chat.completion"</span>,
  <span class="key">"model"</span>: <span class="string">"gpt-4o-mini"</span>,
  <span class="key">"choices"</span>: [{
    <span class="key">"index"</span>: <span class="number">0</span>,
    <span class="key">"message"</span>: { <span class="key">"role"</span>: <span class="string">"assistant"</span>, <span class="key">"content"</span>: <span class="string">"{\\"customer\\":\\"Northstar Labs\\",…}"</span> },
    <span class="key">"finish_reason"</span>: <span class="string">"stop"</span>
  }]
}</pre>
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
      "X-Contract-Version": integration.activeContractVersion,
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
    version === OLD_VERSION
      ? api.vendor.resetBaseline
      : api.vendor.shipBreakingChange,
    {},
  );
  return jsonResponse(result, 200, result.activeContractVersion);
});
