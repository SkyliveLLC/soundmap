import type { ConfigContext } from 'expo/config';

// The config lives in app.json. This only stops a cloud build that has no backend: EXPO_PUBLIC_CONVEX_URL is
// baked into the bundle, and `src/app/_layout.tsx` can't start without it, so such a build crashes on launch.
export default ({ config }: ConfigContext) => {
  if (process.env.EAS_BUILD && !process.env.EXPO_PUBLIC_CONVEX_URL) {
    throw new Error('EXPO_PUBLIC_CONVEX_URL is not set for this EAS environment. See "Ship a build" in README.md.');
  }
  return config;
};
