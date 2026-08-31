// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  products: defineTable({
    name: v.string(),
    description: v.string(),           // fed into Devin prompts
    repo: v.optional(v.string()),      // "org/invoicepilot" — ABSENT = observer mode (no Devin)
  }),

  integrations: defineTable({          // one InvoicePilot integration for the hackathon
    productId: v.id("products"),
    name: v.string(),                  // "OpenAI Chat Completions"
    provider: v.string(),              // "openai"
    docsUrl: v.string(),               // the controlled docs mirror URL
    endpoint: v.string(),              // "/v1/chat/completions"
    integrationPath: v.string(),       // "src/lib/openai.ts"
    expectedContract: v.string(),      // concise customer-expected response contract
    activeContractVersion: v.union(v.literal("2024-08-06"), v.literal("2024-09-12")),
    testCommand: v.string(),           // "npm test"
    monitorId: v.optional(v.string()),
    enabled: v.boolean(),
  }).index("by_product", ["productId"]).index("by_monitor", ["monitorId"]),

  sessions: defineTable({              // Devin agent runs
    productId: v.id("products"),
    trigger: v.literal("incident"),
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
    sentinel: v.string(),              // "integration" | "system"
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),
});
