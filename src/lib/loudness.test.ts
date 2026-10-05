/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loudnessBand } from './loudness.ts';

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
