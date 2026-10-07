import { internalMutation } from './_generated/server';

/**
 * Empties the shared map so a verification run starts clean: `npx convex run dev:resetMap`.
 * Internal, so apps can't call it, and it refuses unless the deployment sets SOUNDMAP_ALLOW_RESET=true,
 * which only the dev deployment does.
 */
export const resetMap = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.SOUNDMAP_ALLOW_RESET !== 'true') throw new Error('resetMap is disabled on this deployment');
    for (const table of ['measurements', 'cells', 'venues'] as const) {
      for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
    }
  },
});
