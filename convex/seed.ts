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

const complaintTexts = [
  "Exported my invoices to CSV and the header row is just gone. Excel thinks the first invoice is the column names.",
  "CSV export is broken — no header row, so my accountant's import tool rejects the file every time.",
  "Why does the CSV download skip the header line? I have to add it back by hand before uploading to QuickBooks.",
  "The invoice CSV export drops the header row. Started a week ago, still broken.",
  "Downloaded the CSV export and there are no column headers at all. Please fix, this breaks our monthly reporting.",
];

export const demoComplaints = mutation({
  args: {},
  returns: v.object({ clusterId: v.id("clusters"), inserted: v.number() }),
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    const invoicePilot = products.find((candidate) => candidate.repo === product.repo);
    if (!invoicePilot) throw new Error("Run seed.setupProducts first");

    const existingCluster = (
      await ctx.db
        .query("clusters")
        .withIndex("by_product", (q) => q.eq("productId", invoicePilot._id))
        .collect()
    ).find((candidate) => candidate.title === "CSV export drops header row");
    const clusterId =
      existingCluster?._id ??
      (await ctx.db.insert("clusters", {
        productId: invoicePilot._id,
        title: "CSV export drops header row",
        summary:
          "Users report that the invoice CSV export is missing its header row, breaking downstream imports.",
        kind: "bug",
        count: 0,
        status: "open",
      }));

    let inserted = 0;
    for (const [index, text] of complaintTexts.entries()) {
      const hash = `seed:csv-header:${index}`;
      const existing = await ctx.db
        .query("reviews")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .first();
      if (existing) continue;
      await ctx.db.insert("reviews", {
        productId: invoicePilot._id,
        source: "seed",
        author: `demo-user-${index + 1}`,
        rating: 2,
        text,
        hash,
        clusterId,
      });
      inserted += 1;
    }
    if (inserted > 0) {
      const current = await ctx.db.get("clusters", clusterId);
      await ctx.db.patch("clusters", clusterId, {
        count: (current?.count ?? 0) + inserted,
      });
      await ctx.db.insert("events", {
        productId: invoicePilot._id,
        sentinel: "feedback",
        message: `Seeded ${inserted} demo complaints into the "CSV export drops header row" cluster.`,
        level: "info",
      });
    }
    return { clusterId, inserted };
  },
});
