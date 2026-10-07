import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { energyOf, levelOf } from '../src/lib/acoustics.ts';
import type { CellAggregate } from '../src/lib/cells.ts';
import { rejectionReason } from '../src/lib/measurement.ts';

/** Adds one reading to the shared map. Safe to retry: a clientId already seen from this user is a no-op. */
export const add = mutation({
  args: {
    clientId: v.string(),
    cell: v.string(),
    at: v.number(),
    summary: v.object({ laeq: v.number(), lamax: v.number(), l10: v.number(), l90: v.number(), durationSec: v.number() }),
  },
  handler: async (ctx, measurement) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError('Not signed in');
    const seen = await ctx.db
      .query('measurements')
      .withIndex('by_user_client', (q) => q.eq('userId', userId).eq('clientId', measurement.clientId))
      .unique();
    if (seen) return;
    const reason = rejectionReason(measurement, Date.now());
    if (reason) throw new ConvexError(reason);

    const { clientId, cell, at, summary } = measurement;
    await ctx.db.insert('measurements', { userId, clientId, cell, at, ...summary });
    const energy = energyOf(summary.laeq);
    const row = await ctx.db
      .query('cells')
      .withIndex('by_cell', (q) => q.eq('cell', cell))
      .unique();
    if (row) await ctx.db.patch(row._id, { energy: row.energy + energy, count: row.count + 1 });
    else await ctx.db.insert('cells', { cell, energy, count: 1 });
  },
});

/** Every measured hexagon with its energy-averaged level. Holds no user ids or timestamps, so it can be public. */
export const cells = query({
  args: {},
  handler: async (ctx): Promise<CellAggregate[]> => {
    const rows = await ctx.db.query('cells').collect();
    return rows.map(({ cell, energy, count }) => ({ cell, laeq: levelOf(energy / count), count }));
  },
});
