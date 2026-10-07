/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { insideRings, tilePosition } from './street-noise-tiles.ts';

test('a point maps to its Web Mercator tile and its place inside it', () => {
  // Zoom 12 tile 655/1583 covers central San Francisco.
  const { x, y, fx, fy } = tilePosition(37.7651, -122.4196, 12);
  assert.deepEqual([x, y], [655, 1583]);
  assert.ok(fx >= 0 && fx < 1 && fy >= 0 && fy < 1);
  assert.deepEqual(tilePosition(0, 0, 1), { x: 1, y: 1, fx: 0, fy: 0 });
});

test('a point is inside a ring, but not inside its hole or past its edge', () => {
  const square = (from: number, to: number) => [
    { x: from, y: from },
    { x: to, y: from },
    { x: to, y: to },
    { x: from, y: to },
    { x: from, y: from },
  ];
  const withHole = [square(0, 100), square(40, 60)];
  assert.ok(insideRings(withHole, { x: 20, y: 20 }));
  assert.ok(!insideRings(withHole, { x: 50, y: 50 }));
  assert.ok(!insideRings(withHole, { x: 120, y: 50 }));
});
