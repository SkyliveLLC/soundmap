/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellToChildren, cellToLatLng, cellToParent } from 'h3-js';

import { cellAt, type Bounds, type CellAggregate } from './cells.ts';
import {
  BLOCK_ZOOM,
  NOISE_LAYER,
  aggregatePixels,
  areaLevels,
  boxesAround,
  noiseFeature,
  parsePixelLine,
  readCell,
  windowsOver,
} from './street-noise.ts';

const SF: Bounds = [-122.53, 37.7, -122.35, 37.84];
const MISSION_16TH = cellAt(37.7651, -122.4196);
const OAKLAND = cellAt(37.8044, -122.2712);

function pixelsAt(cell: string, dbs: number[]) {
  const [latitude, longitude] = cellToLatLng(cell);
  return dbs.map((db) => ({ latitude, longitude, db }));
}

test('a block energy-averages the pixels present in it', () => {
  const levels = aggregatePixels(pixelsAt(MISSION_16TH, [60, 80]), SF);
  const laeq = levels.get(MISSION_16TH);
  assert.ok(laeq !== undefined && Math.abs(laeq - 77.03) < 0.01, `got ${laeq}`);
});

test('a window keeps only the blocks centered in it', () => {
  const levels = aggregatePixels([...pixelsAt(MISSION_16TH, [60]), ...pixelsAt(OAKLAND, [70])], SF);
  assert.deepEqual([...levels.keys()], [MISSION_16TH]);
});

test('only an unmeasured cell outside the modeled area has no reading', () => {
  const measured: CellAggregate = { cell: OAKLAND, laeq: 58, count: 1 };
  const outside = { kind: 'not-covered' } as const;
  assert.equal(readCell(OAKLAND, undefined, outside), null);
  assert.deepEqual(readCell(OAKLAND, measured, outside), { cell: OAKLAND, measured, street: outside });
  assert.deepEqual(readCell(OAKLAND, undefined, { kind: 'below-floor' }), {
    cell: OAKLAND,
    measured: null,
    street: { kind: 'below-floor' },
  });
});

test('an area spreads its blocks over its whole size and drops below the floor', async () => {
  const area = cellToParent(MISSION_16TH, 9);
  const blocks = cellToChildren(area, 10).map((cell) => [cell, 80] as const);
  const levels = new Map(await Array.fromAsync(areaLevels(blocks.slice(0, 1))));
  // One loud block in seven: 80 dB spread over seven blocks.
  assert.ok(Math.abs(levels.get(area)! - (80 - 10 * Math.log10(7))) < 0.01);
  assert.equal(levels.get(cellToParent(MISSION_16TH, 5)), undefined);
  // A full area matches its blocks.
  assert.ok(Math.abs(new Map(await Array.fromAsync(areaLevels(blocks))).get(area)! - 80) < 0.01);
});

test('every area of sorted blocks comes out once', async () => {
  const blocks = [MISSION_16TH, OAKLAND].sort().map((cell) => [cell, 90] as const);
  const areas = (await Array.fromAsync(areaLevels(blocks))).map(([cell]) => cell);
  assert.equal(new Set(areas).size, areas.length);
  for (const block of [MISSION_16TH, OAKLAND]) assert.ok(areas.includes(cellToParent(block, 9)));
});

test('a block feature draws from the block zoom in, rounded to 0.1 dB', () => {
  const feature = JSON.parse(noiseFeature(MISSION_16TH, 61.26));
  assert.deepEqual(feature.tippecanoe, { layer: NOISE_LAYER, minzoom: BLOCK_ZOOM, maxzoom: BLOCK_ZOOM });
  assert.deepEqual(feature.properties, { laeq: 61.3 });
  assert.equal(feature.geometry.coordinates[0].length, 7);
});

// Alaska's raster edge in lng/lat, corners plus the Aleutian stretch past 180°.
const ALASKA = [
  [176.2, 69],
  [-117.4, 67.6],
  [-132.2, 51.6],
  [-171.3, 52.4],
  [-179.9, 52.6],
  [172.9, 53],
] as const;

test('a footprint across the antimeridian is two boxes, a footprint short of it is one', () => {
  assert.deepEqual(boxesAround(ALASKA), [
    [172.9, 51.6, 180, 69],
    [-180, 51.6, -117.4, 69],
  ]);
  const hawaii = [
    [-178.3, 28.4],
    [-177.5, 18.1],
    [-154.8, 18.9],
    [-154.7, 29.2],
  ] as const;
  assert.deepEqual(boxesAround(hawaii), [[-178.3, 18.1, -154.7, 29.2]]);
});

test('a window lists every raster within its margin, and no window is listed twice', () => {
  const windows = windowsOver([
    { raster: 'CT', boxes: [[-73.82, 40.69, -71.6, 42.32]] },
    { raster: 'RI', boxes: [[-72.005, 41.08, -70.96, 42.09]] },
  ]);
  assert.equal(windows.length, 11);
  const at = (lng: number, lat: number) =>
    windows.find(({ bounds }) => bounds[0] === lng && bounds[1] === lat)?.rasters;
  assert.deepEqual(at(-74, 40), ['CT']);
  assert.deepEqual(at(-72, 41), ['CT', 'RI']);
  // RI starts 0.005° inside the -72 column: within the margin, so it joins the -73 column too.
  assert.deepEqual(at(-73, 41), ['CT', 'RI']);
  assert.deepEqual(at(-71, 42), ['RI']);
  assert.deepEqual(windows[0].bounds, [-74, 40, -73, 41]);
});

test('windows over a footprint across the antimeridian stay inside ±180° and reach both sides', () => {
  const windows = windowsOver([{ raster: 'AK', boxes: boxesAround(ALASKA) }]);
  assert.equal(windows.length, (180 - 172 + 63) * 19);
  assert.ok(windows.every(({ bounds: [west, , east] }) => west >= -180 && east <= 180));
  const bounds = windows.map(({ bounds }) => bounds.join(','));
  assert.ok(bounds.includes('-177,51,-176,52'), 'Adak');
  assert.ok(bounds.includes('172,52,173,53'), 'Attu');
});

test('pixel lines parse as lng lat db and NoData is dropped', () => {
  assert.deepEqual(parsePixelLine('-122.4196 37.7651 61.25'), { latitude: 37.7651, longitude: -122.4196, db: 61.25 });
  assert.equal(parsePixelLine('-122.4196 37.7651 3.40282306073709653e+38'), null);
  assert.equal(parsePixelLine(''), null);
});
