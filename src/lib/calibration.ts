/**
 * How one phone turned A-weighted dBFS into dB SPL. It travels with every reading, so readings from
 * different phones can be told apart on the shared map and corrected later if a model's offset changes.
 */
export type Calibration = {
  /** The phone model: the iOS hardware id ("iPhone16,1"), "<manufacturer> <model>" on Android, or "Simulator". */
  model: string;
  /** dB SPL = A-weighted dBFS + offsetDb. */
  offsetDb: number;
  /** The `CALIBRATIONS` entry offsetDb came from, or null when this model has none and the reading is uncalibrated. */
  id: string | null;
};

type CalibrationEntry = { id: string; offsetDb: number };

/**
 * Measured offsets per phone model, keyed like `Calibration.model`. An entry comes from playing pink
 * noise next to a reference sound level meter and comparing the two. Give each entry a new id, such as
 * "iPhone16,1/2026-10", and never reuse one: stored readings name the id they were measured with.
 */
export const CALIBRATIONS: Partial<Record<string, CalibrationEntry>> = {};

/**
 * Used for models without an entry. Placeholder, not a measurement: phone MEMS microphones are typically
 * specified around -26 dBFS for a 94 dB SPL tone, which puts digital full scale near 120 dB SPL. Real
 * offsets differ per model (mic part, OS input gain), so these readings can be off by several dB.
 */
export const UNCALIBRATED_OFFSET_DB = 120;

/** The calibration a reading from `model` gets: its measured entry, or the uncalibrated placeholder. */
export function calibrationFor(model: string, calibrations = CALIBRATIONS): Calibration {
  const entry = calibrations[model];
  return entry ? { model, ...entry } : { model, offsetDb: UNCALIBRATED_OFFSET_DB, id: null };
}
