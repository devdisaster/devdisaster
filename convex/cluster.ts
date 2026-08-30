import type { GenericId } from "convex/values";

export interface ClusterAssignment {
  action: "attach" | "create" | "ignore";
  clusterId?: GenericId<"clusters">;
  title?: string;
  summary?: string;
  kind?: "bug" | "feature_request" | "other";
}

export async function assign(
  _reviewId: GenericId<"reviews">,
): Promise<never> {
  throw new Error("todo");
}

export async function apply(
  _reviewId: GenericId<"reviews">,
  _assignment: ClusterAssignment,
): Promise<never> {
  throw new Error("todo");
}
