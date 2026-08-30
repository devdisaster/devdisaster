// Phase 4 — read-only dashboard queries. UI-shaped projections over the shared
// Phase 0 schema. No writes, no incident-state transitions here.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

const ACTIVE_INCIDENT_STATUSES = new Set([
  "detected",
  "gathering_context",
  "diagnosing",
  "needs_review",
  "repair_queued",
  "repairing",
  "validating",
]);

const sessionSummaryValidator = v.object({
  _id: v.id("sessions"),
  status: v.string(),
  testStatus: v.optional(
    v.union(v.literal("passed"), v.literal("failed"), v.literal("unknown")),
  ),
  testSummary: v.optional(v.string()),
  prUrl: v.optional(v.string()),
  prNumber: v.optional(v.number()),
  devinUrl: v.string(),
  createdAt: v.number(),
});

type SessionSummary = {
  _id: Id<"sessions">;
  status: string;
  testStatus?: "passed" | "failed" | "unknown";
  testSummary?: string;
  prUrl?: string;
  prNumber?: number;
  devinUrl: string;
  createdAt: number;
};

const toSessionSummary = (
  session: Doc<"sessions"> | null,
): SessionSummary | null =>
  session
    ? {
        _id: session._id,
        status: session.status,
        testStatus: session.testStatus,
        testSummary: session.testSummary,
        prUrl: session.prUrl,
        prNumber: session.prNumber,
        devinUrl: session.devinUrl,
        createdAt: session._creationTime,
      }
    : null;

const primaryProduct = async (ctx: QueryCtx) => {
  const products = await ctx.db.query("products").collect();
  return products.find((product) => product.repo) ?? products[0] ?? null;
};

const incidentSources = async (
  ctx: QueryCtx,
  incidentId: Id<"incidents">,
): Promise<("docs" | "runtime")[]> => {
  const triggers = await ctx.db
    .query("triggerEvents")
    .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
    .collect();
  return [...new Set(triggers.map((trigger) => trigger.source))];
};

// Drives the pipeline hero: monitor info + the current incident's journey.
export const overview = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      product: v.object({
        _id: v.id("products"),
        name: v.string(),
        repo: v.optional(v.string()),
      }),
      integration: v.union(
        v.null(),
        v.object({
          _id: v.id("integrations"),
          name: v.string(),
          provider: v.string(),
          endpoint: v.string(),
          docsUrl: v.string(),
          integrationPath: v.string(),
          activeContractVersion: v.string(),
          enabled: v.boolean(),
          monitorConfigured: v.boolean(),
        }),
      ),
      latestChange: v.union(
        v.null(),
        v.object({
          _id: v.id("docChanges"),
          summary: v.string(),
          isBreaking: v.boolean(),
          affectedEndpoints: v.array(v.string()),
          url: v.string(),
          incidentId: v.optional(v.id("incidents")),
          at: v.number(),
        }),
      ),
      currentIncident: v.union(
        v.null(),
        v.object({
          _id: v.id("incidents"),
          title: v.string(),
          status: v.string(),
          verdict: v.optional(v.string()),
          reason: v.optional(v.string()),
          active: v.boolean(),
          session: v.union(v.null(), sessionSummaryValidator),
          createdAt: v.number(),
        }),
      ),
      openIncidents: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const product = await primaryProduct(ctx);
    if (!product) return null;

    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    const integration =
      integrations.find((candidate) => candidate.enabled) ??
      integrations[0] ??
      null;

    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    const sortedIncidents = [...incidents].sort(
      (a, b) => b._creationTime - a._creationTime,
    );
    const activeIncident = sortedIncidents.find((incident) =>
      ACTIVE_INCIDENT_STATUSES.has(incident.status),
    );
    const currentIncident = activeIncident ?? sortedIncidents[0] ?? null;
    const session = currentIncident
      ? currentIncident.sessionId
        ? await ctx.db.get("sessions", currentIncident.sessionId)
        : await ctx.db
            .query("sessions")
            .withIndex("by_incident", (q) =>
              q.eq("incidentId", currentIncident._id),
            )
            .first()
      : null;

    const latestChange = (
      await ctx.db
        .query("docChanges")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .collect()
    ).sort((a, b) => b._creationTime - a._creationTime)[0];

    return {
      product: {
        _id: product._id,
        name: product.name,
        repo: product.repo,
      },
      integration: integration
        ? {
            _id: integration._id,
            name: integration.name,
            provider: integration.provider,
            endpoint: integration.endpoint,
            docsUrl: integration.docsUrl,
            integrationPath: integration.integrationPath,
            activeContractVersion: integration.activeContractVersion,
            enabled: integration.enabled,
            monitorConfigured: integration.monitorId !== undefined,
          }
        : null,
      latestChange: latestChange
        ? {
            _id: latestChange._id,
            summary: latestChange.summary,
            isBreaking: latestChange.isBreaking,
            affectedEndpoints: latestChange.affectedEndpoints,
            url: latestChange.url,
            incidentId: latestChange.incidentId,
            at: latestChange._creationTime,
          }
        : null,
      currentIncident: currentIncident
        ? {
            _id: currentIncident._id,
            title: currentIncident.title,
            status: currentIncident.status,
            verdict: currentIncident.diagnosisVerdict,
            reason: currentIncident.diagnosisReason,
            active: activeIncident !== undefined,
            session: toSessionSummary(session),
            createdAt: currentIncident._creationTime,
          }
        : null,
      openIncidents: incidents.filter((incident) =>
        ACTIVE_INCIDENT_STATUSES.has(incident.status),
      ).length,
    };
  },
});

// Live watch feed: every detected docs change and runtime failure, newest first.
export const listSignals = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      kind: v.union(v.literal("docs"), v.literal("runtime")),
      summary: v.string(),
      isBreaking: v.optional(v.boolean()),
      affectedEndpoints: v.optional(v.array(v.string())),
      url: v.optional(v.string()),
      endpoint: v.optional(v.string()),
      statusCode: v.optional(v.number()),
      contractVersion: v.optional(v.string()),
      incidentId: v.optional(v.id("incidents")),
      at: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const product = await primaryProduct(ctx);
    if (!product) return [];
    const [docChanges, errors] = await Promise.all([
      ctx.db
        .query("docChanges")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .collect(),
      ctx.db
        .query("errors")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .collect(),
    ]);
    return [
      ...docChanges.map((change) => ({
        _id: change._id,
        kind: "docs" as const,
        summary: change.summary,
        isBreaking: change.isBreaking,
        affectedEndpoints: change.affectedEndpoints,
        url: change.url,
        incidentId: change.incidentId,
        at: change._creationTime,
      })),
      ...errors.map((error) => ({
        _id: error._id,
        kind: "runtime" as const,
        summary: error.message,
        endpoint: error.endpoint,
        statusCode: error.statusCode,
        contractVersion: error.contractVersion,
        incidentId: error.incidentId,
        at: error._creationTime,
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 25);
  },
});

export const listIncidents = query({
  args: { productId: v.optional(v.id("products")) },
  returns: v.array(
    v.object({
      _id: v.id("incidents"),
      title: v.string(),
      status: v.string(),
      verdict: v.optional(v.string()),
      endpoint: v.optional(v.string()),
      sources: v.array(v.union(v.literal("docs"), v.literal("runtime"))),
      session: v.union(v.null(), sessionSummaryValidator),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { productId }) => {
    const product = productId
      ? await ctx.db.get("products", productId)
      : await primaryProduct(ctx);
    if (!product) return [];
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .order("desc")
      .collect();
    return Promise.all(
      incidents.map(async (incident) => {
        const session = incident.sessionId
          ? await ctx.db.get("sessions", incident.sessionId)
          : await ctx.db
              .query("sessions")
              .withIndex("by_incident", (q) => q.eq("incidentId", incident._id))
              .first();
        return {
          _id: incident._id,
          title: incident.title,
          status: incident.status,
          verdict: incident.diagnosisVerdict,
          endpoint: incident.affectedEndpoint,
          sources: await incidentSources(ctx, incident._id),
          session: toSessionSummary(session),
          createdAt: incident._creationTime,
        };
      }),
    );
  },
});

export const incidentDetail = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident) return null;
    const integration = await ctx.db.get(
      "integrations",
      incident.integrationId,
    );
    const [triggers, docChanges, errors, events] = await Promise.all([
      ctx.db
        .query("triggerEvents")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
      ctx.db
        .query("docChanges")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
      ctx.db
        .query("errors")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
      ctx.db
        .query("events")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
    ]);
    const session = incident.sessionId
      ? await ctx.db.get("sessions", incident.sessionId)
      : await ctx.db
          .query("sessions")
          .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
          .first();

    return {
      incident: {
        _id: incident._id,
        title: incident.title,
        status: incident.status,
        verdict: incident.diagnosisVerdict,
        reason: incident.diagnosisReason,
        endpoint: incident.affectedEndpoint,
        docsEvidence: incident.diagnosisEvidence ?? [],
        codeEvidence: incident.codeEvidence ?? [],
        createdAt: incident._creationTime,
      },
      integration: integration
        ? {
            name: integration.name,
            provider: integration.provider,
            endpoint: integration.endpoint,
            integrationPath: integration.integrationPath,
            expectedContract: integration.expectedContract,
          }
        : null,
      triggers: triggers
        .map((trigger) => ({
          _id: trigger._id,
          source: trigger.source,
          summary: trigger.summary,
          at: trigger._creationTime,
        }))
        .sort((a, b) => a.at - b.at),
      docChanges: docChanges
        .map((change) => ({
          _id: change._id,
          summary: change.summary,
          url: change.url,
          isBreaking: change.isBreaking,
          affectedEndpoints: change.affectedEndpoints,
          at: change._creationTime,
        }))
        .sort((a, b) => a.at - b.at),
      errors: errors
        .map((error) => ({
          _id: error._id,
          message: error.message,
          endpoint: error.endpoint,
          statusCode: error.statusCode,
          contractVersion: error.contractVersion,
          at: error._creationTime,
        }))
        .sort((a, b) => a.at - b.at),
      timeline: events
        .map((event) => ({
          _id: event._id,
          message: event.message,
          level: event.level,
          sentinel: event.sentinel,
          at: event._creationTime,
        }))
        .sort((a, b) => a.at - b.at),
      session: toSessionSummary(session),
    };
  },
});

export const listClusters = query({
  args: { productId: v.optional(v.id("products")) },
  returns: v.array(
    v.object({
      _id: v.id("clusters"),
      title: v.string(),
      kind: v.string(),
      count: v.number(),
      threshold: v.number(),
      status: v.string(),
      session: v.union(v.null(), sessionSummaryValidator),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { productId }) => {
    const product = productId
      ? await ctx.db.get("products", productId)
      : await primaryProduct(ctx);
    if (!product) return [];
    const clusters = await ctx.db
      .query("clusters")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .order("desc")
      .collect();
    return Promise.all(
      clusters.map(async (cluster) => ({
        _id: cluster._id,
        title: cluster.title,
        kind: cluster.kind,
        count: cluster.count,
        threshold: product.threshold,
        status: cluster.status,
        session: toSessionSummary(
          cluster.sessionId
            ? await ctx.db.get("sessions", cluster.sessionId)
            : null,
        ),
        createdAt: cluster._creationTime,
      })),
    );
  },
});

export const clusterDetail = query({
  args: { clusterId: v.id("clusters") },
  returns: v.any(),
  handler: async (ctx, { clusterId }) => {
    const cluster = await ctx.db.get("clusters", clusterId);
    if (!cluster) return null;
    const product = await ctx.db.get("products", cluster.productId);
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_cluster", (q) => q.eq("clusterId", clusterId))
      .collect();
    const session = cluster.sessionId
      ? await ctx.db.get("sessions", cluster.sessionId)
      : null;
    return {
      cluster: {
        _id: cluster._id,
        title: cluster.title,
        summary: cluster.summary,
        kind: cluster.kind,
        count: cluster.count,
        threshold: product?.threshold ?? 0,
        status: cluster.status,
        createdAt: cluster._creationTime,
      },
      reviews: reviews
        .map((review) => ({
          _id: review._id,
          source: review.source,
          author: review.author,
          rating: review.rating,
          text: review.text,
          url: review.url,
          at: review._creationTime,
        }))
        .sort((a, b) => b.at - a.at),
      session: toSessionSummary(session),
    };
  },
});
