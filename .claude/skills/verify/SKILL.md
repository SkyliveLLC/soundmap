---
name: verify
description: Drive the Soundmap Expo app on an iOS Simulator the way a user does (Measure tab, Add to map, the venue question, Map tab hexagons, modeled street noise, venue cards) and capture proof (screenshots, accessibility snapshots, Convex and outbox rows). Use to verify any change to the app's screens, hooks, storage, or the sound-meter module before calling it done.
---

# Verify Soundmap

Soundmap is an iOS/Android Expo app. The user surface is two tabs: **Measure** (a 30 s noise measurement, then "Add to map", which may ask which nearby café, library or coworking space you were in) and **Map** (modeled US DOT street noise as faint hexagons, everyone's measurements as stronger H3 hexagons, and measured venues as dots with an hour-by-hour card). Measurements live on the Convex deployment named in `.env.local` (`CONVEX_DEPLOYMENT`). The phone keeps only an SQLite outbox of readings that haven't uploaded yet. Never point a verification run at a production deployment.

This skill drives the **iOS Simulator** through T3 Code's `agent-device` and the helper `scripts/sm`. Android has the same features. It isn't scripted here because the synthetic mic input exists only on the iOS Simulator. On an Android emulator, the meter would need a real host mic.

Paths below are relative to the repo root. `sm` means `.claude/skills/verify/scripts/sm`.

## Launch

0. **Backend and street noise.** A fresh checkout has no `.env.local`, so the app has no backend. Prefer a local backend owned by this run, so resets never touch the shared dev map:
   ```bash
   CONVEX_AGENT_MODE=anonymous npx convex dev --tail-logs disable > .verify/convex.log 2>&1 &   # writes .env.local; ready at "Convex functions ready!"
   node .claude/skills/verify/scripts/local-backend-env.mjs                                     # auth keys + SOUNDMAP_ALLOW_RESET, once per new backend
   ```
   It serves `http://127.0.0.1:3210`. Another checkout's local backend may already own 3210: check with `lsof -nP -iTCP:3210 -sTCP:LISTEN` first, and read the URL `convex dev` wrote to `.env.local`. The shared cloud dev deployment (`npx convex dev`, logged in) also works, but `dev:resetMap` then wipes everyone's dev data.

   The street-noise layer reads `STREET_NOISE_TILES`, which is `'R2_URL_PENDING'` until the archive is hosted (`src/lib/street-noise.ts`). Without a local archive, the layer is blank and nothing on screen says so. Serve one and point the bundle at it:
   ```bash
   npx -y http-server .street-noise -p 8791 -a 127.0.0.1 --cors > .verify/tiles.log 2>&1 &
   echo 'EXPO_PUBLIC_STREET_NOISE_TILES=pmtiles://http://127.0.0.1:8791/street-noise-2022.pmtiles' >> .env.local
   ```
   `.street-noise/street-noise-2022.pmtiles` comes from the pipeline in the repo `README.md` ("Refresh street noise data"), or a copy from another checkout. `EXPO_PUBLIC_*` values are baked in when Metro bundles, so start Metro after this, or `sm stop && sm metro`.
1. **Pick a simulator nobody else is driving.** Call the `device_list` MCP tool, then `device_open` with a `deviceId`. If an `agent-device` command fails with `DEVICE_IN_USE`, another thread owns that simulator. `device_close` it and open a different one. Never close another session. Remember whether the device was `booted: false` before you opened it, because cleanup depends on it.
2. **Export the driver flags** returned by `device_open`, as one string, in every shell that drives:
   ```bash
   export AD_FLAGS="--platform ios --udid <udid> --config <config.json> --session <session>"
   ```
   `sm ad <args>` runs `agent-device <args> $AD_FLAGS`. (zsh does not word-split `$AD_FLAGS`, which is why it goes through `sm` and its bash.)
3. **Build** only if `sm doctor` says the build is missing or STALE. A stale build means native inputs changed (`app.json`, `package*.json`, `modules/`, `plugins/`, `patches/`, the icons in `assets/`). JS-only changes never need a rebuild.
   ```bash
   npm install          # first time in a checkout; postinstall applies patches/h3-js
                        # npm may add "hasInstallScript" to package-lock.json. Revert it: git checkout package-lock.json
   sm build             # ~3-4 min cold, ~15 s incremental → .verify/build/soundmap.app
   ```
   Don't use `npx expo run:ios --device <udid>` to build and launch. It installs fine, but then crashes on a macOS automation prompt (osascript → System Events) and takes its Metro down with it.
4. **Start Metro** for this checkout. Ready means `sm` prints `Metro ready on :<port>` (it polls `/status`). If another worktree owns 8081, `sm` refuses and names the owner. Use `sm metro 8082`.
   ```bash
   sm metro             # or: sm metro 8082
   ```
5. **Install and open.** Set the simulated GPS before anything asks for location. The coordinates below are Hayes Valley in San Francisco.
   ```bash
   sm ad install com.soundmap.app .verify/build/soundmap.app
   sm ad settings location set 37.7763 -122.4232
   sm ad open com.soundmap.app --relaunch --metro-host 127.0.0.1 --metro-port <port>
   sm ad wait text "Measure" 60000
   ```
   Ready means the tab bar shows `Map, tab, 1 of 2` and `Measure, tab, 2 of 2`. The first bundle takes about 10-20 s.

After a JS edit, run `sm ad metro reload`. Don't reinstall. After a git operation that rewrites files (merge, rebase, checkout), run `sm stop && sm metro` first. Metro's watcher missed those changes twice and kept serving old code. Expo Router puts each screen in its own dev bundle, so grepping the entry bundle can't tell you whether code is fresh. Check the behavior instead.

## Doctor

```bash
sm doctor
```

Read-only. It checks that the `.app` exists and that the native inputs hash the same as when it was built, and that Metro is answering on the recorded port **from this checkout** (by the listener's cwd). Run it first, and again whenever the app shows a red screen, an old UI, or "No bundle URL". To confirm the driver session, run `sm ad snapshot -i`. It should print `App: com.soundmap.app`.

## Drive

Read `features/README.md`, then the feature file for what you're proving. Mechanics that apply everywhere:

- **Tapping app content: use `sm tap "<label>"`.** On iOS 27 the floating tab-bar container covers the whole screen, so `agent-device` marks every in-screen element `[covered]` and refuses label or ref presses. `sm tap` finds the exact accessibility label in `snapshot --raw` and presses the center of its rect. Tab bar buttons and system alerts are not covered, so plain `sm ad press 'label="..."'` works for those.
- **Labels are the visible text.** Pressables have no `accessibilityRole` or `testID` (they show as `[other]`). Use exact strings: `Start measuring`, `Cancel`, `Measure again`, `Try again`, `Add to map`, `Not at any of these`, `<name>, <kind>` venue rows, `Added to map · View`, `Added to <name> · View`, `Open Settings`.
- **Permission prompts.** Microphone (two buttons): `sm ad alert accept`. Location (three buttons): `alert accept` fails, so use `sm ad press 'label="Allow While Using App"'` or `'label="Don’t Allow"'` (curly apostrophe). `alert get` reports "not found" even while a prompt is visible. Trust `snapshot -i`, which lists the alert buttons.
- **Skip prompts** when the permission path is not what you are proving: `sm ad settings permission grant microphone` / `... grant location` (`deny`, `reset` also work).
- **Fresh state:** `npx convex run dev:resetMap` empties `measurements`, `cells` and `venues`, and keeps `venueSearches`, the saved OpenStreetMap results (it refuses unless the deployment sets `SOUNDMAP_ALLOW_RESET=true`, which only dev and local backends do). `sm ad settings clear-app-state com.soundmap.app`, then `open --relaunch`, empties the phone's outbox. The anonymous sign-in lives in the keychain, which `clear-app-state` keeps, so the phone stays the same user.
- **Map hexagons and venue dots are not in the accessibility tree.** After "Added to map · View", the camera centers on the cell, so the hexagon sits at the map's center, about `(201, 395)` on a 402×874 iPhone. Press there. Tap empty map, such as `(80, 600)`, to deselect.
- **Waiting:** `sm ad wait text "<text>" <ms>`. A measurement takes 30 s of audio frames, so wait up to 45000 for `Measure again`.

## Evidence

Write everything to `.verify/evidence/<feature-id>-<YYYYMMDD-HHMM>/`. It's gitignored and cleanup never touches it.

- `sm ad screenshot <dir>/<NN-step>.png` before and after each user action that changes state, so the action and its result are both on record.
- `sm ad snapshot -i > <dir>/<NN-step>.ax.txt` for text proof of labels and values. Screenshots alone don't prove numbers.
- **Side effects:** `npx convex data measurements > <dir>/measurements.txt`, `npx convex data cells`, and for venues `npx convex data venues` and `npx convex data venueSearches`. Add `--format jsonLines` to see every field of each row, including optional ones such as `venueId` and `hour`. Prove a save by the new server row, and check it against the screen: the card's dBA is `round(laeq)`. `sm db` reads the phone's outbox, which is empty once everything has uploaded.
- Drive the real user path: tabs, buttons, system prompts. Don't write to SQLite or Convex to fake a saved measurement, and don't deep-link past a step you claim to verify. The simulator's synthetic café input stands in for the microphone hardware only. Everything after the mic (A-weighting, framing, JS) still runs, so it is an acceptable boundary. Readings are random within a café range, so assert relationships (row matches card, band matches level), not exact numbers.

## Cleanup

Kill only what this run started:

```bash
npx convex run dev:resetMap                       # drop measurements, cells and venues this run saved
sm ad settings clear-app-state com.soundmap.app   # drop anything left in the outbox
sm ad close                                       # end the agent-device session
sm stop                                           # Metro started by `sm metro`, by its process group
```

Stop the local backend and tile server this run started in the background: kill the PIDs you started (your shell's job, or `lsof -nP -iTCP:3210 -iTCP:8791 -sTCP:LISTEN`, after checking with `lsof -a -p <pid> -d cwd` that the cwd is this checkout). Remove the `EXPO_PUBLIC_STREET_NOISE_TILES` line you added to `.env.local`.

Then call the `device_close` MCP tool for your device. Pass `shutdown: true` only if the device was `booted: false` before you opened it. Leave `.verify/build/` in place (rebuilds are slow) and leave `.verify/evidence/`. A local backend keeps its data under `~/.convex`, so the next run's `convex dev` starts where this one stopped. Never `pkill node`/`expo`/`Simulator` by name. Other worktrees run their own Metro and simulators on this machine.

## Helper reference

`scripts/sm` (bash, executable). Run it with no arguments for usage.

| Command | Does |
| --- | --- |
| `sm build` | Build-only simulator `.app` to `.verify/build/`, record a hash of the native inputs (including the icons and splash `app.json` references) |
| `sm metro [port]` | Start Metro for this checkout in its own process group. Refuses ports owned by other checkouts |
| `sm doctor` | Read-only readiness check (exit 1 if not ready) |
| `sm stop` | Stop the Metro `sm metro` started |
| `sm ad <args>` | `agent-device <args> $AD_FLAGS` |
| `sm tap "<label>"` | Press an element's center by exact accessibility label (works around `[covered]`) |
| `sm db [sql]` | Query the app's SQLite on the `$AD_FLAGS` simulator. Default prints the outbox (readings not uploaded yet) |
| `node scripts/local-backend-env.mjs` | Set auth keys and `SOUNDMAP_ALLOW_RESET` on a local or anonymous backend. Refuses any other deployment |
| `node scripts/convex-proxy.mjs <host> [port]` | Plain-HTTP proxy to the dev deployment, stopped to take the app offline (see `features/add-to-map.md`) |
