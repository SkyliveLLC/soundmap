import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { energyOf } from '../src/lib/acoustics.ts';
import { overallLevel, removeFromHour } from '../src/lib/venues.ts';

// Keeps one run far inside a mutation's read and write limits, while a flood still clears in a few runs.
const BATCH = 500;

/**
 * Takes one user's readings off the shared map, out of their blocks and venues the way `measurements.add` put them in.
 * Internal, so only the dashboard or `npx convex run` can call it. Removes up to BATCH per run and schedules
 * the next run until the user has none left. Returns how many this run removed.
 */
export const removeUser = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<number> => {
    const batch = await ctx.db
      .query('measurements')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(BATCH);
    for (const { _id, cell, laeq, venueId, hour } of batch) {
      const row = await ctx.db
        .query('cells')
        .withIndex('by_cell', (q) => q.eq('cell', cell))
        .unique();
      if (row && row.count > 1) await ctx.db.patch(row._id, { energy: row.energy - energyOf(laeq), count: row.count - 1 });
      else if (row) await ctx.db.delete(row._id);
      const venue = venueId ? await ctx.db.get('venues', venueId) : null;
      if (venue && hour !== undefined) {
        const hours = removeFromHour(venue.hours, hour, laeq);
        if (overallLevel(hours)) await ctx.db.patch(venue._id, { hours });
        else await ctx.db.delete(venue._id);
      }
      await ctx.db.delete(_id);
    }
    if (batch.length === BATCH) await ctx.scheduler.runAfter(0, internal.moderation.removeUser, { userId });
    return batch.length;
  },
});
