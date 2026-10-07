import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { getResolution, isValidCell } from 'h3-js';

import { internal } from './_generated/api';
import { action } from './_generated/server';
import { CELL_RESOLUTION } from '../src/lib/cells.ts';
import { overpassQuery, parseOverpass } from '../src/lib/venue-search.ts';
import type { Venue } from '../src/lib/venues.ts';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Overpass asks clients to identify themselves.
const USER_AGENT = 'Soundmap/1.0 (+https://github.com/SkyliveLLC/soundmap)';
const MAX_NEARBY = 8;
// Places open and close slowly, and the public Overpass server is often overloaded, so a block is searched about once a month.
const SEARCH_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

/**
 * Cafés, libraries and coworking spaces around a block, from OpenStreetMap. Runs here rather than on the
 * phone so Overpass only ever sees our server, and the phone only ever sends the block it already shares.
 * Returns the saved list when Overpass fails, or none, so a failed search just skips the venue question.
 */
export const nearby = action({
  args: { cell: v.string() },
  handler: async (ctx, { cell }): Promise<Venue[]> => {
    if (!(await getAuthUserId(ctx))) throw new ConvexError('Not signed in');
    if (!isValidCell(cell) || getResolution(cell) !== CELL_RESOLUTION) throw new ConvexError('Not a block');
    const saved = await ctx.runQuery(internal.venues.savedSearch, { cell });
    if (saved && Date.now() - saved.fetchedAt < SEARCH_MAX_AGE_MS) return saved.venues;
    try {
      const venues = await searchOverpass(cell);
      // Saved even when the phone gave up waiting, so the next reading here gets the question straight away.
      await ctx.runMutation(internal.venues.saveSearch, { cell, venues });
      return venues;
    } catch (error) {
      console.warn('[venueSearch] Overpass search failed', error);
      return saved?.venues ?? [];
    }
  },
});

async function searchOverpass(cell: string): Promise<Venue[]> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ data: overpassQuery(cell) }).toString(),
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
  return parseOverpass(await response.json(), cell).slice(0, MAX_NEARBY);
}
