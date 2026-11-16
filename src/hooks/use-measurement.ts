import * as Device from 'expo-device';
import { useEffect, useReducer } from 'react';
import { AppState, Platform } from 'react-native';

import SoundMeter from '../../modules/sound-meter/src/SoundMeterModule';
import { summarize, type NonEmptyArray, type NoiseSummary } from '@/lib/acoustics';
import { calibrationFor, type Calibration } from '@/lib/calibration';
import { SESSION_SEC } from '@/lib/measurement';

// Matches the 125 ms window LevelMeter uses on both platforms.
export const FRAME_SEC = 0.125;
export const SESSION_FRAMES = SESSION_SEC / FRAME_SEC;
// Levels arrive every 125 ms. A gap this long means the system took the microphone (a call, Siri, another app's
// recording, a route change) and stopped the capture, which doesn't restart on its own.
const STALL_MS = 3_000;

// Simulators and emulators get no real phone's offset: their model id is the host's architecture,
// and the iOS Simulator's input is synthetic.
function deviceModel(): string {
  if (!Device.isDevice) return 'Simulator';
  const model = Platform.OS === 'ios' ? Device.modelId : [Device.manufacturer, Device.modelName].filter(Boolean).join(' ');
  return typeof model === 'string' && model !== '' ? model : 'Unknown';
}

/** This phone's calibration. Every level the hook reports, and every summary, is in dB SPL through it. */
export const deviceCalibration: Calibration = calibrationFor(deviceModel());

export type MeasurementState =
  | { status: 'idle' }
  | { status: 'denied' }
  | { status: 'measuring'; levels: readonly number[] }
  | { status: 'done'; summary: NoiseSummary; calibration: Calibration }
  | { status: 'failed'; reason: FailureReason };

/** `interrupted`: the phone took the microphone away or the app left the screen, so the session lost its audio. */
export type FailureReason = 'no-input' | 'interrupted' | 'unexpected';

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
      // Only a running session can fail: a late stall or background event must not undo a finished one.
      return state.status === 'measuring' ? { status: 'failed', reason: action.reason } : state;
    case 'level': {
      if (state.status !== 'measuring') return state;
      const levels: NonEmptyArray<number> = [...state.levels, action.dbSpl];
      return levels.length < SESSION_FRAMES
        ? { status: 'measuring', levels }
        : { status: 'done', summary: summarize(levels, FRAME_SEC), calibration: deviceCalibration };
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
 * state is `measuring`: leaving that state (done, cancel, denial, interruption, unmount) releases it.
 */
export function useMeasurement() {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });
  const measuring = state.status === 'measuring';

  useEffect(() => {
    if (!measuring) return;
    let active = true;
    // Null until capture starts, so the permission prompt doesn't count as a stall.
    let lastLevelAt: number | null = null;
    const subscription = SoundMeter.addListener('onLevel', ({ dbfs }) => {
      lastLevelAt = Date.now();
      dispatch({ type: 'level', dbSpl: dbfs + deviceCalibration.offsetDb });
    });
    // A session must be 30 s of continuous sound. In the background iOS pauses the capture and Android records
    // silence, so leaving the app ends the session rather than stitching the gap in.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'background') dispatch({ type: 'failed', reason: 'interrupted' });
    });
    const watchdog = setInterval(() => {
      if (lastLevelAt !== null && Date.now() - lastLevelAt > STALL_MS) dispatch({ type: 'failed', reason: 'interrupted' });
    }, STALL_MS / 4);

    (async () => {
      const { granted } = await SoundMeter.requestPermissionsAsync();
      if (!active) return;
      if (!granted) {
        dispatch({ type: 'denied' });
        return;
      }
      await SoundMeter.start();
      lastLevelAt = Date.now();
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
      appState.remove();
      clearInterval(watchdog);
      SoundMeter.stop();
    };
  }, [measuring]);

  return {
    state,
    start: () => dispatch({ type: 'start' }),
    cancel: () => dispatch({ type: 'cancel' }),
  };
}
