/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellToChildren, cellToParent, gridDisk, latLngToCell } from 'h3-js';

import {
  CELL_RESOLUTION,
  REGION_RESOLUTION,
  cellAt,
  cellsToGeoJSON,
  isRegion,
  regionRange,
  regionsIn,
} from './cells.ts';

const MISSION_16TH = cellAt(37.7651, -122.4196);

function assertClose(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('hexagons are closed GeoJSON rings in longitude, latitude order', () => {
  const aggregate = { cell: MISSION_16TH, laeq: 62, count: 1 };
  const [feature] = cellsToGeoJSON([aggregate]).features;
  const ring = feature.geometry.coordinates[0];
  assert.equal(ring.length, 7);
  assert.deepEqual(ring[0], ring[6]);
  for (const [lng, lat] of ring) {
    assertClose(lng, -122.4196, 0.003);
    assertClose(lat, 37.7651, 0.003);
  }
  assert.deepEqual(feature.properties, aggregate);
});

test('a region range holds every block in the region and none outside it', () => {
  const region = cellToParent(MISSION_16TH, REGION_RESOLUTION);
  const [first, last] = regionRange(region);
  const inRange = (cell: string) => first <= cell && cell <= last;
  assert.ok(cellToChildren(region, CELL_RESOLUTION).every(inRange));
  const neighbors = gridDisk(region, 1).filter((cell) => cell !== region);
  assert.ok(neighbors.flatMap((neighbor) => cellToChildren(neighbor, CELL_RESOLUTION)).every((cell) => !inRange(cell)));
});

test('the regions in a box include those under its corners and center', () => {
  const [west, south, east, north] = [-122.53, 37.7, -122.35, 37.84];
  const regions = regionsIn([west, south, east, north]);
  assert.deepEqual(regions, [...regions].sort());
  for (const [lat, lng] of [[south, west], [north, east], [(south + north) / 2, (west + east) / 2]]) {
    assert.ok(regions.includes(latLngToCell(lat, lng, REGION_RESOLUTION)));
  }
  assert.ok(regions.every(isRegion));
});
