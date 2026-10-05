import { NativeModule, requireNativeModule } from 'expo';

import { SoundMeterModuleEvents } from './SoundMeter.types';

declare class SoundMeterModule extends NativeModule<SoundMeterModuleEvents> {
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<SoundMeterModule>('SoundMeter');
