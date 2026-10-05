export type LevelEvent = {
  /** A-weighted RMS over one 125 ms window, in dB relative to digital full scale. */
  dbfs: number;
};

export type SoundMeterModuleEvents = {
  onLevel: (event: LevelEvent) => void;
};
