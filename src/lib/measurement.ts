import { getResolution, isValidCell } from 'h3-js';

import type { NoiseSummary } from './acoustics.ts';
import { CELL_RESOLUTION } from './cells.ts';

/** Length of one measurement. The server accepts readings of exactly this length. */
export const SESSION_SEC = 30;

/** A finished reading on its way to the shared map. Only the H3 cell is kept, never the raw position. */
export type Measurement = {
  /** Chosen on the phone so the server can recognize a retried upload. */
  clientId: string;
  at: number;
  cell: string;
  summary: NoiseSummary;
};

// Comfortably wider than anything a phone can report: full scale sits near 120 dB SPL.
const MIN_DB = 0;
const MAX_DB = 140;
// Phone clocks drift a little, but a reading can't come from the future.
const CLOCK_SKEW_MS = 5 * 60_000;

/** Why the server refuses a measurement, or null when it is plausible. Runs in the `measurements.add` mutation. */
export function rejectionReason({ cell, at, summary }: Omit<Measurement, 'clientId'>, now: number): string | null {
  if (!isValidCell(cell) || getResolution(cell) !== CELL_RESOLUTION) return 'cell is not an H3 resolution 10 cell';
  if (!Number.isFinite(at) || at > now + CLOCK_SKEW_MS) return 'time is in the future';
  if (summary.durationSec !== SESSION_SEC) return `duration is not ${SESSION_SEC} s`;
  const { laeq, lamax, l10, l90 } = summary;
  if (![laeq, lamax, l10, l90].every((level) => Number.isFinite(level) && level >= MIN_DB && level <= MAX_DB)) {
    return `a level is outside ${MIN_DB}–${MAX_DB} dB`;
  }
  if (!(l90 <= l10 && l10 <= lamax && laeq <= lamax)) return 'levels are out of order';
  return null;
}
