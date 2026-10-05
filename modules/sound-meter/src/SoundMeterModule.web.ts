import { registerWebModule, NativeModule } from 'expo';

import { SoundMeterModuleEvents } from './SoundMeter.types';

// SoundMeterModule is not available on the web platform.
class SoundMeterModule extends NativeModule<SoundMeterModuleEvents> {}

export default registerWebModule(SoundMeterModule, 'SoundMeterModule');
