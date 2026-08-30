// Phase 4 — onboarding form submission. Writes only products/integrations rows;
// never touches incident, session, or cluster state.
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const registerProduct = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    repo: v.optional(v.string()),
    subreddit: v.optional(v.string()),
    feedbackUrl: v.optional(v.string()),
    threshold: v.number(),
    integration: v.optional(
      v.object({
        name: v.string(),
        provider: v.string(),
        docsUrl: v.string(),
        endpoint: v.string(),
        integrationPath: v.string(),
        expectedContract: v.string(),
        testCommand: v.string(),
      }),
    ),
  },
  returns: v.object({
    productId: v.id("products"),
    integrationId: v.optional(v.id("integrations")),
  }),
  handler: async (ctx, { integration, ...product }) => {
    const productId = await ctx.db.insert("products", {
      ...product,
      docsUrls: integration ? [integration.docsUrl] : [],
    });
    const integrationId = integration
      ? await ctx.db.insert("integrations", {
          ...integration,
          productId,
          activeContractVersion: "2022-08-01" as const,
          enabled: true,
        })
      : undefined;
    return { productId, integrationId };
  },
});
