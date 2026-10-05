---
name: verify
description: Drive the Soundmap Expo app on an iOS Simulator the way a user does (Measure tab, Add to map, Map tab hexagons) and capture proof (screenshots, accessibility snapshots, SQLite rows). Use to verify any change to the app's screens, hooks, storage, or the sound-meter module before calling it done.
---

# Verify Soundmap

Soundmap is an iOS/Android Expo app. The user surface is two tabs: **Measure** (a 30 s noise measurement, then "Add to map") and **Map** (saved measurements as colored H3 hexagons). There is no server. All state is one SQLite file inside the app's container.

This skill drives the **iOS Simulator** through T3 Code's `agent-device` and the helper `scripts/sm`. Android has the same features. It isn't scripted here because the synthetic mic input exists only on the iOS Simulator. On an Android emulator, the meter would need a real host mic.

Paths below are relative to the repo root. `sm` means `.claude/skills/verify/scripts/sm`.

## Launch

1. **Pick a simulator nobody else is driving.** Call the `device_list` MCP tool, then `device_open` with a `deviceId`. If an `agent-device` command fails with `DEVICE_IN_USE`, another thread owns that simulator. `device_close` it and open a different one. Never close another session. Remember whether the device was `booted: false` before you opened it, because cleanup depends on it.
2. **Export the driver flags** returned by `device_open`, as one string, in every shell that drives:
   ```bash
   export AD_FLAGS="--platform ios --udid <udid> --config <config.json> --session <session>"
   ```
   `sm ad <args>` runs `agent-device <args> $AD_FLAGS`. (zsh does not word-split `$AD_FLAGS`, which is why it goes through `sm` and its bash.)
3. **Build** only if `sm doctor` says the build is missing or STALE. A stale build means native inputs changed (`app.json`, `package*.json`, `modules/`, `plugins/`, `patches/`). JS-only changes never need a rebuild.
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
- **Labels are the visible text.** Pressables have no `accessibilityRole` or `testID` (they show as `[other]`). Use exact strings: `Start measuring`, `Cancel`, `Measure again`, `Try again`, `Add to map`, `Added to map · View`, `Open Settings`.
- **Permission prompts.** Microphone (two buttons): `sm ad alert accept`. Location (three buttons): `alert accept` fails, so use `sm ad press 'label="Allow While Using App"'` or `'label="Don’t Allow"'` (curly apostrophe). `alert get` reports "not found" even while a prompt is visible. Trust `snapshot -i`, which lists the alert buttons.
- **Skip prompts** when the permission path is not what you are proving: `sm ad settings permission grant microphone` / `... grant location` (`deny`, `reset` also work).
- **Fresh state:** `sm ad settings clear-app-state com.soundmap.app`, then `open --relaunch`. This empties the map and resets nothing else.
- **Map hexagons are not in the accessibility tree.** After "Added to map · View", the camera centers on the cell, so the hexagon sits at the map's center, about `(201, 395)` on a 402×874 iPhone. Press there. Tap empty map, such as `(80, 600)`, to deselect.
- **Waiting:** `sm ad wait text "<text>" <ms>`. A measurement takes 30 s of audio frames, so wait up to 45000 for `Measure again`.

## Evidence

Write everything to `.verify/evidence/<feature-id>-<YYYYMMDD-HHMM>/`. It's gitignored and cleanup never touches it.

- `sm ad screenshot <dir>/<NN-step>.png` before and after each user action that changes state, so the action and its result are both on record.
- `sm ad snapshot -i > <dir>/<NN-step>.ax.txt` for text proof of labels and values. Screenshots alone don't prove numbers.
- **Side effects:** `sm db > <dir>/db.txt`. It reads the real SQLite file from the simulator's app container. Prove a save by the new row, and check the row against the screen: the card's dBA is `round(laeq)`.
- Drive the real user path: tabs, buttons, system prompts. Don't write to SQLite to fake a saved measurement, and don't deep-link past a step you claim to verify. The simulator's synthetic café input stands in for the microphone hardware only. Everything after the mic (A-weighting, framing, JS) still runs, so it is an acceptable boundary. Readings are random within a café range, so assert relationships (row matches card, band matches level), not exact numbers.

## Cleanup

Kill only what this run started:

```bash
sm ad settings clear-app-state com.soundmap.app   # drop rows this run saved
sm ad close                                       # end the agent-device session
sm stop                                           # Metro started by `sm metro`, by its process group
```

Then call the `device_close` MCP tool for your device. Pass `shutdown: true` only if the device was `booted: false` before you opened it. Leave `.verify/build/` in place (rebuilds are slow) and leave `.verify/evidence/`. Never `pkill node`/`expo`/`Simulator` by name. Other worktrees run their own Metro and simulators on this machine.

## Helper reference

`scripts/sm` (bash, executable). Run it with no arguments for usage.

| Command | Does |
| --- | --- |
| `sm build` | Build-only simulator `.app` to `.verify/build/`, record a hash of the native inputs |
| `sm metro [port]` | Start Metro for this checkout in its own process group. Refuses ports owned by other checkouts |
| `sm doctor` | Read-only readiness check (exit 1 if not ready) |
| `sm stop` | Stop the Metro `sm metro` started |
| `sm ad <args>` | `agent-device <args> $AD_FLAGS` |
| `sm tap "<label>"` | Press an element's center by exact accessibility label (works around `[covered]`) |
| `sm db [sql]` | Query the app's SQLite on the `$AD_FLAGS` simulator. Default prints all measurements |
