/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellAt } from './cells.ts';
import {
  addToHour,
  emptyHours,
  formatHour,
  hourLevels,
  overallLevel,
  parseVisit,
  quietestHour,
} from './venues.ts';
import { parseOverpass } from './venue-search.ts';

// Hayes Valley, where the simulator's location is set.
const HAYES = cellAt(37.7763, -122.4232);

function assertClose(actual: number | undefined, expected: number, tolerance = 0.01) {
  assert.ok(actual !== undefined && Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('an hour energy-averages its readings and other hours stay empty', () => {
  const hours = addToHour(addToHour(emptyHours(), 9, 60), 9, 80);
  const levels = hourLevels(hours);
  assertClose(levels[9]?.laeq, 77.03);
  assert.equal(levels[9]?.count, 2);
  assert.equal(levels.filter((level) => level !== null).length, 1);
});

test('the overall level averages across hours, and an unmeasured venue has none', () => {
  const hours = addToHour(addToHour(emptyHours(), 8, 50), 17, 70);
  assertClose(overallLevel(hours)?.laeq, 67.03);
  assert.equal(overallLevel(hours)?.count, 2);
  assert.equal(overallLevel(emptyHours()), null);
});

test('the quietest hour is the lowest measured one, the earlier on a tie', () => {
  const levels = hourLevels(addToHour(addToHour(addToHour(emptyHours(), 15, 55), 10, 48), 20, 48));
  assert.deepEqual(quietestHour(levels), { hour: 10, laeq: 48 });
  assert.equal(quietestHour(hourLevels(emptyHours())), null);
});

test('hours read as a 12 hour clock', () => {
  assert.deepEqual([0, 9, 12, 18, 23].map(formatHour), ['12 am', '9 am', '12 pm', '6 pm', '11 pm']);
});

test('Overpass elements become nearby named venues, nearest first', () => {
  const venues = parseOverpass(
    {
      elements: [
        { type: 'node', id: 2, lat: 37.7772, lon: -122.4232, tags: { amenity: 'cafe', name: 'Farther Café' } },
        { type: 'way', id: 3, center: { lat: 37.7763, lon: -122.4233 }, tags: { amenity: 'library', name: ' Branch Library ' } },
        { type: 'node', id: 4, lat: 37.7764, lon: -122.4232, tags: { office: 'coworking', name: 'Desk' } },
        { type: 'node', id: 5, lat: 37.7764, lon: -122.4232, tags: { amenity: 'cafe' } },
        { type: 'node', id: 6, lat: 37.7764, lon: -122.4232, tags: { amenity: 'bar', name: 'A Bar' } },
        { type: 'node', id: 7, lat: 37.8044, lon: -122.2712, tags: { amenity: 'cafe', name: 'Oakland' } },
      ],
    },
    HAYES,
  );
  assert.deepEqual(
    venues.map(({ osmId, name, kind }) => `${osmId} ${kind} ${name}`),
    ['way/3 library Branch Library', 'node/4 coworking Desk', 'node/2 cafe Farther Café'],
  );
});

test('a response without elements is an error, not an empty list', () => {
  assert.throws(() => parseOverpass({ remark: 'runtime error' }, HAYES));
});

test('a queued visit round-trips through JSON and garbage is refused', () => {
  const visit = { osmId: 'node/1', hour: 7 };
  assert.deepEqual(parseVisit(JSON.stringify(visit)), visit);
  for (const garbage of ['{', '{}', JSON.stringify({ ...visit, osmId: '123' }), JSON.stringify({ ...visit, hour: 24 }), JSON.stringify({ ...visit, hour: 9.5 })]) {
    assert.equal(parseVisit(garbage), null, garbage);
  }
});
