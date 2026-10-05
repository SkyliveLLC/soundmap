import { useColorScheme } from 'react-native';

const palettes = {
  light: { background: '#F3F0E8', ink: '#1E2320', muted: '#767C77', accent: '#4F7360', track: '#E0DCD1', onAccent: '#F3F0E8' },
  dark: { background: '#111412', ink: '#E9E7E0', muted: '#878D88', accent: '#8DB39C', track: '#232825', onAccent: '#111412' },
};
export type Palette = (typeof palettes)['light'];

export function usePalette(): Palette {
  return palettes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
