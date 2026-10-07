import { v } from 'convex/values';

import { internalMutation, internalQuery, query, type DatabaseReader, type MutationCtx } from './_generated/server';
import { venue } from './validators';
import { addToHour, emptyHours, hourLevels, isHourOfDay, overallLevel, type MeasuredVenue, type Visit } from '../src/lib/venues.ts';

// Keep h3-js out of this module. It allocates a 32 MB heap on import, half a query's memory limit,
// and `list` re-runs for every map viewer after each reading. The Overpass search that needs it is in venueSearch.ts,
// which keeps its results here through `savedSearch` and `saveSearch`.

/**
 * Every venue someone measured, with its level by hour of day. Holds no user ids or timestamps,
 * so it can be public. Venues are only created by a reading, so each has at least one.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<MeasuredVenue[]> => {
    const rows = await ctx.db.query('venues').collect();
    return rows.flatMap(({ osmId, name, kind, latitude, longitude, hours }) => {
      const overall = overallLevel(hours);
      return overall ? [{ osmId, name, kind, latitude, longitude, ...overall, hours: hourLevels(hours) }] : [];
    });
  },
});

/**
 * Adds a reading's level to its venue's hour, creating the venue on its first reading. Called by `measurements.add`.
 * The venue must be one `venueSearch.nearby` listed for the reading's block, which is where its name and position
 * come from. Any other venue, or an hour outside 0–23, records nothing and returns undefined.
 */
export async function recordVisit(ctx: MutationCtx, cell: string, { osmId, hour }: Visit, laeq: number) {
  if (!isHourOfDay(hour)) return undefined;
  const venue = (await searchOf(ctx.db, cell))?.venues.find((listed) => listed.osmId === osmId);
  if (!venue) return undefined;
  const row = await ctx.db
    .query('venues')
    .withIndex('by_osm_id', (q) => q.eq('osmId', osmId))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, { hours: addToHour(row.hours, hour, laeq) });
    return row._id;
  }
  // The first reading names the venue. Later readings only add to its hours.
  return await ctx.db.insert('venues', { ...venue, hours: addToHour(emptyHours(), hour, laeq) });
}

/** The last Overpass result for a block, or null when it was never searched. Called by `venueSearch.nearby`. */
export const savedSearch = internalQuery({
  args: { cell: v.string() },
  handler: async (ctx, { cell }) => await searchOf(ctx.db, cell),
});

/** Replaces a block's saved Overpass result. Called by `venueSearch.nearby`. */
export const saveSearch = internalMutation({
  args: { cell: v.string(), venues: v.array(venue) },
  handler: async (ctx, { cell, venues }) => {
    const row = await searchOf(ctx.db, cell);
    if (row) await ctx.db.patch(row._id, { venues, fetchedAt: Date.now() });
    else await ctx.db.insert('venueSearches', { cell, venues, fetchedAt: Date.now() });
  },
});

function searchOf(db: DatabaseReader, cell: string) {
  return db
    .query('venueSearches')
    .withIndex('by_cell', (q) => q.eq('cell', cell))
    .unique();
}
