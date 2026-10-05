/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NoiseSummary } from './acoustics.ts';
import { aggregateByCell, cellAt, cellsToGeoJSON, type Measurement } from './cells.ts';

const MISSION_16TH = cellAt(37.7651, -122.4196);
const FOLSOM_19TH = cellAt(37.7599, -122.4148);

function measurement(cell: string, laeq: number): Measurement {
  const summary: NoiseSummary = { laeq, lamax: laeq + 10, l10: laeq + 5, l90: laeq - 5, durationSec: 30 };
  return { id: `${cell}-${laeq}`, at: 0, cell, summary };
}

function assertClose(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('a cell averages its measurements by energy, not arithmetically', () => {
  const [aggregate] = aggregateByCell([measurement(MISSION_16TH, 60), measurement(MISSION_16TH, 80)]);
  assert.equal(aggregate.count, 2);
  assertClose(aggregate.laeq, 77.03);
});

test('measurements group by cell regardless of order', () => {
  const aggregates = aggregateByCell([
    measurement(MISSION_16TH, 50),
    measurement(FOLSOM_19TH, 70),
    measurement(MISSION_16TH, 50),
  ]);
  assert.notEqual(MISSION_16TH, FOLSOM_19TH);
  assert.deepEqual(
    new Map(aggregates.map((aggregate) => [aggregate.cell, aggregate])),
    new Map([
      [MISSION_16TH, { cell: MISSION_16TH, laeq: 50, count: 2 }],
      [FOLSOM_19TH, { cell: FOLSOM_19TH, laeq: 70, count: 1 }],
    ]),
  );
});

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
