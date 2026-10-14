import { VectorTile } from '@mapbox/vector-tile';
import { cellToLatLng } from 'h3-js';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';

import { BLOCK_ZOOM, COVERAGE_LAYER, NOISE_LAYER, type StreetLevel } from './street-noise.ts';

type Ring = readonly { x: number; y: number }[];

/** Tiles kept decoded, so taps around one neighborhood don't refetch. */
const CACHED_TILES = 8;

/**
 * Reads a block's street noise straight from the tile archive MapLibre draws from (`pmtiles://` or plain
 * URL), so the answer never depends on where the camera is or what has finished rendering. A block
 * outside every tile is not covered. Rejects when the archive can't be read, such as offline.
 */
export function streetNoiseReader(url: string): (cell: string) => Promise<StreetLevel> {
  const tileAt = tileReader(url, BLOCK_ZOOM, CACHED_TILES, (bytes) => new VectorTile(new PbfReader(bytes)));

  return async (cell) => {
    const [latitude, longitude] = cellToLatLng(cell);
    const { x, y, fx, fy } = tilePosition(latitude, longitude, BLOCK_ZOOM);
    const tile = await tileAt(x, y);
    const contains = (layer: string) => {
      const features = tile?.layers[layer];
      if (!features) return [];
      const at = { x: fx * features.extent, y: fy * features.extent };
      return Array.from({ length: features.length }, (_, i) => features.feature(i)).filter((feature) =>
        insideRings(feature.loadGeometry(), at),
      );
    };
    const [noise] = contains(NOISE_LAYER);
    const laeq24h = noise?.properties.laeq;
    if (typeof laeq24h === 'number') return { kind: 'modeled', laeq24h };
    return contains(COVERAGE_LAYER).length > 0 ? { kind: 'below-floor' } : { kind: 'not-covered' };
  };
}

/**
 * Reads tiles at one zoom from a PMTiles archive (`pmtiles://` or plain URL), decoded once and kept for the last
 * `cachedTiles` tiles. Resolves null for a tile the archive lacks. A failed read isn't kept, so the next call
 * retries it.
 */
export function tileReader<T>(
  url: string,
  zoom: number,
  cachedTiles: number,
  decode: (bytes: ArrayBuffer) => T,
): (x: number, y: number) => Promise<T | null> {
  const source = url.replace(/^pmtiles:\/\//, '');
  let archive = new PMTiles(source);
  const tiles = new Map<string, Promise<T | null>>();

  return (x, y) => {
    const key = `${x}/${y}`;
    let tile = tiles.get(key);
    if (!tile) {
      const reading = archive;
      tile = reading.getZxy(zoom, x, y).then((found) => (found ? decode(found.data) : null));
      tile.catch(() => {
        tiles.delete(key);
        // PMTiles keeps a failed header read for good, so the next call starts over with a fresh archive.
        if (archive === reading) archive = new PMTiles(source);
      });
      tiles.set(key, tile);
      if (tiles.size > cachedTiles) tiles.delete(tiles.keys().next().value!);
    }
    return tile;
  };
}

/** The Web Mercator tile holding a point at `zoom`, and where in it the point falls (0 to 1 from the top left). */
export function tilePosition(latitude: number, longitude: number, zoom: number) {
  const scale = 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const worldX = ((longitude + 180) / 360) * scale;
  const worldY = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  const x = Math.floor(worldX);
  const y = Math.floor(worldY);
  return { x, y, fx: worldX - x, fy: worldY - y };
}

/** Even-odd point in polygon over all of a vector tile feature's rings, which handles holes and multipolygons. */
export function insideRings(rings: readonly Ring[], { x, y }: { x: number; y: number }): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
