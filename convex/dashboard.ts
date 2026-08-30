import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

const byNewest = <T extends { _creationTime: number }>(rows: T[]) =>
  [...rows].sort((a, b) => b._creationTime - a._creationTime);

export const overview = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    const product =
      products.find((candidate) => Boolean(candidate.repo)) ?? products[0];
    if (!product) return null;

    const [integrations, incidents, clusters, sessions, events] =
      await Promise.all([
        ctx.db
          .query("integrations")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .collect(),
        ctx.db
          .query("incidents")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .collect(),
        ctx.db
          .query("clusters")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .collect(),
        ctx.db
          .query("sessions")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .collect(),
        ctx.db
          .query("events")
          .withIndex("by_product", (q) => q.eq("productId", product._id))
          .collect(),
      ]);

    const sessionById = new Map(
      sessions.map((session) => [session._id, session]),
    );
    return {
      product,
      integrations: integrations.map(
        ({ cachedResponse: _cachedResponse, ...integration }) => integration,
      ),
      incidents: byNewest(incidents).map((incident) => ({
        ...incident,
        session: incident.sessionId
          ? (sessionById.get(incident.sessionId) ?? null)
          : null,
      })),
      clusters: byNewest(clusters).map((cluster) => ({
        ...cluster,
        session: cluster.sessionId
          ? (sessionById.get(cluster.sessionId) ?? null)
          : null,
      })),
      sessions: byNewest(sessions),
      events: byNewest(events).slice(0, 60),
    };
  },
});

export const incidentTimeline = query({
  args: { incidentId: v.id("incidents") },
  returns: v.any(),
  handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("incidents", incidentId);
    if (!incident) return null;
    const [events, docChanges, errors, triggerEvents] = await Promise.all([
      ctx.db
        .query("events")
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
        .query("triggerEvents")
        .withIndex("by_incident", (q) => q.eq("incidentId", incidentId))
        .collect(),
    ]);
    let session: Doc<"sessions"> | null = null;
    if (incident.sessionId) {
      session = await ctx.db.get("sessions", incident.sessionId);
    }
    return { incident, events, docChanges, errors, triggerEvents, session };
  },
});
