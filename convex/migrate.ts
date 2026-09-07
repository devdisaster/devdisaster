import { v } from "convex/values";
import type { TableNames } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

// Every table in the schema — `satisfies` makes a table added to the schema
// but missed here a compile error. Convex rejects a push that narrows the
// schema while violating rows exist, so demo migrations start from empty tables.
const ALL_TABLES = {
  products: true,
  integrations: true,
  sessions: true,
  triggerEvents: true,
  docChanges: true,
  incidents: true,
  errors: true,
  events: true,
} satisfies Record<TableNames, true>;

export const wipeAll = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of Object.keys(ALL_TABLES) as TableNames[]) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(table, row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});
