import type { GenericId } from "convex/values";

export interface ScrapeSourceArgs {
  productId: GenericId<"products">;
  source: "reddit" | "board";
}

export async function scrapeSource(_args: ScrapeSourceArgs): Promise<never> {
  throw new Error("todo");
}

export async function scanNow(
  _productId: GenericId<"products">,
): Promise<never> {
  throw new Error("todo");
}
