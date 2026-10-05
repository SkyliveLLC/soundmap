import { NativeModule, requireNativeModule, type PermissionResponse } from 'expo';

import type { SoundMeterModuleEvents } from './SoundMeter.types';

declare class SoundMeterModule extends NativeModule<SoundMeterModuleEvents> {
  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  /** Starts emitting `onLevel` every 125 ms. Rejects without microphone permission. Idempotent. */
  start(): Promise<void>;
  /** Stops capture and releases the microphone. Idempotent. */
  stop(): void;
}

export default requireNativeModule<SoundMeterModule>('SoundMeter');
