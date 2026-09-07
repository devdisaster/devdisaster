# ADDONS/ — Platform Enhancement Guides

Architecture handoff docs for the enhancements layered on top of Agents A (`../AGENT_API_CHANGELOG_SENTINEL.md`) and B (`../AGENT_VENDOR_REPUTATION_SENTINEL.md`). Both agents end at a PR; these four make the outcome legible, visible, delivered, and audible — in that order, because each consumes the previous one's artifact:

| # | Doc | What | Consumes → Produces |
|---|---|---|---|
| 1 | `REPORT_PIPELINE.md` | Plain-language markdown report per terminal agent state, stored in Convex; PDF via print-CSS route | incident/issue graph → `reports` row (single fan-out point) |
| 2 | `DASHBOARD_HISTORY_PANELS.md` | Agents subpage: "Changelog Updates" (Agent A history) + "Reviews Updates" (Agent B history) panels | agent tables + `reports` → paginated reactive history rows |
| 3 | `EMAIL_CONNECTOR.md` | Report delivered to the developer's inbox via the Gmail REST API (Resend as documented fallback) | `reports` row → HTML email + `emailDeliveries` row |
| 4 | `VOICE_CALL_COMPONENT.md` | Isolated `components/voice-caller/` — two inputs (context string, phone number) → AI agent phones the developer. ElevenLabs default, Vapi alternate | `reports` row → call brief string → `voiceCalls` row + transcript |

Build order across the set: 1 → 2 ∥ 3 → 4 (the report is the dependency of everything; panels and email are independent of each other; voice is the garnish and the highest-theater/highest-fragility item — its CLI smoke test should happen early even though its integration lands last).
