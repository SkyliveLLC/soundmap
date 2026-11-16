import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { energyOf } from '../src/lib/acoustics.ts';
import { overallLevel, removeFromHour } from '../src/lib/venues.ts';

// Keeps one run far inside a mutation's read and write limits, while a flood still clears in a few runs.
const BATCH = 500;

/**
 * Takes one user's readings off the shared map, out of their blocks and venues the way `measurements.add` put them in.
 * Internal, so only the dashboard, `npx convex run`, or `measurements.removeMine` can start it. Removes up to BATCH
 * per run and schedules the next run until the user has none left. Returns how many this run removed.
 */
export const removeUser = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => await removeUserReadings(ctx, userId),
});

/**
 * Takes every reading a block got since `since` (ms since 1970) off the map, whoever added it. For a flood sent from
 * many anonymous users, where removing one user at a time can't keep up. Batched like `removeUser`.
 */
export const removeBlock = internalMutation({
  args: { cell: v.string(), since: v.number() },
  handler: async (ctx, { cell, since }): Promise<number> => {
    const batch = await ctx.db
      .query('measurements')
      .withIndex('by_cell', (q) => q.eq('cell', cell).gte('_creationTime', since))
      .take(BATCH);
    for (const reading of batch) await removeReading(ctx, reading);
    if (batch.length === BATCH) await ctx.scheduler.runAfter(0, internal.moderation.removeBlock, { cell, since });
    return batch.length;
  },
});

/** One batch of `removeUser`, callable from other mutations. Schedules the rest. Returns how many it removed. */
export async function removeUserReadings(ctx: MutationCtx, userId: Id<'users'>): Promise<number> {
  const batch = await ctx.db
    .query('measurements')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const reading of batch) await removeReading(ctx, reading);
  if (batch.length === BATCH) await ctx.scheduler.runAfter(0, internal.moderation.removeUser, { userId });
  return batch.length;
}

// Deletes one reading and takes its energy back out of its block and venue hour, dropping either once it's empty.
async function removeReading(ctx: MutationCtx, { _id, cell, laeq, venueId, hour }: Doc<'measurements'>) {
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
