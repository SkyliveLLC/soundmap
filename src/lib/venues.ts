import type { FeatureCollection, Point } from 'geojson';

import { energyOf, levelOf } from './acoustics.ts';

// Venues come from OpenStreetMap. Their positions are public, so unlike readings they are kept exactly.
// Nothing here imports h3-js, whose 32 MB heap would crowd the `venues.list` query. Search and proximity live in venue-search.ts.

export type VenueKind = 'cafe' | 'library' | 'coworking';

export const VENUE_KIND_LABEL: Record<VenueKind, string> = {
  cafe: 'Café',
  library: 'Library',
  coworking: 'Coworking space',
};

/** A place a reading can be attached to. `osmId` is `node/123`, `way/456` or `relation/789`. */
export type Venue = { osmId: string; name: string; kind: VenueKind; latitude: number; longitude: number };

/**
 * A reading taken at a venue: the venue's OpenStreetMap id, and the local hour of day (0–23) it was taken in.
 * The server takes the venue's name and position from its own search, never from the phone.
 */
export type Visit = { osmId: string; hour: number };

/** Summed sound energy of the readings in one hour of the day, the way `cells` sums a hexagon. */
export type HourTotal = { energy: number; count: number };
/** An hour's energy-averaged level, or null when nobody has measured in that hour. */
export type HourLevel = { laeq: number; count: number } | null;
/** A measured venue as `venues.list` serves it: its level across all hours, and by hour of day. */
export type MeasuredVenue = Venue & { laeq: number; count: number; hours: HourLevel[] };

export const OSM_ID = /^(node|way|relation)\/\d+$/;

export function emptyHours(): HourTotal[] {
  return Array.from({ length: 24 }, () => ({ energy: 0, count: 0 }));
}

/** The 24 totals with one more reading added at `hour`. */
export function addToHour(hours: readonly HourTotal[], hour: number, laeq: number): HourTotal[] {
  return hours.map((total, h) => (h === hour ? { energy: total.energy + energyOf(laeq), count: total.count + 1 } : total));
}

export function hourLevels(hours: readonly HourTotal[]): HourLevel[] {
  return hours.map(({ energy, count }) => (count > 0 ? { laeq: levelOf(energy / count), count } : null));
}

/** The level across every hour together, or null for a venue with no readings. */
export function overallLevel(hours: readonly HourTotal[]): HourLevel {
  const energy = hours.reduce((sum, total) => sum + total.energy, 0);
  const count = hours.reduce((sum, total) => sum + total.count, 0);
  return count > 0 ? { laeq: levelOf(energy / count), count } : null;
}

/** The measured hour with the lowest level. Ties go to the earlier hour. */
export function quietestHour(levels: readonly HourLevel[]): { hour: number; laeq: number } | null {
  return levels.reduce<{ hour: number; laeq: number } | null>(
    (best, level, hour) => (level && (!best || level.laeq < best.laeq) ? { hour, laeq: level.laeq } : best),
    null,
  );
}

/** Venue points for the map, each carrying `osmId` and `laeq`. Layers color them with `LOUDNESS_COLOR`. */
export function venuesToGeoJSON(venues: readonly MeasuredVenue[]): FeatureCollection<Point, { osmId: string; laeq: number }> {
  return {
    type: 'FeatureCollection',
    features: venues.map(({ osmId, laeq, latitude, longitude }) => ({
      type: 'Feature',
      id: osmId,
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: { osmId, laeq },
    })),
  };
}

/** "12 am", "9 am", "12 pm", "6 pm". */
export function formatHour(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'am' : 'pm'}`;
}

export function isHourOfDay(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

/** A visit stored as JSON in the outbox, or null when it is not one. */
export function parseVisit(json: string): Visit | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || !('osmId' in raw) || !('hour' in raw)) return null;
  const { osmId, hour } = raw;
  if (typeof osmId !== 'string' || !OSM_ID.test(osmId) || typeof hour !== 'number' || !isHourOfDay(hour)) return null;
  return { osmId, hour };
}
