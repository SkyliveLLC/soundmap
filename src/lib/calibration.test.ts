/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calibrationFor, UNCALIBRATED_OFFSET_DB } from './calibration.ts';

const TABLE = { 'iPhone16,1': { id: 'iPhone16,1/2026-10', offsetDb: 117.5 } };

test('a model with an entry uses its measured offset and names the entry', () => {
  assert.deepEqual(calibrationFor('iPhone16,1', TABLE), { model: 'iPhone16,1', offsetDb: 117.5, id: 'iPhone16,1/2026-10' });
});

test('a model without an entry stays uncalibrated, on the placeholder offset', () => {
  assert.deepEqual(calibrationFor('Google Pixel 8', TABLE), {
    model: 'Google Pixel 8',
    offsetDb: UNCALIBRATED_OFFSET_DB,
    id: null,
  });
});
