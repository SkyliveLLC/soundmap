# Soundmap verification map

This directory is the maintained source for verifying Soundmap's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe. Launch, doctor, and cleanup live in `../SKILL.md`.

## Baseline preconditions

- `sm doctor` prints `doctor: OK` for this checkout.
- `AD_FLAGS` holds the flags from `device_open` for a simulator this run owns.
- The app is installed from `.verify/build/soundmap.app` and opened with `--relaunch` against this checkout's Metro port.
- Simulated location is set: `sm ad settings location set 37.7763 -122.4232`.
- Unless a recipe says otherwise, start from empty data: `sm ad settings clear-app-state com.soundmap.app`, then `sm ad open com.soundmap.app --relaunch --metro-host 127.0.0.1 --metro-port <port>`. This keeps granted permissions. Use `sm ad settings permission reset <microphone|location>` to see a prompt again.

## Driving conventions

- Tap app content with `sm tap "<exact visible text>"`. Tap tabs and system alert buttons with `sm ad press 'label="..."'`.
- Tabs: `Map, tab, 1 of 2` and `Measure, tab, 2 of 2`.
- Permission prompts are part of the user path. Pre-grant them with `sm ad settings permission grant <microphone|location>` only when the prompt is not under test, and say so in the report.
- Map hexagons have no accessibility element. Press them by screen position (see `map.md`).
- Treat quoted labels as literal. `·` is a middle dot. `Don’t Allow` uses a curly apostrophe.

## Proof and skip reporting

- Capture the action and the resulting state: screenshot plus `snapshot -i` before and after each state change.
- A save is proven by `sm db` showing the new row and by the map showing a hexagon whose card matches that row.
- Save artifacts under `.verify/evidence/<feature-id>-<YYYYMMDD-HHMM>/` and name the entry point used.
- Report an unreachable path with the command tried and the unmet precondition. Do not report a skipped entry point as verified through a different one.
- The iOS Simulator feeds a synthetic café sound instead of the mic. Hardware mic behavior and `no-input` failures cannot be proven on the simulator. Report them as skipped.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with agent-device`, `Gotchas`.

## Features

- [Measure noise](./measure.md) covers the 30 s session, live readout, summary stats, cancel, and microphone denial.
- [Add to map](./add-to-map.md) covers saving a finished measurement at the current H3 cell, location denial, and jumping to the map.
- [Map](./map.md) covers the empty state, colored hexagons, energy-averaged cells, and selecting a cell.
