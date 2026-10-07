/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellAt, cellsToGeoJSON } from './cells.ts';

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
