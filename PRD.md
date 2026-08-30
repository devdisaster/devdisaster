# PRD — Sentinel (working name)

*Collabute × TheBlock AI Hackathon, Dubai — 30 Aug 2026*
*Team: Shashwat (SWE), Iyad (PM), Moein (Product Designer), Ash (Business Lead)*

---

## One-liner

An autonomous maintenance team for dev teams that can't afford to stop shipping: AI sentinels watch your users' complaints, your upstream dependencies, and your production errors — and when something crosses a threshold, Devin ships the fix PR before you've even read the reviews.

## Problem

Small and mid-size product teams face a brutal trade-off: every hour spent on maintenance is an hour not spent shipping. Three signals that should drive fixes go systematically unused:

1. **User complaints are honest bug reports that nobody reads.** Reviews on Google Play, Trustpilot, and Reddit contain precise, reproducible bug descriptions — but they arrive scattered across platforms, buried in noise, and by the time a pattern is visible in churn metrics, it's too late.
2. **Upstream API docs change silently.** A provider renames an endpoint or deprecates a field, the docs update quietly, and your integration breaks days later in production.
3. **Production errors surface after users are already hurt.** By the time someone triages the error spike, correlates it with a change, and assigns a fix, hours have passed.

The common thread: these are all *external signals* that demand *code changes*, and the loop from signal → diagnosis → fix is entirely manual today.

## Solution

Sentinel closes that loop. Each **sentinel** is an autonomous agent defined by three things: a signal source it watches, a trigger condition, and a fix mandate. When triggered, it launches a **Devin session** against your repo with full evidence, and Devin opens the pull request. Humans stay in the loop exactly once — at PR review.

### The sentinels

**1. Feedback Sentinel** *(core)*
- Continuously pulls reviews and posts about your product from Google Play, Trustpilot, and Reddit via Context.dev's scraping API (Convex cron).
- Every new complaint is classified by Claude into an issue cluster ("login crash on Android 15", "CSV export broken") — attached to an existing cluster or founding a new one.
- When a cluster crosses the configured threshold (e.g. 5 complaints), the sentinel compiles the evidence (actual review texts, frequency, severity) into a Devin session prompt. Devin locates the bug in the repo and opens a fix PR.
- Dashboard shows the live complaint feed, clusters with threshold meters, and the Devin session timeline through to the PR link.

**2. Docs Sentinel** *(core)*
- A Context.dev **monitor** with semantic change detection watches the API documentation pages of services your product integrates with.
- When the docs meaningfully change, Context.dev fires a signed webhook into our Convex backend. Claude summarizes what changed and whether it's breaking.
- If breaking, the sentinel launches Devin to update the integration code and open a PR — before the change ever breaks production.

**3. Incident Sentinel** *(stretch)*
- The product streams runtime errors to a Sentinel ingest endpoint. On an error spike, the sentinel declares an incident, posts live status updates to the war-room feed, and launches Devin on the hotfix.
- Demo: a "break production" button pressed live on stage — dashboard goes red, incident declared, Devin already working while we're still talking.

### The narrative

Three time-horizons of the same problem:
- **Feedback Sentinel** — lagging signal (users already hurt)
- **Docs Sentinel** — leading signal (breakage about to happen)
- **Incident Sentinel** — real-time signal (breaking right now)

Adding a sentinel is a config, not a project: any signal source + trigger + prompt template plugs into the same spine. Obvious next sentinels: CVE feeds, status pages, log anomaly detection, App Store (iOS) reviews.

## Target users

- **Primary:** small product teams (2–15 engineers) with a live consumer or B2B product, no dedicated support-engineering or platform team, drowning in maintenance backlog.
- **Secondary:** agencies and studios maintaining many client apps; solo founders running products on the side.

## What the demo shows (user journey)

The demo runs on **real data throughout** — two products configured side by side on the dashboard:

- **Revolut (observer mode)** — the demo opens here: Sentinel scraping Revolut's *real* Trustpilot reviews, Play Store reviews, and r/Revolut posts, with Claude clustering hundreds of genuine complaints live. This is "what Sentinel looks like pointed at a real business." No Devin step (we don't own their repo) — which itself demonstrates the permission model.
- **Acme Invoicing (full loop)** — our demo SaaS, whose repo we own. Its complaints are *real too*: a real subreddit (r/AcmeName) where real posts are made — including live on stage. Acme genuinely integrates the Frankfurter currency-exchange API, and the Docs Sentinel monitors Frankfurter's real documentation plus the vendor config page Acme reads from.

The journey:
1. **Onboard a product** — paste your GitHub repo, Play Store ID, Trustpilot domain, subreddit, and the docs URLs you depend on. That's the entire setup.
2. Dashboard fills with live complaints scraped from real sources (Revolut at scale; Acme from its subreddit).
3. A complaint posted on Reddit → scraped → clustered → threshold crossed → Devin session spawns automatically → minutes later a PR appears with the fix, linked from the dashboard.
4. An upstream vendor docs page changes → Context.dev monitor fires a webhook → dashboard lights up → Devin PRs the integration update.
5. *(Stretch)* Production "breaks" (live button press) → incident declared in the war-room feed → hotfix PR.

## Scope decisions (explicit non-goals for the hackathon)

- **No auto-posting replies to reviewers** — requires owning the business profiles; cut entirely.
- **No auto-merge** — Devin opens PRs; humans review. This is a feature, not a limitation (judges will ask about safety).
- **No voice/call interface** — the war-room is a text feed. Voice is demo theater with real integration risk.
- **No multi-tenant auth** — one team, seeded products; the onboarding form demonstrates the multi-product model.

## How each partner technology is used (submission-form draft)

**Devin by Cognition** — Devin is the hands of the product. Sentinels programmatically create Devin sessions via the API (`POST /v1/sessions`) with evidence-rich prompts and a structured output schema; our backend polls session status and surfaces the resulting `pull_request.url` live on the dashboard. Every fix PR in the demo was authored autonomously by Devin. We also used Devin interactively to scaffold the demo target application. Without Devin there is no product — detection without remediation is just another analytics tool.

**Convex** — Convex is the entire backend and nervous system: the database (products, reviews, clusters, sessions, incidents), cron jobs that drive scraping, actions that call Context.dev/Claude/Devin, HTTP actions that receive Context.dev's signed webhooks, and the Workflow component (`@convex-dev/workflow`) that durably orchestrates the Devin session lifecycle (launch → poll → record PR) with automatic retries. The dashboard is fully reactive via Convex `useQuery` subscriptions — every complaint, cluster update, and Devin status change streams to the UI live with zero refresh.

**Context.dev** — Context.dev is the senses. The Feedback Sentinel uses the scraping API (markdown + structured JSON-LD extraction, residential proxy for Trustpilot) to pull reviews from Google Play, Trustpilot, and Reddit. The Docs Sentinel uses Context.dev Monitors with semantic change detection — natural-language instructions define which changes matter, and signed webhooks deliver changes straight into our Convex backend. Two distinct Context.dev capabilities, both load-bearing.

## Judging-criteria mapping

| Criterion | Weight | Our answer |
|---|---|---|
| Product Value | 25% | Real, universal pain (maintenance vs. shipping); tight ICP (small teams); the demo *is* the value prop |
| Technical Execution | 25% | Working end-to-end pipeline: live scrape → LLM clustering → threshold → real Devin PR on a real repo, live on stage |
| Partner Integration | 25% | All three are load-bearing: Context = senses, Convex = nervous system, Devin = hands. Remove any one and the product ceases to exist |
| Innovation | 15% | The closed loop is the novelty: external signals (not tickets) autonomously driving code changes; "sentinel = source + trigger + mandate" as an extensible primitive |
| Demo & Clarity | 10% | Scripted 3-min arc with a live PR opening; backup video recorded; deterministic seeded-data path |

## Success criteria for the day

1. By 12:30 — one Devin session launched from Convex has opened a PR on the demo repo (hard checkpoint).
2. By 15:00 — both core sentinels run end-to-end; dashboard live.
3. By 16:30 — submission complete: repo link, demo, partner explanations, backup video.

## Disclosure of pre-existing assets (per rules)

- Prepared before the event (permitted prep): accounts, API keys, GitHub org, the Acme subreddit (empty community, no code), this PRD/plan, empty repo scaffolding.
- Built during the event: all product code, the demo target app, all integrations.
- Third-party: Convex components (`@convex-dev/workflow`), shadcn/ui, Vite/React — standard open-source libraries, disclosed.
