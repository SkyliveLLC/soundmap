import { cellToLatLng, gridDistance, isValidCell } from 'h3-js';

import { cellAt } from './cells.ts';
import { OSM_ID, type Venue, type VenueKind } from './venues.ts';

// Finding venues around a block. It needs h3-js, so it stays out of venues.ts.

// A venue counts as "here" within this many H3 rings of the reading's block, about 200 m.
// Wide enough for the block center to sit off the venue, narrow enough that a venue across town is left out.
export const VENUE_MAX_RINGS = 3;
// The Overpass search radius around the block center. It stays inside VENUE_MAX_RINGS.
export const VENUE_SEARCH_RADIUS_M = 150;
const MAX_NAME_LENGTH = 120;

function isNear({ latitude, longitude }: Venue, cell: string): boolean {
  if (!isValidCell(cell) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  try {
    return gridDistance(cellAt(latitude, longitude), cell) <= VENUE_MAX_RINGS;
  } catch {
    // h3 can't measure across a pentagon or between faraway cells. Neither is near.
    return false;
  }
}

/** Overpass QL for named cafés, libraries and coworking spaces around the center of `cell`. */
export function overpassQuery(cell: string): string {
  const [latitude, longitude] = cellToLatLng(cell);
  const around = `(around:${VENUE_SEARCH_RADIUS_M},${latitude.toFixed(6)},${longitude.toFixed(6)})`;
  return `[out:json][timeout:10];
(
  nwr${around}["amenity"~"^(cafe|library|coworking_space)$"]["name"];
  nwr${around}["office"="coworking"]["name"];
);
out center tags;`;
}

/** Venues in an Overpass response that are near `cell`, nearest first. Unusable elements are skipped. */
export function parseOverpass(raw: unknown, cell: string): Venue[] {
  const elements = typeof raw === 'object' && raw !== null && 'elements' in raw ? raw.elements : null;
  if (!Array.isArray(elements)) throw new Error('overpass: response has no elements');
  const [latitude, longitude] = cellToLatLng(cell);
  // Overpass unions are sets, so a coworking space tagged both ways still comes back once.
  return elements
    .map(parseElement)
    .filter((venue): venue is Venue => venue !== null && isNear(venue, cell))
    .sort((a, b) => squaredOffset(a, latitude, longitude) - squaredOffset(b, latitude, longitude));
}

type Element = { type?: unknown; id?: unknown; lat?: unknown; lon?: unknown; center?: { lat?: unknown; lon?: unknown }; tags?: Record<string, unknown> };

function parseElement(raw: unknown): Venue | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, id, lat, lon, center, tags }: Element = raw;
  // Nodes carry their own position. Ways and relations get a center from `out center`.
  const latitude = lat ?? center?.lat;
  const longitude = lon ?? center?.lon;
  const name = typeof tags?.name === 'string' ? tags.name.trim() : '';
  const kind = kindOf(tags ?? {});
  if (typeof type !== 'string' || typeof id !== 'number' || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  const osmId = `${type}/${id}`;
  if (!OSM_ID.test(osmId) || !kind || name === '' || name.length > MAX_NAME_LENGTH) return null;
  return { osmId, name, kind, latitude, longitude };
}

function kindOf(tags: Record<string, unknown>): VenueKind | null {
  if (tags.amenity === 'cafe') return 'cafe';
  if (tags.amenity === 'library') return 'library';
  if (tags.amenity === 'coworking_space' || tags.office === 'coworking') return 'coworking';
  return null;
}

// Good enough for ordering a few places within 200 m: a degree of longitude shrinks with latitude.
function squaredOffset(venue: Venue, latitude: number, longitude: number): number {
  const dLat = venue.latitude - latitude;
  const dLng = (venue.longitude - longitude) * Math.cos((latitude * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}
