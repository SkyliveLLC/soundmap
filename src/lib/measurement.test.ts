/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NoiseSummary } from './acoustics.ts';
import { calibrationFor, type Calibration } from './calibration.ts';
import { cellAt } from './cells.ts';
import { rejectionReason } from './measurement.ts';

const NOW = Date.UTC(2026, 9, 6, 18);
const CELL = cellAt(37.7651, -122.4196);
const SUMMARY: NoiseSummary = { laeq: 62, lamax: 78, l10: 66, l90: 55, durationSec: 30 };
const CALIBRATION = calibrationFor('iPhone16,1');

type Overrides = Partial<{ cell: string; at: number; summary: Partial<NoiseSummary>; calibration: Partial<Calibration> }>;

const reading = (overrides: Overrides = {}) => ({
  cell: overrides.cell ?? CELL,
  at: overrides.at ?? NOW - 60_000,
  summary: { ...SUMMARY, ...overrides.summary },
  calibration: { ...CALIBRATION, ...overrides.calibration },
});

test('a plausible reading is accepted', () => {
  assert.equal(rejectionReason(reading(), NOW), null);
});

test('the cell must be a valid resolution 10 cell', () => {
  assert.notEqual(rejectionReason(reading({ cell: 'not-a-cell' }), NOW), null);
  assert.notEqual(rejectionReason(reading({ cell: '8928308280fffff' }), NOW), null);
});

test('readings from the future are refused, small clock drift is not', () => {
  assert.equal(rejectionReason(reading({ at: NOW + 60_000 }), NOW), null);
  assert.notEqual(rejectionReason(reading({ at: NOW + 60 * 60_000 }), NOW), null);
});

test('only full-length sessions are accepted', () => {
  assert.notEqual(rejectionReason(reading({ summary: { durationSec: 12.5 } }), NOW), null);
});

test('levels must be in range and in order', () => {
  assert.notEqual(rejectionReason(reading({ summary: { lamax: 500 } }), NOW), null);
  assert.notEqual(rejectionReason(reading({ summary: { laeq: Number.NaN } }), NOW), null);
  assert.notEqual(rejectionReason(reading({ summary: { l90: 70 } }), NOW), null);
});

test('the reading must name its device model and a plausible offset', () => {
  assert.notEqual(rejectionReason(reading({ calibration: { model: '' } }), NOW), null);
  assert.notEqual(rejectionReason(reading({ calibration: { offsetDb: 0 } }), NOW), null);
  assert.notEqual(rejectionReason(reading({ calibration: { offsetDb: Number.NaN } }), NOW), null);
});
