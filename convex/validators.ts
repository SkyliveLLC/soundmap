import { v } from 'convex/values';

// Validators shared by the schema and the functions. Kept apart from schema.ts so a function importing
// one doesn't load Convex Auth's tables with it.

/** Mirrors `Calibration` in src/lib/calibration.ts. */
export const calibration = v.object({ model: v.string(), offsetDb: v.number(), id: v.union(v.string(), v.null()) });

/** An OpenStreetMap venue as `venueSearch.nearby` finds it. Matches `Venue` in src/lib/venues.ts. */
export const venue = v.object({
  osmId: v.string(),
  name: v.string(),
  kind: v.union(v.literal('cafe'), v.literal('library'), v.literal('coworking')),
  latitude: v.number(),
  longitude: v.number(),
});
