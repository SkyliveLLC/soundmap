import type { Feature, Polygon } from 'geojson';
import { cellToBoundary, cellToLatLng, getResolution, isValidCell } from 'h3-js';

import { energyAverage } from './acoustics.ts';
import { CELL_RESOLUTION, cellAt, type CellAggregate } from './cells.ts';

/** [west, south, east, north] in degrees: the area the assets were clipped to. */
export type Extent = readonly [west: number, south: number, east: number, north: number];

/** NTNM omits pixels quieter than this, so inside the extent "no pixels" means quiet, not unknown. */
export const DOT_FLOOR_DB = 45;

/** Modeled road noise for one H3 cell. Three states because "no number" means two different things. */
export type StreetLevel = { kind: 'modeled'; laeq24h: number } | { kind: 'below-floor' } | { kind: 'not-covered' };

/** US DOT National Transportation Noise Map road noise, aggregated to H3 cells. Never mutated. */
export type StreetNoise = {
  readonly release: string;
  readonly extent: Extent;
  /** H3 res-10 cell -> energy-averaged LAeq 24 h. Every value >= DOT_FLOOR_DB. */
  readonly levels: ReadonlyMap<string, number>;
};

/**
 * Everything the card shows for one cell. Measured and modeled values sit side by side, never combined.
 * An unmeasured cell outside the extent has nothing to say, so it is not representable.
 */
export type CellReading =
  | { cell: string; measured: CellAggregate; street: StreetLevel }
  | { cell: string; measured: null; street: Exclude<StreetLevel, { kind: 'not-covered' }> };

/** One raster pixel center with data. */
export type Pixel = { latitude: number; longitude: number; db: number };

// levels.json on disk. Cells are sorted and rounded to 0.1 dB so a rerun is byte-identical.
type LevelsFile = { release: string; extent: Extent; cells: Record<string, number> };

/** Validates levels.json. Throws on a malformed asset: it is a build artifact, so a bad one is a pipeline bug. */
export function parseStreetNoise(raw: unknown): StreetNoise {
  if (typeof raw !== 'object' || raw === null) throw new Error('street noise: not an object');
  const { release, extent, cells } = raw as Partial<Record<keyof LevelsFile, unknown>>;
  if (typeof release !== 'string' || release === '') throw new Error('street noise: missing release');
  if (typeof cells !== 'object' || cells === null) throw new Error('street noise: missing cells');
  const levels = new Map<string, number>();
  for (const [cell, laeq] of Object.entries(cells)) {
    if (!isValidCell(cell) || getResolution(cell) !== CELL_RESOLUTION) throw new Error(`street noise: bad cell ${cell}`);
    if (typeof laeq !== 'number' || !Number.isFinite(laeq) || laeq < DOT_FLOOR_DB) {
      throw new Error(`street noise: bad level for ${cell}`);
    }
    levels.set(cell, laeq);
  }
  return { release, extent: parseExtent(extent), levels };
}

function parseExtent(raw: unknown): Extent {
  if (!Array.isArray(raw) || raw.length !== 4) throw new Error('street noise: extent is not [w, s, e, n]');
  const [west, south, east, north]: unknown[] = raw;
  if (
    typeof west !== 'number' ||
    typeof south !== 'number' ||
    typeof east !== 'number' ||
    typeof north !== 'number' ||
    !(-180 <= west && west < east && east <= 180 && -90 <= south && south < north && north <= 90)
  ) {
    throw new Error('street noise: extent is not a valid [w, s, e, n] box');
  }
  return [west, south, east, north];
}

function contains([west, south, east, north]: Extent, latitude: number, longitude: number): boolean {
  return west <= longitude && longitude <= east && south <= latitude && latitude <= north;
}

/** Modeled if the cell has a level; else below-floor if its center is inside the extent; else not-covered. */
export function streetLevelAt(noise: StreetNoise, cell: string): StreetLevel {
  const laeq24h = noise.levels.get(cell);
  if (laeq24h !== undefined) return { kind: 'modeled', laeq24h };
  const [latitude, longitude] = cellToLatLng(cell);
  return contains(noise.extent, latitude, longitude) ? { kind: 'below-floor' } : { kind: 'not-covered' };
}

/** Pairs a cell's measurements with its street noise. Null only for an unmeasured cell outside the extent. */
export function readCell(cell: string, measured: CellAggregate | undefined, noise: StreetNoise): CellReading | null {
  const street = streetLevelAt(noise, cell);
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

/** Energy average of the pixels present in each cell. Pixels outside the extent are ignored. */
export function aggregatePixels(pixels: Iterable<Pixel>, source: { release: string; extent: Extent }): StreetNoise {
  const dbByCell = new Map<string, [number, ...number[]]>();
  for (const { latitude, longitude, db } of pixels) {
    if (!contains(source.extent, latitude, longitude)) continue;
    const cell = cellAt(latitude, longitude);
    const levels = dbByCell.get(cell);
    if (levels) levels.push(db);
    else dbByCell.set(cell, [db]);
  }
  const levels = new Map(Array.from(dbByCell, ([cell, dbs]) => [cell, energyAverage(dbs)] as const));
  return { ...source, levels };
}

/** levels.json text: sorted cells, 0.1 dB. Byte-identical for identical input. */
export function serializeLevels(noise: StreetNoise): string {
  const file: LevelsFile = {
    release: noise.release,
    extent: noise.extent,
    cells: Object.fromEntries(sortedLevels(noise)),
  };
  return `${JSON.stringify(file, null, 1)}\n`;
}

/**
 * cells.geojson text from the same levels: one hexagon per line, properties `{ cell, laeq }`.
 * MapLibre colors it with `LOUDNESS_COLOR`, so the file stores no colors.
 */
export function serializeCells(noise: StreetNoise): string {
  const features = sortedLevels(noise).map(([cell, laeq]): Feature<Polygon, { cell: string; laeq: number }> => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [cellToBoundary(cell, true).map(([lng, lat]) => [roundTo(lng, 6), roundTo(lat, 6)])],
    },
    properties: { cell, laeq },
  }));
  return `{"type":"FeatureCollection","features":[\n${features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}\n`;
}

function sortedLevels({ levels }: StreetNoise): [string, number][] {
  return Array.from(levels, ([cell, laeq]): [string, number] => [cell, roundTo(laeq, 1)]).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
