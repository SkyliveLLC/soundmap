import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { calibration, venue } from './validators';

export default defineSchema({
  ...authTables,
  // Every reading anyone added. Private: clients only ever read the aggregates in `cells` and `venues`.
  measurements: defineTable({
    userId: v.id('users'),
    /** Chosen by the phone, so a retried upload is recognized instead of counted twice. */
    clientId: v.string(),
    cell: v.string(),
    at: v.number(),
    laeq: v.number(),
    lamax: v.number(),
    l10: v.number(),
    l90: v.number(),
    durationSec: v.number(),
    /** The phone model and offset the levels were measured with. Absent on readings added before calibration. */
    calibration: v.optional(calibration),
    /** The venue the person said they were in, and the local hour of day the reading was taken. */
    venueId: v.optional(v.id('venues')),
    hour: v.optional(v.number()),
  }).index('by_user_client', ['userId', 'clientId']),
  // One row per hexagon with the summed sound energy of its readings, kept in step by `measurements.add`.
  cells: defineTable({ cell: v.string(), energy: v.number(), count: v.number() }).index('by_cell', ['cell']),
  // A measured OpenStreetMap venue, with 24 hour-of-day energy totals kept in step by `measurements.add`.
  venues: defineTable({
    ...venue.fields,
    hours: v.array(v.object({ energy: v.number(), count: v.number() })),
  }).index('by_osm_id', ['osmId']),
  // The venues OpenStreetMap lists around a block, saved by `venueSearch.nearby` so a block rarely asks Overpass twice.
  venueSearches: defineTable({ cell: v.string(), venues: v.array(venue), fetchedAt: v.number() }).index('by_cell', ['cell']),
});
