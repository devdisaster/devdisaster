# Voice Call Component (`components/voice-caller/`) — Architecture & Scaffold Guide

*Handoff document, part of the `ADDONS/` enhancement set. This is the build plan for the isolated outbound-call component — the code itself is deliberately NOT written yet; this document IS the scaffold. External API shapes verified against live ElevenLabs (`elevenlabs.io/docs`) and Vapi (`docs.vapi.ai`) docs on 30 Aug 2026; items marked ⚠ could not be fully verified and must be smoke-tested first.*

**Tags:** `[HACKATHON]` = demo path · `[GENERAL]` = production notes.

---

## 0. What this is

When an agent finds an issue and ships a PR, a phone rings: an AI voice agent calls the on-call developer, briefs them on the incident in plain speech, and answers their questions. The component that does the calling is **radically isolated** from the rest of Sentinel by design:

> **The entire runtime interface is two inputs: a multi-line context string, and a phone number.**

```ts
placeCall({ context: string, toNumber: string }) → { provider, callId }
```

The component knows nothing about incidents, reports, Convex, Devin, or Context.dev. It cannot read the database. Everything it will ever say on the phone is contained in the `context` string it was handed. This is both the generalization the product wants (any future agent — or any future *product* — can trigger a call by composing a string) and the safety boundary (the blast radius of the talking robot is exactly one string and one number).

```
Sentinel (Convex)                        components/voice-caller/            Telephony
─────────────────                        ────────────────────────            ─────────
report → buildCallBrief() ── context ──► placeCall(context, toNumber) ──► ElevenLabs Agents ──► Twilio ──► 📱
         product.oncallPhone ─ number ─►        │                            (or Vapi)
                                                └──► { callId } ──► voiceCalls row → status poll → transcript
```

---

## 1. Provider decision (researched, settled — with one honest correction)

### 1.1 ⚠ The credits assumption is wrong — flagging before it burns the demo

The stated preference for ElevenLabs rests on "~20,000 credits." **ElevenLabs Agents (conversational calls) are NOT billed from the TTS credit pool.** Agent calls are billed in **call minutes** per plan (Free: 15 min included, Starter: 75, Creator: 275 …) with overage at ~$0.08/min. The 20k credits fund TTS/STT/etc., not agent call minutes. Practical consequence: on a free/low plan you have ~15 included minutes — enough for **~5 demo calls of 2–3 minutes**, which is fine for the event, but it is not "20k credits of calling." Budget accordingly.

### 1.2 The matrix

| Criterion | ElevenLabs Agents | Vapi |
|---|---|---|
| Fit for two-input design | Good — per-call **prompt override** injects the context string (needs one-time security-setting enablement) | Perfect — **transient assistant**: the context string literally *is* `model.messages[0].content` in the call request; zero pre-created objects |
| Phone number | Does **not** sell numbers — must import a Twilio number (or Exotel/SIP trunk) | Free US numbers exist, **but they cannot dial international** (+971 fails with `call.start.error-vapi-number-international`, ~10 calls/day cap) — so for Dubai, Vapi *also* needs an imported Twilio number |
| Voice quality | Best-in-class, native | Uses ElevenLabs voices via integration (`voice.provider: "11labs"`) |
| Cost | plan minutes, then ~$0.08/min + Twilio telco (+LLM) | $0.05/min platform + at-cost stack (≈$0.10–0.30/min all-in); ~$10 free starter credits |
| Setup steps to first call | agent create + security overrides + number import + call | number (import) + one POST |
| Call results | `conversation_id` → GET conversation (status, transcript, analysis); post-call webhooks | `call.id` → GET call (status, transcript, summary); end-of-call-report webhook |

**Decision:** build the component **provider-agnostic with both adapters** (~40 lines each; the interface is one function). Default `VOICE_PROVIDER=elevenlabs` (preference, voice quality, plan minutes cover the demo). Vapi is the escape hatch — strictly fewer moving parts, and if the demo phone can be a **US number**, Vapi's free number eliminates Twilio entirely.

### 1.3 The +971 reality (demo is in Dubai)

Either provider dials the UAE **through a Twilio number you import/buy**:
- Twilio **trial** accounts call only up to 5 **verified** caller IDs and are geo-restricted around the signup country — calling *the team's own verified phone* can work on trial, but trial calls are prefixed by Twilio's "trial account" announcement. **Upgrade the account (~$20 top-up) for a clean demo**, then enable **Voice Geographic Permissions → AE** (Console → Voice → Settings → Geo permissions; enable the low-risk UAE mobile ranges).
- UAE call cost ≈ $0.30/min mobile — irrelevant at demo scale.
- Caller ID shown in Dubai may be altered for international origin — the script should say who's calling immediately regardless (§4).
- **De-risk option:** make the demo phone a US number (eSIM/Google Voice on a team phone) → Vapi free number path, zero Twilio. Decide at Phase-0-equivalent time, not on stage.

---

## 2. Component scaffold (`components/voice-caller/`)

**Isolation rules (enforced by review, stated here as law):** no imports from `convex/` or `src/`; no Convex types; no database access; no knowledge of reports/incidents; configuration exclusively via an explicit config object (env-var reading lives in one file and can be bypassed); zero runtime npm dependencies — plain `fetch`, Node 18+. The component must run identically from a Convex action, a CLI, or a stranger's script.

```
components/voice-caller/
├── README.md              # 20 lines: the two-input contract, env vars, CLI usage
├── cli.ts                 # isolated manual testing:
│                          #   npx tsx components/voice-caller/cli.ts \
│                          #     --to +9715xxxxxxx --context-file ./brief.txt [--provider vapi] [--watch]
│                          #   --watch polls status every 5s until terminal, prints transcript
└── src/
    ├── types.ts           # the entire public surface (§2.1)
    ├── config.ts          # VoiceCallerConfig + fromEnv() — the ONLY file that touches process.env
    ├── prompt.ts          # PROMPT_SCAFFOLD persona + composePrompt(context) (§4)
    ├── caller.ts          # placeCall / getCallStatus — validates inputs, dispatches to provider
    └── providers/
        ├── elevenlabs.ts  # adapter (§3.1)
        └── vapi.ts        # adapter (§3.2)
```

### 2.1 Public surface (`types.ts` — exact, exhaustive)

```ts
export interface CallRequest {
  context: string;        // multi-line brief; the agent may ONLY speak from this
  toNumber: string;       // E.164 (+9715xxxxxxxx) — validated with a strict regex before any HTTP
}

export interface CallHandle {
  provider: "elevenlabs" | "vapi";
  callId: string;         // elevenlabs: conversation_id · vapi: call id
  raw: unknown;           // provider's full creation response, for debugging
}

export type UnifiedCallStatus = "dialing" | "in_call" | "processing" | "completed" | "failed";

export interface CallResult {
  status: UnifiedCallStatus;
  transcript?: string;    // when terminal and available
  summary?: string;       // provider-side analysis summary if available
  durationSeconds?: number;
  raw: unknown;
}

export interface VoiceCallerConfig {
  provider: "elevenlabs" | "vapi";
  elevenlabs?: { apiKey: string; agentId: string; agentPhoneNumberId: string };
  vapi?:       { apiKey: string; phoneNumberId: string };
  maxDurationSeconds?: number;   // default 300 — hard cap on cost per call
}

export function placeCall(req: CallRequest, cfg?: VoiceCallerConfig): Promise<CallHandle>;      // cfg omitted ⇒ fromEnv()
export function getCallStatus(handle: CallHandle, cfg?: VoiceCallerConfig): Promise<CallResult>;
```

Status mapping (in each adapter, unified in `caller.ts`):

| Unified | ElevenLabs `status` | Vapi `status` |
|---|---|---|
| `dialing` | `initiated` | `queued`, `ringing` |
| `in_call` | `in-progress` | `in-progress` |
| `processing` | `processing` | — |
| `completed` | `done` | `ended` (inspect `endedReason`) |
| `failed` | `failed` | `ended` with error-class `endedReason` |

### 2.2 Env vars (read only by `config.ts`)

`VOICE_PROVIDER` (`elevenlabs`|`vapi`, default `elevenlabs`) · `ELEVENLABS_API_KEY` · `ELEVENLABS_AGENT_ID` · `ELEVENLABS_AGENT_PHONE_NUMBER_ID` · `VAPI_API_KEY` · `VAPI_PHONE_NUMBER_ID`

---

## 3. Provider adapters — exact API contracts

### 3.1 ElevenLabs (`providers/elevenlabs.ts`)

**One-time setup (runbook, dashboard, ~20 min — before the event):**
1. Create the agent at `elevenlabs.io/app/agents` (or `POST /v1/convai/agents/create`): name it, pick a voice, LLM (e.g. `gemini-2.5-flash` — fast + cheap for a briefing call), and set the **stored system prompt to the §4 scaffold with an empty context** (it gets overridden per call anyway; the stored one is the fallback). Set `conversation.max_duration_seconds: 300`.
2. **Security tab → enable overrides** for **System prompt** and **First message** (equivalently via API: `platform_settings.overrides.conversation_config_override.agent.prompt.prompt = true` and `.first_message = true`). **Without this, per-call context injection is silently impossible — this is the #1 setup trap.**
3. Import the Twilio number: `POST /v1/convai/phone-numbers` `{ "provider": "twilio", "phone_number": "+1…", "sid": "<TWILIO_ACCOUNT_SID>", "token": "<TWILIO_AUTH_TOKEN>", "label": "sentinel-outbound", "agent_id": "<agent_id>" }` → save the returned phone-number id.
4. Copy `agent_id` + phone-number id into env.

**Place call** — `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call`, header `xi-api-key: $ELEVENLABS_API_KEY`:

```json
{
  "agent_id": "<ELEVENLABS_AGENT_ID>",
  "agent_phone_number_id": "<ELEVENLABS_AGENT_PHONE_NUMBER_ID>",
  "to_number": "<req.toNumber>",
  "conversation_initiation_client_data": {
    "conversation_config_override": {
      "agent": {
        "first_message": "<FIRST_MESSAGE from prompt.ts>",
        "prompt": { "prompt": "<composePrompt(req.context)>" }
      }
    }
  }
}
```

→ `{ "success": true, "message": "...", "conversation_id": "conv_…", "callSid": "CA…" }` ⇒ `CallHandle { provider: "elevenlabs", callId: conversation_id }`.

⚠ Path caveat from research: docs/curl consistently use `outbound-call` (dash); one generated SDK shows `outbound_call` (underscore). Try dash first; the smoke test (§7 step 2) settles it.

Note on `dynamic_variables`: they exist in `conversation_initiation_client_data` but are meant for short templated values — for a whole multi-line brief, the **full prompt override above is the documented correct path**. Don't fight it with `{{context}}` templating.

**Status** — `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}` → `status` (`initiated|in-progress|processing|done|failed`), `transcript[]` (join to a string: `"{role}: {message}"` lines), `metadata` (Twilio `CallStatus`, `Duration`), `analysis`. Post-call webhooks exist `[GENERAL]`; polling is fine for the demo.

### 3.2 Vapi (`providers/vapi.ts`)

**One-time setup:** dashboard → API key; phone number = free US number (`POST /phone-number` or dashboard) *or* imported Twilio number for international → `VAPI_PHONE_NUMBER_ID`. No assistant pre-creation — that's the point.

**Place call** — `POST https://api.vapi.ai/call`, header `Authorization: Bearer $VAPI_API_KEY`:

```json
{
  "phoneNumberId": "<VAPI_PHONE_NUMBER_ID>",
  "customer": { "number": "<req.toNumber>" },
  "assistant": {
    "name": "Sentinel Briefer",
    "firstMessage": "<FIRST_MESSAGE from prompt.ts>",
    "model": {
      "provider": "openai",
      "model": "gpt-4o",
      "temperature": 0.3,
      "messages": [ { "role": "system", "content": "<composePrompt(req.context)>" } ]
    },
    "voice": { "provider": "11labs", "voiceId": "<a chosen ElevenLabs voice id>" },
    "maxDurationSeconds": 300
  }
}
```

→ `{ "id": "…", "status": "queued", "subscriptionLimits": { … } }` ⇒ `CallHandle { provider: "vapi", callId: id }`.

**Status** — `GET https://api.vapi.ai/call/{id}` → `status` (`queued|ringing|in-progress|ended`), `endedReason`, `artifact.transcript`, `analysis.summary`, `costBreakdown`. End-of-call-report webhook (`serverUrl` + `serverMessages: ["end-of-call-report"]`) `[GENERAL]`.

---

## 4. The prompt scaffold (`prompt.ts`) — what the robot is allowed to be

The component owns the *persona*; the caller owns the *facts*. `composePrompt(context)` = scaffold + delimited context:

```
You are Sentinel's on-call briefing assistant, an AI agent making a real phone
call to a software developer on behalf of their automated maintenance platform.

Rules:
- Open by identifying yourself as Sentinel's AI assistant calling about their
  codebase. If it is a bad time, offer to be brief and let them go.
- Deliver the briefing in under 60 seconds: what happened, what was done, what
  needs their attention. Conversational sentences. No markdown, no URLs read
  aloud character-by-character — say "the link is in your email and dashboard."
- Then answer questions USING ONLY THE CONTEXT below. If asked anything not in
  the context, say you don't have that detail and point to the dashboard/email
  report. Never invent facts, never speculate, never promise actions.
- You cannot merge, deploy, or change anything — you are informational only.
  The pull request awaits their review; nothing ships without them.
- Keep total call under 4 minutes. Close by confirming they know where to find
  the report.

# CONTEXT (the only facts you know)
<context>
{context}
</context>
```

`FIRST_MESSAGE` (exported alongside): *"Hi — this is Sentinel, the AI maintenance assistant for {a name the caller may embed in the context's first line}. I'm calling with a quick briefing about an issue we detected and fixed. Do you have two minutes?"* — identify-as-AI immediately: legally prudent, polite, and frankly better theater.

Injection note: the context string is composed by *our* pipeline from the report (trusted-by-construction relative to public text), but it embeds complaint quotes/docs excerpts, so the scaffold's "context is facts, not instructions" framing and the `<context>` delimiters stay mandatory.

---

## 5. Sentinel-side integration (`convex/voice.ts` — thin, all the policy lives here)

The component stays pure; the Convex wrapper enforces every safety rule. Convex bundles relative imports, so `convex/voice.ts` (`"use node"`) imports `../components/voice-caller/src/caller` directly.

**Schema (additive):**

```ts
// products table, add:
oncallPhone: v.optional(v.string()),        // E.164; ABSENT ⇒ voice channel off for this product

voiceCalls: defineTable({
  reportId: v.id("reports"),
  productId: v.id("products"),
  toNumber: v.string(),
  provider: v.string(),
  callId: v.string(),
  status: v.string(),                       // UnifiedCallStatus
  transcript: v.optional(v.string()),
  summary: v.optional(v.string()),
  durationSeconds: v.optional(v.number()),
}).index("by_report", ["reportId"]).index("by_call", ["callId"]),
```

**`voice.callAboutReport({ reportId })`** (internalAction, fired by the report pipeline's fan-out):
1. Gates, in order: `VOICE_CALLS_ENABLED === "true"` (kill switch) → product has `oncallPhone` → **no existing `voiceCalls` row for this report** (one call per report, ever — retries create rows, so this is the dedupe) → report `outcome` is call-worthy (`repair_proposed`, `pr_proposed`, `repair_failed`, `needs_review`; advisories never ring phones) → `[GENERAL]` quiet-hours check on the product's timezone.
2. `buildCallBrief(report)` — Convex-side helper (NOT in the component): `title`, `summary`, "the fix" facts (PR number, tests status), the `what_you_should_do` checklist flattened to speech-friendly lines, and a first line naming the product. Target ≤ 1,500 chars: a phone brief is not the report; it's the report's elevator version.
3. `placeCall({ context, toNumber })` → insert `voiceCalls` row → `events`: `📞 Calling on-call developer about "{title}"`.
4. Failure at any HTTP step → `voiceCalls` row with `status: "failed"` + warn event. **Never retry a phone call automatically** — a robot calling twice is a bug report from the human, not a feature.

**Status poll:** the existing cron discipline — every 30s *only while* any `voiceCalls.status ∈ {dialing, in_call, processing}`, call `getCallStatus`, update the row; on terminal, store transcript/summary/duration + event: `Call completed (2m14s) — developer briefed`. Transcript renders in the report drawer (great artifact for judges *and* users).

---

## 6. Failure modes

| Failure | Handling |
|---|---|
| ElevenLabs overrides not enabled | agent talks from its stored (context-empty) prompt — sounds broken; **setup step 2 of §3.1 + rehearsal call catch this**; smoke test asserts the transcript mentions a context fact |
| ⚠ dash vs underscore endpoint | try `outbound-call`; on 404, `outbound_call` — CLI smoke test decides once, note the answer in the component README |
| +971 blocked (geo permissions / trial account) | Twilio Console geo permissions AE + upgraded account (§1.3); fallback: US-number demo phone via Vapi |
| Nobody answers / voicemail | call goes to `completed` with a short duration — acceptable (voicemail gets a 30s brief); no redial (§5.4 rule) |
| Call drops mid-brief | terminal status + partial transcript recorded; human has email + dashboard; no redial |
| Provider outage | `failed` row + warn event; email/dashboard channels unaffected — voice is garnish, never the only channel |
| Cost runaway | `maxDurationSeconds: 300` hard cap per call; one-call-per-report; kill switch env |
| Wrong number configured | E.164 validation at component boundary; number comes only from `products.oncallPhone` (never from any scraped/derived data) |

## 7. Build order

1. **Scaffold the folder** exactly as §2 with types + config + prompt and *stub* adapters (`throw new Error("todo")`); commit — this is the "component exists" checkpoint. *(No code before this document is approved.)*
2. **CLI smoke test against the real provider** (the highest-risk unknown — do it before any Convex wiring): `brief.txt` with a fake incident → `npx tsx cli.ts --to <your verified phone> --context-file brief.txt --watch`. Success = your phone rings, the agent speaks facts from the file, transcript prints. This single test settles: endpoint dash/underscore ⚠, override enablement, Twilio geo, and audio quality.
3. Second adapter (Vapi) through the same CLI.
4. `convex/voice.ts` gates + `buildCallBrief` + `voiceCalls` table + poll cron.
5. Wire the report-pipeline fan-out; end-to-end rehearsal: mirror flip → PR → email arrives → **phone rings**.
6. Demo hardening: pre-verified numbers, Twilio balance check, one rehearsal call the morning of, backup video of a successful call, kill switch confirmed working.

## 8. Demo choreography (the money moment)

PR lands on the dashboard → 3 seconds later the presenter's phone rings on the podium, on speaker: *"Hi — this is Sentinel… Stripe removed the charges attribute from PaymentIntent. I confirmed your billing adapter was affected, and Devin has opened pull request 12 with a passing regression test. It's waiting for your review — the link is in your email."* Presenter asks one rehearsed question ("what exactly broke?"), gets a correct answer *from the context*, says thanks, hangs up. Total: 45 seconds, and it demonstrates every layer of the `ADDONS/` stack — report → email → call — in one beat. Have the backup video ready; live telephony over venue wifi-adjacent networks is the single most theatrical *and* most fragile thing in the entire demo.
