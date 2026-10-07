import { getResolution, isValidCell } from 'h3-js';

import type { NoiseSummary } from './acoustics.ts';
import type { Calibration } from './calibration.ts';
import { CELL_RESOLUTION } from './cells.ts';
import type { Visit } from './venues.ts';

/** Length of one measurement. The server accepts readings of exactly this length. */
export const SESSION_SEC = 30;

/** A finished reading on its way to the shared map. Only the H3 cell is kept, never the raw position. */
export type Measurement = {
  /** Chosen on the phone so the server can recognize a retried upload. */
  clientId: string;
  at: number;
  cell: string;
  summary: NoiseSummary;
  /** The phone model and offset the summary's levels were measured with. */
  calibration: Calibration;
  /** Set when the person said which venue they were in. */
  visit?: Visit;
};

// Comfortably wider than anything a phone can report: full scale sits near 120 dB SPL.
const MIN_DB = 0;
const MAX_DB = 140;
// Room for any real phone's offset around that 120 dB, while catching a reading that skipped calibration.
const MIN_OFFSET_DB = 80;
const MAX_OFFSET_DB = 160;
const MAX_MODEL_LENGTH = 100;
// Phone clocks drift a little, but a reading can't come from the future.
const CLOCK_SKEW_MS = 5 * 60_000;

/** Why the server refuses a measurement, or null when it is plausible. Runs in the `measurements.add` mutation. */
export function rejectionReason({ cell, at, summary, calibration }: Omit<Measurement, 'clientId'>, now: number): string | null {
  if (!isValidCell(cell) || getResolution(cell) !== CELL_RESOLUTION) return 'cell is not an H3 resolution 10 cell';
  if (!Number.isFinite(at) || at > now + CLOCK_SKEW_MS) return 'time is in the future';
  if (summary.durationSec !== SESSION_SEC) return `duration is not ${SESSION_SEC} s`;
  const { laeq, lamax, l10, l90 } = summary;
  if (![laeq, lamax, l10, l90].every((level) => Number.isFinite(level) && level >= MIN_DB && level <= MAX_DB)) {
    return `a level is outside ${MIN_DB}–${MAX_DB} dB`;
  }
  if (!(l90 <= l10 && l10 <= lamax && laeq <= lamax)) return 'levels are out of order';
  if (calibration.model === '' || calibration.model.length > MAX_MODEL_LENGTH) return 'device model is missing or too long';
  const { offsetDb } = calibration;
  if (!(Number.isFinite(offsetDb) && offsetDb >= MIN_OFFSET_DB && offsetDb <= MAX_OFFSET_DB)) {
    return `calibration offset is outside ${MIN_OFFSET_DB}–${MAX_OFFSET_DB} dB`;
  }
  return null;
}
