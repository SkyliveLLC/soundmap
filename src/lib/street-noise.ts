import { cellToBoundary, cellToChildrenSize, cellToLatLng, cellToParent, getResolution } from 'h3-js';

import { energyAverage, energyOf, levelOf } from './acoustics.ts';
import { CELL_RESOLUTION, cellAt, type Bounds, type CellAggregate } from './cells.ts';

/** NTNM omits pixels quieter than this, so inside the modeled area "no pixels" means quiet, not unknown. */
export const DOT_FLOOR_DB = 45;

/** The NTNM release the hosted tiles hold. Bump it together with STREET_NOISE_TILES. */
export const STREET_NOISE_RELEASE = '2022';

/**
 * US DOT transportation noise (roads, rail and aviation) for the 50 states and DC as one PMTiles archive
 * (built by scripts/street-noise.ts), which MapLibre reads with HTTP range requests.
 * EXPO_PUBLIC_STREET_NOISE_TILES points a dev build elsewhere.
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

/** Modeled transportation noise for one H3 cell. Three states because "no number" means two different things. */
export type StreetLevel = { kind: 'modeled'; laeq24h: number } | { kind: 'below-floor' } | { kind: 'not-covered' };

/**
 * Everything the card shows for one cell. Measured and modeled values sit side by side, never combined.
 * An unmeasured cell outside the modeled area has nothing to say, so it is not representable.
 */
export type CellReading =
  | { cell: string; measured: CellAggregate; street: StreetLevel }
  | { cell: string; measured: null; street: Exclude<StreetLevel, { kind: 'not-covered' }> };

export type Pixel = { latitude: number; longitude: number; db: number };

/** Side of the lng/lat windows scripts/street-noise.ts reads the rasters in. */
export const WINDOW_DEG = 1;
/** Wider than a block's radius at any US latitude, so edge blocks see all of their pixels. */
export const MARGIN_DEG = 0.01;

/** Where one raster has pixels, as lng/lat boxes that never cross the antimeridian. */
export type Footprint = { raster: string; boxes: Bounds[] };
/** One grid cell of the map and every raster with pixels in it or within MARGIN_DEG of it. */
export type Window = { bounds: Bounds; rasters: string[] };

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
 * Boxes around a ring of lng/lat points, split at the antimeridian: Alaska's edge comes back as
 * [172, 180] and [-180, -117], not one box across the Pacific. Each step between neighbouring points
 * goes the short way around, so the ring must be dense enough that no step spans 180°.
 */
export function boxesAround(ring: readonly (readonly [lng: number, lat: number])[]): Bounds[] {
  const lats = ring.map(([, lat]) => lat);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  // Each point is its longitude plus `turns` whole turns, so the ring stays continuous past ±180°.
  let previous = ring[0][0];
  let turns = 0;
  let west = { lng: previous, turns };
  let east = { lng: previous, turns };
  for (const [lng] of ring) {
    turns += Math.round((previous - lng) / 360);
    previous = lng;
    if (lng + 360 * turns < west.lng + 360 * west.turns) west = { lng, turns };
    if (lng + 360 * turns > east.lng + 360 * east.turns) east = { lng, turns };
  }
  if (west.turns === east.turns) return [[west.lng, south, east.lng, north]];
  return [
    [west.lng, south, 180, north],
    [-180, south, east.lng, north],
  ];
}

/**
 * The WINDOW_DEG grid cells that intersect any footprint, each with the rasters whose pixels can reach
 * it: those within MARGIN_DEG, since a block centered in the window may have pixels just outside it.
 * West to east, then south to north.
 */
export function windowsOver(footprints: readonly Footprint[]): Window[] {
  const windows = new Map<string, Window>();
  for (const { raster, boxes } of footprints) {
    for (const [west, south, east, north] of boxes) {
      const first = Math.floor(Math.max(-180, west - MARGIN_DEG));
      const last = Math.min(180, east + MARGIN_DEG);
      for (let lng = first; lng < last; lng += WINDOW_DEG) {
        for (let lat = Math.floor(south - MARGIN_DEG); lat < north + MARGIN_DEG; lat += WINDOW_DEG) {
          const key = `${lng},${lat}`;
          const window = windows.get(key);
          if (window) window.rasters.push(raster);
          else windows.set(key, { bounds: [lng, lat, lng + WINDOW_DEG, lat + WINDOW_DEG], rasters: [raster] });
        }
      }
    }
  }
  return [...windows.values()].sort((a, b) => a.bounds[0] - b.bounds[0] || a.bounds[1] - b.bounds[1]);
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
