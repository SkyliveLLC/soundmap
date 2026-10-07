# Soundmap

A crowdsourced map of how loud places are, starting in San Francisco. Think Waze, but for noise. It helps remote workers find a quiet café and helps people with sensory sensitivities plan calmer routes.

Status: early prototype. iOS and Android, built with Expo.

## What works today

- **Measure.** A 30 second, A-weighted noise measurement on your phone. It reports the average (LAeq), background (L90), loud moments (L10), peak (LAmax), and spikiness (L10 − L90).
- **Map.** Add a measurement to the shared map and it shows up as a colored hexagon (H3, resolution 10, about one city block) for everyone, live. Hexagons with several measurements show their energy average. Tap any block to see its reading. A measurement added offline waits on the phone and uploads when the connection returns.
- **Street noise.** San Francisco starts colored with road noise from the US DOT [National Transportation Noise Map](https://www.bts.gov/geospatial/national-transportation-noise-map) (NTNM). It is a modeled 24 hour average, not a measurement, so the app shows it faintly under your hexagons and labels it as modeled. It is never averaged into your readings.

Readings are uncalibrated. Phone microphones vary, and per-model calibration is not done yet.

## Privacy

- Audio is processed on the device and never recorded or stored.
- Adding a measurement to the map is always your choice, and it is shared with everyone.
- Only numbers are sent: the noise summary, the H3 cell, and the time. Raw GPS coordinates never leave the phone.
- There are no accounts. Each install signs in as an anonymous user, used to recognize retried uploads.
- The map only ever shows per-block averages and counts. Who measured, and when, stays on the server.

## Run it

You need Node 24+ and Xcode for iOS, or Android Studio for Android. The app uses a native module, so it does not run in Expo Go.

The backend is [Convex](https://convex.dev). `npx convex dev` logs you in, pushes `convex/` to your dev deployment, and writes its URL to `.env.local`, which the app reads.

```bash
npm install
npx convex dev         # keep it running: it re-pushes convex/ on save
npx expo run:ios       # or: npx expo run:android
```

On a new deployment, set the Convex Auth signing keys (`JWT_PRIVATE_KEY` and `JWKS`) once, as described in [Convex Auth's manual setup](https://labs.convex.dev/auth/setup/manual). To empty a dev map, set `SOUNDMAP_ALLOW_RESET=true` on that deployment and run `npx convex run dev:resetMap`.

On the iOS Simulator the sound meter uses a synthetic café soundscape instead of the Mac microphone, so you can test the whole flow without a real device.

```bash
npm test               # unit tests (node --test)
npx tsc --noEmit       # typecheck
npx expo lint
```

## Layout

- `convex/` is the backend: the schema, anonymous auth, and `measurements.ts`, which adds a reading and serves the per-cell averages.
- `modules/sound-meter/` is the native module (Swift and Kotlin). It applies A-weighting and emits a level every 125 ms.
- `src/lib/` holds the pure logic: acoustics, H3 cells, the rules a measurement must pass, the loudness color scale, street noise, and the offline outbox. `convex/` imports from it too.
- `src/hooks/` holds the measurement state machine, the "add to map" flow, and the sync that signs in and uploads queued readings.
- `src/app/` holds the screens (Expo Router): the Map and Measure tabs.
- `scripts/` holds the street noise pipeline.
- `assets/street-noise/` holds its generated output: `levels.json` (dBA per cell) and `cells.geojson` (the same cells as polygons). Don't edit them by hand.
- `patches/` holds a `patch-package` fix that lets `h3-js` run on Hermes ([uber/h3-js#203](https://github.com/uber/h3-js/issues/203)).

## Refresh street noise data

When BTS publishes a new NTNM release, rebuild the bundled data:

1. In a browser, download `CONUS_road_noise_<year>.zip` from the [NTNM page](https://www.bts.gov/geospatial/national-transportation-noise-map) and unzip it. The server blocks curl.
2. Install GDAL, which reads the File Geodatabase: `brew install gdal`.
3. Run the pipeline:

   ```bash
   npm run street-noise -- --gdb ~/Downloads/CONUS_road_noise_2024/CONUS_road_noise.gdb --release 2024
   ```

The output is deterministic, so the diff shows only what the release changed. `npm test` checks that the two files agree.

## Roadmap

- Street noise beyond San Francisco (needs vector tiles), and rail and aviation noise.
- Per-device calibration.
- Venues: rate how quiet a café is at a given hour.
- Quiet walking routes.

## License

MIT. See [LICENSE](LICENSE).
