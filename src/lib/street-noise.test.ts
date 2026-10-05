/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellToLatLng } from 'h3-js';

import { cellAt, type CellAggregate } from './cells.ts';
import {
  aggregatePixels,
  parsePixelLine,
  parseStreetNoise,
  readCell,
  serializeLevels,
  streetLevelAt,
  type Extent,
} from './street-noise.ts';

const SF: Extent = [-122.53, 37.7, -122.35, 37.84];
const MISSION_16TH = cellAt(37.7651, -122.4196);
const FOLSOM_19TH = cellAt(37.7599, -122.4148);
const OAKLAND = cellAt(37.8044, -122.2712);

function pixelsAt(cell: string, dbs: number[]) {
  const [latitude, longitude] = cellToLatLng(cell);
  return dbs.map((db) => ({ latitude, longitude, db }));
}

const noise = aggregatePixels(pixelsAt(MISSION_16TH, [60, 80]), { release: '2022', extent: SF });
const measured: CellAggregate = { cell: OAKLAND, laeq: 58, count: 1 };

test('a cell energy-averages the pixels present in it', () => {
  const level = streetLevelAt(noise, MISSION_16TH);
  assert.ok(level.kind === 'modeled');
  assert.ok(Math.abs(level.laeq24h - 77.03) < 0.01, `got ${level.laeq24h}`);
});

test('pixels outside the extent are ignored', () => {
  assert.equal(aggregatePixels(pixelsAt(OAKLAND, [70]), { release: '2022', extent: SF }).levels.size, 0);
});

test('a cell without pixels is below the floor inside the extent and not covered outside it', () => {
  assert.deepEqual(streetLevelAt(noise, FOLSOM_19TH), { kind: 'below-floor' });
  assert.deepEqual(streetLevelAt(noise, OAKLAND), { kind: 'not-covered' });
});

test('only an unmeasured cell outside the extent has no reading', () => {
  assert.equal(readCell(OAKLAND, undefined, noise), null);
  assert.deepEqual(readCell(OAKLAND, measured, noise), { cell: OAKLAND, measured, street: { kind: 'not-covered' } });
  assert.deepEqual(readCell(FOLSOM_19TH, undefined, noise), {
    cell: FOLSOM_19TH,
    measured: null,
    street: { kind: 'below-floor' },
  });
});

test('levels survive a serialize and parse round trip at 0.1 dB', () => {
  const parsed = parseStreetNoise(JSON.parse(serializeLevels(noise)));
  assert.equal(parsed.release, '2022');
  assert.deepEqual(parsed.extent, SF);
  assert.deepEqual(parsed.levels, new Map([[MISSION_16TH, 77]]));
});

test('parsing rejects levels below the DOT floor and cells at another resolution', () => {
  const valid = { release: '2022', extent: SF, cells: { [MISSION_16TH]: 61 } };
  assert.doesNotThrow(() => parseStreetNoise(valid));
  assert.throws(() => parseStreetNoise({ ...valid, cells: { [MISSION_16TH]: 44.9 } }));
  assert.throws(() => parseStreetNoise({ ...valid, cells: { '89283082803ffff': 61 } }));
  assert.throws(() => parseStreetNoise({ ...valid, extent: [-122.35, 37.7, -122.53, 37.84] }));
});

test('pixel lines parse as lng lat db and NoData is dropped', () => {
  assert.deepEqual(parsePixelLine('-122.4196 37.7651 61.25'), { latitude: 37.7651, longitude: -122.4196, db: 61.25 });
  assert.equal(parsePixelLine('-122.4196 37.7651 3.40282306073709653e+38'), null);
  assert.equal(parsePixelLine(''), null);
});
