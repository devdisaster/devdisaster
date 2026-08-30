// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  products: defineTable({
    name: v.string(),
    description: v.string(),           // fed into clustering + Devin prompts
    repo: v.optional(v.string()),      // "org/invoicepilot" — ABSENT = observer mode (no Devin)
    subreddit: v.optional(v.string()),
    feedbackUrl: v.optional(v.string()), // public feedback-board page
    docsUrls: v.array(v.string()),
    threshold: v.number(),
  }),

  integrations: defineTable({          // one InvoicePilot integration for the hackathon
    productId: v.id("products"),
    name: v.string(),                  // "Stripe Payments"
    provider: v.string(),              // "stripe"
    docsUrl: v.string(),               // the controlled docs mirror URL
    endpoint: v.string(),              // "/v1/payment_intents"
    integrationPath: v.string(),       // "src/lib/stripe.ts"
    expectedContract: v.string(),      // concise customer-expected response contract
    activeContractVersion: v.union(v.literal("2022-08-01"), v.literal("2022-11-15")),
    cachedResponse: v.optional(v.any()), // last-good upstream response (wifi fallback)
    testCommand: v.string(),           // "npm test"
    monitorId: v.optional(v.string()),
    enabled: v.boolean(),
  }).index("by_product", ["productId"]).index("by_monitor", ["monitorId"]),

  reviews: defineTable({
    productId: v.id("products"),
    source: v.union(v.literal("reddit"), v.literal("board"), v.literal("seed")),
    author: v.string(),
    rating: v.optional(v.number()),
    text: v.string(),
    url: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    hash: v.string(),                  // sha256(source+author+text) for dedupe
    clusterId: v.optional(v.id("clusters")),
  }).index("by_hash", ["hash"]).index("by_product", ["productId"]).index("by_cluster", ["clusterId"]),

  clusters: defineTable({
    productId: v.id("products"),
    title: v.string(),                 // "CSV export drops header row"
    summary: v.string(),
    kind: v.union(v.literal("bug"), v.literal("feature_request"), v.literal("other")),
    count: v.number(),
    status: v.union(v.literal("open"), v.literal("triggered"), v.literal("pr_open"), v.literal("dismissed")),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]),

  sessions: defineTable({              // Devin agent runs
    productId: v.id("products"),
    trigger: v.union(v.literal("feedback"), v.literal("docs"), v.literal("incident")),
    clusterId: v.optional(v.id("clusters")),
    incidentId: v.optional(v.id("incidents")),
    devinSessionId: v.string(),
    devinUrl: v.string(),
    status: v.string(),                // mirror of status_enum
    testStatus: v.optional(v.union(v.literal("passed"), v.literal("failed"), v.literal("unknown"))),
    testSummary: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prompt: v.string(),
    structuredOutput: v.optional(v.any()),
  }).index("by_devin_id", ["devinSessionId"]).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  triggerEvents: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    source: v.union(v.literal("docs"), v.literal("runtime")),
    fingerprint: v.string(),           // integration + endpoint + observed contract version
    summary: v.string(),
    raw: v.any(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_fingerprint", ["fingerprint"]).index("by_incident", ["incidentId"]),

  docChanges: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    monitorId: v.string(),
    url: v.string(),
    summary: v.string(),
    isBreaking: v.boolean(),
    affectedEndpoints: v.array(v.string()),
    raw: v.any(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  incidents: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    fingerprint: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("detected"), v.literal("gathering_context"), v.literal("diagnosing"),
      v.literal("not_impacted"), v.literal("needs_review"), v.literal("repair_queued"),
      v.literal("repairing"), v.literal("validating"), v.literal("repair_proposed"),
      v.literal("repair_failed"),
    ),
    diagnosisVerdict: v.optional(v.union(v.literal("impacted"), v.literal("not_impacted"), v.literal("uncertain"))),
    diagnosisReason: v.optional(v.string()),
    affectedEndpoint: v.optional(v.string()),
    diagnosisEvidence: v.optional(v.array(v.string())),
    codeEvidence: v.optional(v.array(v.string())),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]).index("by_fingerprint", ["fingerprint"]),

  errors: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    message: v.string(),
    stack: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    statusCode: v.optional(v.number()),
    contractVersion: v.optional(v.string()),
    fingerprint: v.string(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  events: defineTable({                // war-room feed — EVERY state change posts here
    productId: v.id("products"),
    incidentId: v.optional(v.id("incidents")),
    sentinel: v.string(),              // "integration" | "feedback" | "system"
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),
});
