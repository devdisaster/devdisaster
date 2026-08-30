import type { GenericId } from "convex/values";

export interface GatherAndDiagnoseArgs {
  incidentId: GenericId<"incidents">;
}

export async function gatherAndDiagnose(
  _args: GatherAndDiagnoseArgs,
): Promise<never> {
  throw new Error("todo");
}
