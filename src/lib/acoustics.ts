// Both shapes so that prepending or appending to any array proves non-emptiness.
export type NonEmptyArray<T> = readonly [T, ...T[]] | readonly [...T[], T];

export type NoiseSummary = {
  /** Equivalent continuous level: the steady level carrying the same sound energy. */
  laeq: number;
  lamax: number;
  /** Level exceeded 10% of the time: the loud moments. */
  l10: number;
  /** Level exceeded 90% of the time: the background. */
  l90: number;
  durationSec: number;
};

/** Summarizes consecutive A-weighted levels in dB SPL, each covering `frameSec` seconds. */
export function summarize(levelsDbSpl: NonEmptyArray<number>, frameSec: number): NoiseSummary {
  const ascending = [...levelsDbSpl].sort((a, b) => a - b);

  return {
    laeq: energyAverage(levelsDbSpl),
    lamax: ascending[ascending.length - 1],
    l10: levelExceeded(ascending, 0.1),
    l90: levelExceeded(ascending, 0.9),
    durationSec: levelsDbSpl.length * frameSec,
  };
}

/**
 * Averages decibel levels by sound energy, the way the ear and LAeq combine them:
 * 60 and 80 dB average to about 77 dB, not 70.
 */
export function energyAverage(levelsDb: NonEmptyArray<number>): number {
  return levelOf(levelsDb.reduce((sum, level) => sum + energyOf(level), 0) / levelsDb.length);
}

/** Relative sound energy of a decibel level. Energies can be summed and averaged; decibels can't. */
export function energyOf(levelDb: number): number {
  return 10 ** (levelDb / 10);
}

/** The decibel level of a relative sound energy, the inverse of `energyOf`. */
export function levelOf(energy: number): number {
  return 10 * Math.log10(energy);
}

// The level exceeded for `fraction` of the time is the (1 - fraction) percentile,
// linearly interpolated between neighbouring samples.
function levelExceeded(ascending: readonly number[], fraction: number): number {
  const rank = (1 - fraction) * (ascending.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return ascending[lower] + (ascending[upper] - ascending[lower]) * (rank - lower);
}
