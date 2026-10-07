import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables,
  // Every reading anyone added. Private: clients only ever read `cells`.
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
  }).index('by_user_client', ['userId', 'clientId']),
  // One row per hexagon with the summed sound energy of its readings, kept in step by `measurements.add`.
  cells: defineTable({ cell: v.string(), energy: v.number(), count: v.number() }).index('by_cell', ['cell']),
});
