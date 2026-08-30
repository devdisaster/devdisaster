import type { GenericId } from "convex/values";

export type TriggerSource = "docs" | "runtime";

export interface ReceiveTriggerArgs {
  productId: GenericId<"products">;
  integrationId: GenericId<"integrations">;
  source: TriggerSource;
  fingerprint: string;
  summary: string;
  raw: unknown;
}

export async function receiveTrigger(
  _args: ReceiveTriggerArgs,
): Promise<never> {
  throw new Error("todo");
}
