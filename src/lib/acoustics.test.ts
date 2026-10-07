/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { energyAverage, energyOf, levelOf, summarize } from './acoustics.ts';

const FRAME_SEC = 0.125;

function assertClose(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected} ± ${tolerance}, got ${actual}`);
}

test('LAeq is the energy average, not the arithmetic mean', () => {
  assertClose(summarize([60, 80], FRAME_SEC).laeq, 77.03);
});

test('LAeq of a steady level is that level', () => {
  assertClose(summarize([55, 55, 55, 55], FRAME_SEC).laeq, 55);
});

test('L10 is the loud end and L90 the quiet end of the distribution', () => {
  const levels = Array.from({ length: 101 }, (_, i) => (i * 37) % 101);
  const [first, ...rest] = levels;
  const { l10, l90 } = summarize([first, ...rest], FRAME_SEC);
  assertClose(l10, 90);
  assertClose(l90, 10);
});

test('percentiles interpolate between frames', () => {
  const { l10, l90 } = summarize([40, 50], FRAME_SEC);
  assertClose(l10, 49);
  assertClose(l90, 41);
});

test('LAmax is the loudest frame wherever it occurs', () => {
  assert.equal(summarize([40, 72.5, 50], FRAME_SEC).lamax, 72.5);
});

test('duration counts frames times frame length', () => {
  const levels = Array.from({ length: 240 }, () => 50);
  assert.equal(summarize([50, ...levels.slice(1)], FRAME_SEC).durationSec, 30);
});

test('a single frame summarizes to that level with no NaN', () => {
  assert.deepEqual(summarize([63], FRAME_SEC), { laeq: 63, lamax: 63, l10: 63, l90: 63, durationSec: FRAME_SEC });
});

test('a running energy total averages like energyAverage', () => {
  const levels = [48, 61.5, 73] as const;
  const total = levels.reduce((sum, level) => sum + energyOf(level), 0);
  assertClose(levelOf(total / levels.length), energyAverage(levels), 1e-9);
});
