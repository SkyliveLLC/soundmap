import { useEffect, useReducer } from 'react';

import SoundMeter from '../../modules/sound-meter/src/SoundMeterModule';
import { CALIBRATION_OFFSET_DB, summarize, type NonEmptyArray, type NoiseSummary } from '@/lib/acoustics';

// Matches the 125 ms window LevelMeter uses on both platforms.
export const FRAME_SEC = 0.125;
export const SESSION_SEC = 30;
export const SESSION_FRAMES = SESSION_SEC / FRAME_SEC;

export type MeasurementState =
  | { status: 'idle' }
  | { status: 'denied' }
  | { status: 'measuring'; levels: readonly number[] }
  | { status: 'done'; summary: NoiseSummary }
  | { status: 'failed'; reason: FailureReason };

export type FailureReason = 'no-input' | 'unexpected';

type Action =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'denied' }
  | { type: 'failed'; reason: FailureReason }
  | { type: 'level'; dbSpl: number };

// The session length is counted in audio frames, so a session always holds exactly
// 30 s of sound regardless of JS timer jitter.
function reducer(state: MeasurementState, action: Action): MeasurementState {
  switch (action.type) {
    case 'start':
      return state.status === 'measuring' ? state : { status: 'measuring', levels: [] };
    case 'cancel':
      return { status: 'idle' };
    case 'denied':
      return { status: 'denied' };
    case 'failed':
      return { status: 'failed', reason: action.reason };
    case 'level': {
      if (state.status !== 'measuring') return state;
      const levels: NonEmptyArray<number> = [...state.levels, action.dbSpl];
      return levels.length < SESSION_FRAMES
        ? { status: 'measuring', levels }
        : { status: 'done', summary: summarize(levels, FRAME_SEC) };
    }
  }
}

// Native exception codes are inferred from class names: NoAudioInputException -> ERR_NO_AUDIO_INPUT.
function failureReason(error: unknown): FailureReason {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return code === 'ERR_NO_AUDIO_INPUT' ? 'no-input' : 'unexpected';
}

/**
 * Runs one fixed-length noise measurement. The microphone is held only while the
 * state is `measuring`: leaving that state (done, cancel, denial, unmount) releases it.
 */
export function useMeasurement() {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });
  const measuring = state.status === 'measuring';

  useEffect(() => {
    if (!measuring) return;
    let active = true;
    const subscription = SoundMeter.addListener('onLevel', ({ dbfs }) => {
      dispatch({ type: 'level', dbSpl: dbfs + CALIBRATION_OFFSET_DB });
    });

    (async () => {
      const { granted } = await SoundMeter.requestPermissionsAsync();
      if (!active) return;
      if (!granted) {
        dispatch({ type: 'denied' });
        return;
      }
      await SoundMeter.start();
      // Cleanup may have run while start was in flight. Its stop() came too early.
      if (!active) SoundMeter.stop();
    })().catch((error: unknown) => {
      if (!active) return;
      const reason = failureReason(error);
      if (reason === 'unexpected') console.warn('[use-measurement]', error);
      dispatch({ type: 'failed', reason });
    });

    return () => {
      active = false;
      subscription.remove();
      SoundMeter.stop();
    };
  }, [measuring]);

  return {
    state,
    start: () => dispatch({ type: 'start' }),
    cancel: () => dispatch({ type: 'cancel' }),
  };
}
