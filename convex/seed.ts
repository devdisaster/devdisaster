import { v } from "convex/values";
import { env, mutation } from "./_generated/server";

const product = {
  name: "InvoicePilot",
  description:
    "A billing SaaS for creating invoices, collecting Stripe payments, and exporting invoice data.",
  repo: "devdisaster/invoicepilot",
  subreddit: "InvoicePilot",
  feedbackUrl: "https://invoicepilot.example/feedback",
  docsUrls: [`${env.CONVEX_SITE_URL}/demo/stripe/docs`],
  threshold: 5,
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
      name: "Stripe Payments",
      provider: "stripe",
      docsUrl: `${env.CONVEX_SITE_URL}/demo/stripe/docs`,
      endpoint: "/v1/payment_intents",
      integrationPath: "src/lib/stripe.ts",
      expectedContract:
        "PaymentIntent includes charges.data[0] with receipt_url and status.",
      activeContractVersion: "2022-08-01" as const,
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

export async function demoComplaints(): Promise<never> {
  throw new Error("todo");
}
