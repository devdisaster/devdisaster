# Prompt for the devdisaster/landing session

Copy everything below the line into a Claude Code session opened in the
`devdisaster/landing` repo.

---

Update this landing page (Next.js; all copy lives in `src/lib/content.ts`, sections in
`src/components/sections/`) to match the product as it now actually exists, and
sharpen its commercial story. Two kinds of changes: **truth alignment** and
**commercial sharpening**. Read `content.ts` fully first.

## Context: what the product is now

Kevin watches a third-party API provider's docs for breaking changes, has Claude prove
the change breaks the customer's code (citing the changed contract element AND the
customer's exact code lines), and only then launches a Devin session that patches the
adapter, adds a regression test, runs the tests, and opens a PR. Never auto-merges.
Dashboard streams every incident transition live via Convex.

The demo story changed: it now replays **OpenAI's real `max_tokens` →
`max_completion_tokens` breaking change** (shipped with o-series models, Sept 2024 —
publicly broke LangChain, Zed, Ollama, n8n). The demo customer is InvoicePilot, a
billing SaaS drafting invoices from pasted emails via OpenAI chat completions; the fix
PR is a clean one-line rename plus a regression test. **All Stripe references in the
copy must go.** Stripe is actually a poor villain (per-account API version pinning
protects integrators) — don't reintroduce it except in neutral lists of "APIs your
product depends on."

## Truth alignment (these claims are currently wrong on the page)

1. **Remove the Feedback agent entirely.** The `agents` array lists "Feedback" as
   `kind: "Included"` — it was cut from the product. Delete the card or fold the idea
   into the "Your next agent" extensibility card as one example signal source. The
   `problems` array's third card ("Feedback / Weeks / complaint pattern") must also go
   or be reframed as future scope. Same for any FAQ answer about complaint clusters.
2. **Soften the monitor claim.** `pipeline[0]` says "A Context.dev monitor flags a
   semantic change…". Reality: docs retrieval goes through the Context.dev scrape API
   (real), the signed webhook endpoint exists and is production-ready, but live change
   detection in the demo is a scripted scan (the account is at its monitor cap). Say
   "Kevin watches your provider's docs" without naming a specific detection mechanism,
   or "docs monitoring built on Context.dev" — don't claim a running monitor.
3. **Swap the demo narrative.** `problems[0]` cites Stripe's 2022-11-15 charges
   removal → replace with the OpenAI max_tokens story. The FAQ "Which providers are
   supported?" answer mentions replaying a Stripe change → now OpenAI.
4. The hero `subline` names Stripe → rewrite around AI-era providers ("OpenAI, payment
   processors, tax APIs — the services your product is built on").

## Commercial sharpening (what the hackathon pitch lacked: ICP, market, problem)

State these explicitly on the page, not between the lines:

- **ICP, named early**: B2B SaaS teams of 2–15 engineers whose product depends on
  revenue-critical third-party APIs (LLM providers, payments, tax, shipping,
  messaging) and who have no platform team; agencies/studios running many client apps
  on the same handful of integrations (one provider change = one incident and one PR
  *per client*); solo founders. The `audience` section has the raw material — elevate
  it: move it up the page, give it numbers.
- **The problem, quantified and current**: a typical SaaS is built on 10–30 external
  APIs. Providers ship deprecations on their own clock, and the AI era accelerated it
  — OpenAI alone deprecated models, parameters, and an entire API surface (Assistants)
  inside two years. Every deprecation email is unplanned work with a deadline someone
  else set. The current `problems` metric mechanic (Days → outage / Hours → first
  commit) is good; keep it.
- **Positioning, one line**: "From vendor changelog to reviewed repair PR — before
  your customers notice." The moat framing: the impact gate (proof before action) is
  what separates Kevin from "pipe a webhook into a coding agent."
- **The market moment**: teams already let AI agents write code; the missing piece is
  the *evidence layer* that decides when an agent should act. Kevin is that layer for
  third-party breakage.

Keep the existing tone (confident, concrete, no hype-words), the "Kevin (not Devin)"
brand, and the safety section as-is — it's good. Keep the demo-video placeholder
section; a 30–36s demo video is coming for that slot (storyboard:
`docs/DEMO_VIDEO_STORYBOARD.md` in the greenling repo).

## Verify

`npm run build` clean; every section renders with the new content; grep
case-insensitively for "stripe", "feedback", "cluster", "reddit", "monitor" and
confirm each remaining hit is intentional.
