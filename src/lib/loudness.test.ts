/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOUDNESS_COLOR, loudnessBand } from './loudness.ts';

test('each threshold starts the next band', () => {
  const labels = [30, 44.9, 45, 54.9, 55, 64.9, 65, 74.9, 75, 110].map((laeq) => loudnessBand(laeq).label);
  assert.deepEqual(labels, [
    'Very quiet',
    'Very quiet',
    'Quiet',
    'Quiet',
    'Moderate',
    'Moderate',
    'Loud',
    'Loud',
    'Very loud',
    'Very loud',
  ]);
});

test('every band has its own color', () => {
  const colors = new Set([40, 50, 60, 70, 80].map((laeq) => loudnessBand(laeq).color));
  assert.equal(colors.size, 5);
});

test('the map color expression picks the same color as loudnessBand at every edge', () => {
  const [operator, input, base, ...stops] = LOUDNESS_COLOR;
  assert.equal(operator, 'step');
  assert.deepEqual(input, ['get', 'laeq']);
  // MapLibre's step: the output after the last stop that is <= the input, else the base.
  const stepColor = (laeq: number) => {
    let color: unknown = base;
    for (let i = 0; i < stops.length; i += 2) if (laeq >= Number(stops[i])) color = stops[i + 1];
    return color;
  };
  for (const laeq of [30, 44.9, 45, 54.9, 55, 64.9, 65, 74.9, 75, 110]) {
    assert.equal(stepColor(laeq), loudnessBand(laeq).color, `at ${laeq} dBA`);
  }
});
