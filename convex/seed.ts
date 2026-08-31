import { v } from "convex/values";
import { env, mutation } from "./_generated/server";

const product = {
  name: "InvoicePilot",
  description:
    "A billing SaaS for creating invoices, collecting payments, and drafting invoices from pasted emails using OpenAI chat completions.",
  repo: "devdisaster/invoicepilot",
};

export const setupProducts = mutation({
  args: {},
  returns: v.object({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
  }),
  handler: async (ctx) => {
    const existingProduct = (await ctx.db.query("products").collect()).find(
      (candidate) => candidate.repo === product.repo,
    );
    const productId = existingProduct
      ? existingProduct._id
      : await ctx.db.insert("products", product);

    if (existingProduct) {
      await ctx.db.patch("products", productId, product);
    }

    const integration = {
      productId,
      name: "OpenAI Chat Completions",
      provider: "openai",
      docsUrl: `${env.CONVEX_SITE_URL}/demo/openai/docs`,
      endpoint: "/v1/chat/completions",
      integrationPath: "src/lib/openai.ts",
      expectedContract:
        "Chat Completions accepts the max_tokens parameter to cap completion length; the adapter sends max_tokens on every extraction request.",
      activeContractVersion: "2024-08-06" as const,
      testCommand: "npm test",
      enabled: true,
    };
    const existingIntegration = (
      await ctx.db
        .query("integrations")
        .withIndex("by_product", (q) => q.eq("productId", productId))
        .collect()
    ).find(
      (candidate) =>
        candidate.provider === integration.provider &&
        candidate.endpoint === integration.endpoint,
    );
    const integrationId = existingIntegration
      ? existingIntegration._id
      : await ctx.db.insert("integrations", integration);

    if (existingIntegration) {
      await ctx.db.patch("integrations", integrationId, integration);
    }

    return { productId, integrationId };
  },
});

export const registerMonitor = mutation({
  args: { monitorId: v.string() },
  returns: v.null(),
  handler: async (ctx, { monitorId }) => {
    const integrations = await ctx.db.query("integrations").collect();
    const integration = integrations.find(
      (candidate) => candidate.provider === "openai" && candidate.enabled,
    );
    if (!integration) {
      throw new Error("No enabled OpenAI integration to register the monitor on.");
    }
    await ctx.db.patch("integrations", integration._id, { monitorId });
    return null;
  },
});
