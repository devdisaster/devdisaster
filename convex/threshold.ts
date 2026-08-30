import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

const thresholdResult = v.object({
  status: v.union(
    v.literal("triggered"),
    v.literal("below_threshold"),
    v.literal("already_handled"),
    v.literal("observer"),
  ),
});

type ThresholdResult = {
  status: "triggered" | "below_threshold" | "already_handled" | "observer";
};

export const check = internalMutation({
  args: { clusterId: v.id("clusters") },
  returns: thresholdResult,
  handler: async (ctx, { clusterId }): Promise<ThresholdResult> => {
    const cluster = await ctx.db.get("clusters", clusterId);
    if (!cluster) throw new Error("Cluster not found");
    const product = await ctx.db.get("products", cluster.productId);
    if (!product) throw new Error("Cluster product not found");
    if (!product.repo) return { status: "observer" };
    if (cluster.status !== "open") return { status: "already_handled" };
    if (cluster.count < product.threshold) return { status: "below_threshold" };

    await ctx.db.patch("clusters", clusterId, { status: "triggered" });
    await ctx.db.insert("events", {
      productId: product._id,
      sentinel: "feedback",
      message: `Feedback cluster "${cluster.title}" reached ${cluster.count}/${product.threshold}; scheduling Devin.`,
      level: "info",
    });
    await ctx.scheduler.runAfter(0, internal.devin.launch, {
      productId: product._id,
      clusterId,
    });
    return { status: "triggered" };
  },
});

export const forceThreshold = mutation({
  args: { clusterId: v.id("clusters") },
  returns: thresholdResult,
  handler: async (ctx, { clusterId }): Promise<ThresholdResult> => {
    const cluster = await ctx.db.get("clusters", clusterId);
    if (!cluster) throw new Error("Cluster not found");
    const product = await ctx.db.get("products", cluster.productId);
    if (!product) throw new Error("Cluster product not found");
    if (!product.repo) return { status: "observer" };
    if (cluster.status !== "open") return { status: "already_handled" };
    if (cluster.count < product.threshold) {
      await ctx.db.patch("clusters", clusterId, { count: product.threshold });
    }
    await ctx.scheduler.runAfter(0, internal.threshold.check, { clusterId });
    return { status: "triggered" };
  },
});
