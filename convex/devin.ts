import type { GenericId } from "convex/values";

export interface LaunchArgs {
  productId: GenericId<"products">;
  incidentId?: GenericId<"incidents">;
  clusterId?: GenericId<"clusters">;
}

export async function launch(_args: LaunchArgs): Promise<never> {
  throw new Error("todo");
}

export async function poll(): Promise<never> {
  throw new Error("todo");
}
