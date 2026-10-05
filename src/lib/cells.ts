import { latLngToCell } from 'h3-js';

import type { NoiseSummary } from './acoustics.ts';

// Resolution 10 hexagons are about 15,000 m², roughly a city block: coarse enough
// that a saved cell does not pinpoint where someone sat.
const CELL_RESOLUTION = 10;

/** A saved measurement. Only the H3 cell is kept, never the raw position. */
export type Measurement = { id: string; at: number; cell: string; summary: NoiseSummary };

export function cellAt(latitude: number, longitude: number): string {
  return latLngToCell(latitude, longitude, CELL_RESOLUTION);
}
