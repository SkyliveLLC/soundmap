# Soundmap

A crowdsourced map of how loud places are, across the United States. Think Waze, but for noise. It helps remote workers find a quiet café and helps people with sensory sensitivities plan calmer routes.

Status: early prototype. iOS and Android, built with Expo.

## What works today

- **Measure.** A 30 second, A-weighted noise measurement on your phone. It reports the average (LAeq), background (L90), loud moments (L10), peak (LAmax), and spikiness (L10 − L90).
- **Map.** Add a measurement to the shared map and it shows up as a colored hexagon (H3, resolution 10, about one city block) for everyone, live. Hexagons with several measurements show their energy average. Tap any block to see its reading. A measurement added offline waits on the phone and uploads when the connection returns. The map opens where you are once you've allowed location, and on the lower 48 before that.
- **Street noise.** All 50 states and DC start colored with road noise from the US DOT [National Transportation Noise Map](https://www.bts.gov/geospatial/national-transportation-noise-map) (NTNM). It is a modeled 24 hour average, not a measurement, so the app shows it faintly under your hexagons and labels it as modeled. It is never averaged into your readings. Zoomed in, each hexagon is a block. Zoomed out, larger hexagons show the area's average, with blocks quieter than 45 dBA counted as silent.

Phone microphones vary, so each reading is converted to dB SPL with an offset for that phone model and stored with the model and calibration it used. Models are added to `CALIBRATIONS` in `src/lib/calibration.ts` once measured against a reference sound level meter. Until a model has an entry, its readings use a placeholder offset and the Measure tab labels them UNCALIBRATED. No model has an entry yet.

## Privacy

- Audio is processed on the device and never recorded or stored.
- Adding a measurement to the map is always your choice, and it is shared with everyone.
- Only the noise summary, the H3 cell, the time, and the phone model with its calibration are sent. Raw GPS coordinates never leave the phone.
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

- `convex/` is the backend: the schema, anonymous auth, and `measurements.ts`, which adds a reading and serves the per-cell averages for the regions the map is showing.
- `modules/sound-meter/` is the native module (Swift and Kotlin). It applies A-weighting and emits a level every 125 ms.
- `src/lib/` holds the pure logic: acoustics, per-model calibration, H3 cells and regions, the rules a measurement must pass, the loudness color scale, street noise and reading it from the tiles, and the offline outbox. `convex/` imports from it too.
- `src/hooks/` holds the measurement state machine, the "add to map" flow, and the sync that signs in and uploads queued readings.
- `src/app/` holds the screens (Expo Router): the Map and Measure tabs.
- `scripts/` holds the street noise pipeline. Its output is one PMTiles archive, hosted on Cloudflare R2 rather than shipped in the app.
- `patches/` holds a `patch-package` fix that lets `h3-js` run on Hermes ([uber/h3-js#203](https://github.com/uber/h3-js/issues/203)).

## Refresh street noise data

The map reads street noise from `street-noise-<release>.pmtiles`, a single file of vector tiles that MapLibre and the app read with HTTP range requests. To build it from a new NTNM release:

1. In a browser, download the road noise zips for CONUS, Alaska and Hawaii from the [NTNM page](https://www.bts.gov/geospatial/national-transportation-noise-map) and unzip them. The server blocks curl.
2. Install the tools: `brew install gdal tippecanoe`. GDAL reads the File Geodatabase rasters; tippecanoe writes the tiles.
3. Run the pipeline with one `--raster` per raster layer (`gdalinfo <gdb>` lists them):

   ```bash
   npm run street-noise -- --release 2022 \
     --raster OpenFileGDB:<CONUS gdb>:<layer> --raster OpenFileGDB:<Alaska gdb>:<layer> --raster OpenFileGDB:<Hawaii gdb>:<layer>
   ```

   It reads the rasters in 1° windows in parallel, into `.street-noise/blocks.tsv` (one line per block). That takes hours for the whole country, so `--blocks .street-noise/blocks.tsv` rebuilds only the tiles from an earlier run. The tiles also carry the modeled area (the 50 states and DC, from Census cartographic boundaries), which tells a quiet block from one DOT doesn't model.
4. Upload the archive to the Cloudflare R2 bucket with [rclone](https://rclone.org/s3/#cloudflare-r2), set up once as a remote named `r2` with your R2 API keys (the dashboard can't upload files this large): `rclone copyto .street-noise/street-noise-2022.pmtiles r2:<bucket>/street-noise-2022.pmtiles`. Then set `STREET_NOISE_RELEASE` and `STREET_NOISE_TILES` in `src/lib/street-noise.ts`. A new release gets a new file name, so phones never mix two releases.

To try tiles before uploading them, serve `.street-noise/` with any server that supports range requests (`npx http-server .street-noise -p 8791`) and point a dev build at it in `.env.local`: `EXPO_PUBLIC_STREET_NOISE_TILES=pmtiles://http://127.0.0.1:8791/street-noise-2022.pmtiles`.

## Roadmap

- Rail and aviation noise.
- Calibrate the most common phone models.
- Venues: rate how quiet a café is at a given hour.
- Quiet walking routes.

## License

MIT. See [LICENSE](LICENSE).
