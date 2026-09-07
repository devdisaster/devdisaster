# Email Connector (Gmail) — Architecture Guide

*Handoff document, part of the `ADDONS/` enhancement set. Consumes the `reports` table from `ADDONS/REPORT_PIPELINE.md`. External facts (OAuth behavior, quotas, API shapes) verified against live Google/Resend/Convex docs on 30 Aug 2026.*

**Tags:** `[HACKATHON]` = build for the demo · `[GENERAL]` = production notes.

---

## 0. What this is and the decision up front

When a report is generated, the developer responsible for the product gets it **in their inbox** — full report as a rendered HTML email, sent automatically, with a delivery record in Convex.

**Transport decision (researched, settled):**

| Option | Verdict |
|---|---|
| **Gmail REST API** (`users.messages.send`, OAuth2 refresh token) | ✅ **Primary.** Sends from a real Gmail address with zero domain setup, 500 emails/day — far beyond demo needs. ~30–45 min one-time setup, then two plain HTTPS calls per send. |
| Resend + `@convex-dev/resend` component | ✅ **Documented fallback** (§5). Fastest to first *test* email and the most Convex-native (queueing/retries/webhooks) — but sending to **real** inboxes requires a verified custom domain; without one you can only hit `*@resend.dev` test addresses. That constraint is exactly wrong for "email the developer," so it's the fallback, not the pick. |
| Gmail SMTP + App Password (nodemailer) | ❌ Rejected: static full-account credential, serverless-IP login challenges, no advantage over the API. |
| Nodemailer + OAuth2 over SMTP | ❌ Rejected: requires the *restricted* `https://mail.google.com/` scope; the REST API needs only `gmail.send`. |
| SendGrid | ❌ Rejected: free tier is now a 60-day trial only. |

The connector is written behind a one-function seam (`sendEmail(transport, msg)`) so swapping Gmail→Resend later is a config change, not a rewrite.

---

## 1. One-time Gmail setup (runbook — do this before the event, ~30 min)

1. **Google Cloud Console** (console.cloud.google.com) → new project (e.g. `sentinel-mailer`).
2. **APIs & Services → Library → Gmail API → Enable.**
3. **OAuth consent screen:** User type **External**. Fill the three required fields. Then — **critical** — click **Publish app** so status is **In production**. Left in *Testing*, refresh tokens **expire after exactly 7 days**; this is the #1 way this connector dies silently a week later. Publishing (without full verification review) is sufficient for a single-account sender; the "unverified app" warning during authorization is acceptable — you're authorizing your own account.
4. **Credentials → Create credentials → OAuth client ID → Web application**, with `https://developers.google.com/oauthplayground` added as an authorized redirect URI. Note the Client ID + Secret.
5. **Mint the refresh token once** via the OAuth 2.0 Playground (developers.google.com/oauthplayground): gear icon → *Use your own OAuth credentials* (paste ID+Secret) → in Step 1 enter exactly the scope `https://www.googleapis.com/auth/gmail.send` (narrowest scope; do **not** request `mail.google.com/`) → authorize with the sender Gmail account (a dedicated `sentinel.reports.demo@gmail.com`-style account is cleaner than a personal one) → Step 2 *Exchange authorization code for tokens* → copy the **refresh token**. Afterward, remove the playground redirect URI from the client.
6. **Convex env vars** (dashboard, per deployment):
   `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` · `GOOGLE_SENDER_EMAIL`
7. Smoke-test with one curl pair (§2.2 calls) before writing any Convex code.

The refresh token now lives indefinitely (revoked only by password change, manual revocation, or 6 months of total disuse).

---

## 2. The connector (`convex/email.ts`)

### 2.1 Recipients

Registered at onboarding, stored on the product — additive schema change:

```ts
// products table, add:
notifyEmails: v.optional(v.array(v.string())),   // developers who receive reports
```

### 2.2 Sending — two plain fetches, no SDK

The full `googleapis` package is 30–70 MB and pointless here: token refresh and send are each a single HTTPS call. Keep the action in `"use node"` for `Buffer.from(...).toString("base64url")` (correct URL-safe base64 in one step).

```ts
// convex/email.ts
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { marked } from "marked";

async function gmailAccessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`token refresh failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

export const sendReport = internalAction({
  args: { reportId: v.id("reports"), to: v.optional(v.array(v.string())) },
  handler: async (ctx, { reportId, to }) => {
    const { report, recipients } = await ctx.runQuery(internal.email.loadDeliveryContext, { reportId, to });
    if (recipients.length === 0) return;                     // no notifyEmails configured — fine
    const html = wrapForEmail(await marked.parse(report.markdown), report);   // §2.3

    const token = await gmailAccessToken();
    for (const rcpt of recipients) {
      // idempotency: skip if a sent delivery row already exists for (reportId, rcpt)
      if (await ctx.runQuery(internal.email.alreadySent, { reportId, to: rcpt })) continue;

      const mime = [
        `From: Sentinel <${process.env.GOOGLE_SENDER_EMAIL}>`,   // MUST be the authenticated account (Gmail DMARC)
        `To: ${rcpt}`,
        `Subject: ${encodeSubject(report.title)}`,               // RFC 2047 if non-ASCII
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "",
        html,
      ].join("\r\n");

      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(mime, "utf-8").toString("base64url") }),
      });
      const body = await res.json().catch(() => ({}));
      await ctx.runMutation(internal.email.recordDelivery, {
        reportId, to: rcpt,
        status: res.ok ? "sent" : "failed",
        providerMessageId: body.id ?? null,
        error: res.ok ? null : `${res.status} ${JSON.stringify(body).slice(0, 500)}`,
      });
    }
  },
});
```

(Attachments deliberately absent: per the report pipeline's PDF decision, the email **is** the rendered report — no PDF attachment in the loop. If one is ever needed, switch MIME assembly to `nodemailer/lib/mail-composer` with a `multipart/mixed` body; the send call is unchanged.)

### 2.3 HTML rendering for mail clients

`wrapForEmail` = the marked-rendered body inside a minimal shell: single centered 640px table/div, inline styles only (mail clients strip `<style>` unevenly), system font stack, badge colors matching `statusBadges.ts`, header row with product/agent/date, footer with dashboard deep-link + Devin session link. Keep it boring — bulletproof beats branded. Test render in Gmail web + one phone before the demo.

### 2.4 Delivery records

```ts
emailDeliveries: defineTable({
  reportId: v.id("reports"),
  to: v.string(),
  status: v.union(v.literal("sent"), v.literal("failed")),
  providerMessageId: v.optional(v.string()),
  error: v.optional(v.string()),
}).index("by_report", ["reportId"]).index("by_report_to", ["reportId", "to"]),
```

Semantics, stated honestly: Gmail has no delivery webhooks — `status: "sent"` means *accepted by Gmail*, not *landed in inbox*. Good enough here; Resend (§5) is the upgrade path if true delivery events ever matter.

### 2.5 Trigger + retry + dashboard surface

- Fired by the report pipeline's fan-out (`ctx.scheduler.runAfter(0, internal.email.sendReport, { reportId })`).
- One retry: on `failed`, schedule a single re-attempt after 60s (`runAfter`), tagged in the delivery row; never loop. Persistent failure → `events` row (`level: "warn"`) — the report is still on the dashboard, email is a convenience channel.
- Dashboard: delivery chips on the report row ("📧 sent to a@b.com") + an "Email me this report" button (public mutation → same action with an explicit `to`) — that button is the demo moment.

---

## 3. Limits & failure modes (Gmail path)

| Item | Fact | Consequence |
|---|---|---|
| Daily send cap | ~500/day consumer (recipient-counted), 2000/day Workspace | irrelevant at demo scale; noted for `[GENERAL]` |
| API quota | `messages.send` = 100 units; 6,000 units/min/user ⇒ ~60 sends/min | no batching needed |
| `invalid_grant` | refresh token dead: consent screen left in *Testing* (7-day expiry), revocation, or 6-month disuse | runbook step 3 prevents; error surfaces verbatim in the delivery row |
| From spoofing | DMARC: `From:` must be the authenticated account (or verified alias) | never put the product's name as the From *address*; display name "Sentinel" is fine |
| Spam placement | plain Gmail sender to arbitrary inboxes, low volume | for the demo, send to team-controlled inboxes; `[GENERAL]` move to Resend/domain with SPF+DKIM |
| 400 on send | malformed MIME or non-URL-safe base64 | `base64url` encoding + CRLF line joins as shown |

---

## 4. `[GENERAL]` production posture

A real multi-tenant Sentinel should not send customer notifications from a Gmail account. The seam (§0) swaps in Resend (or any ESP) with: verified sending domain (SPF/DKIM/DMARC), the Convex component's queue/retries/idempotency, and webhook-driven `delivered/bounced/complained` statuses upgrading `emailDeliveries` into a real ledger. Gmail remains the right call for "connect it to *my* Gmail" single-user setups — same connector, transport flag.

## 5. Fallback transport: Resend (documented for the seam)

1. `npm install @convex-dev/resend`; Resend account → API key → `npx convex env set RESEND_API_KEY re_...`.
2. `convex/convex.config.ts`: `app.use(resend)` (component brings queueing, batching, idempotency, rate limiting).
3. Send: `resend.sendEmail(ctx, { from, to, subject, html })` — callable from a plain mutation, no `"use node"`.
4. Gotchas: `testMode: true` by default (only `*@resend.dev` recipients); real recipients need `testMode: false` **and** a From on a **verified custom domain**; free tier 100 emails/day / 3,000 per month; webhook events (`email.delivered`, `email.bounced`, …) verified via `RESEND_WEBHOOK_SECRET`.
5. Use when: a domain exists, or delivery-status webhooks are wanted, or send volume outgrows Gmail caps.

## 6. Build order

1. Runbook §1 (before the event — it's all clicking, no code).
2. Curl smoke test: refresh → send to your own inbox.
3. `emailDeliveries` schema + `loadDeliveryContext` / `alreadySent` / `recordDelivery`.
4. `email.sendReport` action + `wrapForEmail`; send a seeded report to the team inbox; check rendering on phone + web.
5. Hook the fan-out trigger + the "Email me this report" button.
6. Retry-once path + failure `events` row.
