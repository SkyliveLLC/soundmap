import { cellToBoundary, cellToChildrenSize, cellToLatLng, cellToParent, getResolution } from 'h3-js';

import { energyAverage, energyOf, levelOf } from './acoustics.ts';
import { CELL_RESOLUTION, cellAt, type Bounds, type CellAggregate } from './cells.ts';

/** NTNM omits pixels quieter than this, so inside the modeled area "no pixels" means quiet, not unknown. */
export const DOT_FLOOR_DB = 45;

/** The NTNM release the hosted tiles hold. Bump it together with STREET_NOISE_TILES. */
export const STREET_NOISE_RELEASE = '2022';

/**
 * US DOT road noise for the 50 states and DC as one PMTiles archive (built by scripts/street-noise.ts),
 * which MapLibre reads with HTTP range requests. EXPO_PUBLIC_STREET_NOISE_TILES points a dev build elsewhere.
 */
export const STREET_NOISE_TILES = process.env.EXPO_PUBLIC_STREET_NOISE_TILES ?? 'R2_URL_PENDING';

/** Tile layer of hexagons, each with an `laeq` (dBA, 24 h). Only hexagons at or above DOT_FLOOR_DB exist. */
export const NOISE_LAYER = 'noise';
/** Tile layer of the area NTNM models: the 50 states and DC. Only in block tiles, and never drawn. */
export const COVERAGE_LAYER = 'coverage';

/** Blocks are drawn, and answer taps, from this zoom in. Tiles stop here; MapLibre overzooms them. */
export const BLOCK_ZOOM = 12;

/**
 * The H3 resolution drawn at each zoom, so a hexagon is always a few pixels across. Blocks (resolution
 * 10) are the DOT pixels averaged; every coarser hexagon is an area average of the blocks inside it.
 */
export const NOISE_ZOOMS = [
  { resolution: 5, minzoom: 3, maxzoom: 5 },
  { resolution: 6, minzoom: 6, maxzoom: 7 },
  { resolution: 7, minzoom: 8, maxzoom: 8 },
  { resolution: 8, minzoom: 9, maxzoom: 9 },
  { resolution: 9, minzoom: 10, maxzoom: BLOCK_ZOOM - 1 },
  { resolution: CELL_RESOLUTION, minzoom: BLOCK_ZOOM, maxzoom: BLOCK_ZOOM },
] as const;

/** Modeled road noise for one H3 cell. Three states because "no number" means two different things. */
export type StreetLevel = { kind: 'modeled'; laeq24h: number } | { kind: 'below-floor' } | { kind: 'not-covered' };

/**
 * Everything the card shows for one cell. Measured and modeled values sit side by side, never combined.
 * An unmeasured cell outside the modeled area has nothing to say, so it is not representable.
 */
export type CellReading =
  | { cell: string; measured: CellAggregate; street: StreetLevel }
  | { cell: string; measured: null; street: Exclude<StreetLevel, { kind: 'not-covered' }> };

export type Pixel = { latitude: number; longitude: number; db: number };

/** Pairs a cell's measurements with its street noise. Null only for an unmeasured cell outside the modeled area. */
export function readCell(cell: string, measured: CellAggregate | undefined, street: StreetLevel): CellReading | null {
  if (measured) return { cell, measured, street };
  if (street.kind === 'not-covered') return null;
  return { cell, measured: null, street };
}

/** Parses one `gdaltransform` output line ("lng lat db"). Null for NoData (3.4e38) or a malformed line. */
export function parsePixelLine(line: string): Pixel | null {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 3) return null;
  const [longitude, latitude, db] = fields.map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(db) || db > 1e30) return null;
  return { latitude, longitude, db };
}

/**
 * Energy average of the pixels present in each block whose center lies in `window` (west and south
 * inclusive), so windows that tile the map own each block exactly once. Feed it pixels from a little
 * past the window, or blocks on its edge average only some of theirs.
 */
export function aggregatePixels(pixels: Iterable<Pixel>, [west, south, east, north]: Bounds): Map<string, number> {
  const dbByCell = new Map<string, [number, ...number[]]>();
  for (const { latitude, longitude, db } of pixels) {
    const cell = cellAt(latitude, longitude);
    const levels = dbByCell.get(cell);
    if (levels) levels.push(db);
    else dbByCell.set(cell, [db]);
  }
  const levels = new Map<string, number>();
  for (const [cell, dbs] of dbByCell) {
    const [latitude, longitude] = cellToLatLng(cell);
    if (west <= longitude && longitude < east && south <= latitude && latitude < north) {
      levels.set(cell, energyAverage(dbs));
    }
  }
  return levels;
}

/**
 * Area hexagons for every coarser resolution in NOISE_ZOOMS: the energy of their blocks spread over the
 * whole area, counting blocks below the floor as silent. It is a lower bound that keeps a highway
 * through farmland quieter than a downtown. Blocks must come sorted by index, which groups every
 * area's blocks together. Areas that average below the floor are left out, like quiet blocks.
 */
export async function* areaLevels(
  blocks: AsyncIterable<readonly [cell: string, laeq: number]> | Iterable<readonly [cell: string, laeq: number]>,
): AsyncGenerator<[string, number]> {
  const areas = NOISE_ZOOMS.filter(({ resolution }) => resolution < CELL_RESOLUTION).map(({ resolution }) => ({
    resolution,
    cell: '',
    energy: 0,
  }));
  function* flush(area: (typeof areas)[number]): Generator<[string, number]> {
    if (!area.cell) return;
    const laeq = levelOf(area.energy / cellToChildrenSize(area.cell, CELL_RESOLUTION));
    if (laeq >= DOT_FLOOR_DB) yield [area.cell, laeq];
  }
  for await (const [block, laeq] of blocks) {
    for (const area of areas) {
      const cell = cellToParent(block, area.resolution);
      if (cell !== area.cell) {
        yield* flush(area);
        area.cell = cell;
        area.energy = 0;
      }
      area.energy += energyOf(laeq);
    }
  }
  for (const area of areas) yield* flush(area);
}

/** One GeoJSONSeq line for tippecanoe: the hexagon, its level at 0.1 dB, and the zooms that draw it. */
export function noiseFeature(cell: string, laeq: number): string {
  const resolution = getResolution(cell);
  const zooms = NOISE_ZOOMS.find((zoom) => zoom.resolution === resolution);
  if (!zooms) throw new Error(`street noise: no zooms for resolution ${resolution}`);
  return JSON.stringify({
    type: 'Feature',
    tippecanoe: { layer: NOISE_LAYER, minzoom: zooms.minzoom, maxzoom: zooms.maxzoom },
    geometry: {
      type: 'Polygon',
      coordinates: [cellToBoundary(cell, true).map(([lng, lat]) => [roundTo(lng, 6), roundTo(lat, 6)])],
    },
    properties: { laeq: roundTo(laeq, 1) },
  });
}

export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
