# Add to map

After a measurement finishes, "Add to map" (under `Shared anonymously on the public map, as the block you’re on.`) asks for location, queues the summary in the phone's outbox at the H3 cell (about one city block) around the user, and uploads it to Convex. Online, it turns into "Added to map · View", which opens the Map tab focused on that cell. Offline, it says `Saved. It will appear on the map when you’re back online.` and uploads on reconnect, even after an app restart. Only the cell is sent, never coordinates.

## Sub-features

- `add-save` uploads one row and shows `Added to map · View`. The outbox is empty afterwards.
- `add-queued` offline shows the `Saved. It will appear…` message, keeps one outbox row across a relaunch, and uploads it exactly once on reconnect.
- `add-view` opens the Map tab, flies to the saved cell, and shows its card.
- `add-denied` shows the location-off message with `Open Settings`, and saves nothing.
- `add-privacy` sends the H3 cell, time, and noise numbers only, with no latitude or longitude. The public `measurements:cells` query returns no user ids or times.

## How to get to it (user POV)

- Finish a measurement (see `measure.md`), then tap `Add to map` on the summary.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`, with the summary screen showing (`Measure again` visible).
- Simulated location set to `37.7763 -122.4232`. Location permission is `reset` (to test the prompt) or `grant`ed.

- **Add.** Run `sm tap "Add to map"`. On first run, `Allow “soundmap” to use your location?` appears with three buttons. Run `sm ad press 'label="Allow While Using App"'`. Near venues, the venue question shows first (see `venues.md`). Run `sm tap "Not at any of these"` to save without one. Run `sm ad wait text "Added to map · View" 20000`.
- **Side effect.** Run `npx convex data measurements`. Exactly one new row has `cell` `8a2830828317fff` (for the coordinates above), `durationSec` 30, `laeq` whose rounding equals the summary's big number, and `calibration` `{ model: "Simulator", offsetDb: 120, id: null }`. `sm db` shows an empty outbox. Prove `add-privacy` from the column list (no latitude or longitude) and from `npx convex run measurements:cells`, which returns only `cell`, `laeq`, `count`.
- **View.** Run `sm tap "Added to map · View"`. The Map tab is selected. `snapshot -i` shows `<round(laeq)> dBA average` and `<band> · 1 measurement`, and a screenshot shows a hexagon in the band color at the map center.
- **Denied.** From a fresh summary, run `sm ad settings permission deny location`, then `sm tap "Add to map"`. The screen shows `Location is off for Soundmap, so this measurement was not added to the map.` and `Open Settings`. Neither `sm db` nor `npx convex data measurements` shows a new row.
- **Offline.** The simulator shares the Mac's network, and `settings airplane on` only changes the status bar. To cut the connection for real, put a proxy in front of the deployment: start `node .claude/skills/verify/scripts/convex-proxy.mjs <deployment>.convex.cloud 3299` in the background, back up `.env.local`, set `EXPO_PUBLIC_CONVEX_URL=http://127.0.0.1:3299` in it, and restart Metro with `--clear`. Relaunch the app. It signs in as a new anonymous user, because tokens are stored per URL. Stop the proxy to go offline, then measure and add. Expect the queued message and one `sm db` row. Relaunch the app, and the row is still there. Start the proxy again, and within about 20 s the outbox is empty and the server has the row with the same `clientId`. Repeat without the relaunch to prove the in-memory path. Afterwards, restore `.env.local`, stop the proxy, and restart Metro with `--clear`.
- **Proof.** Save a screenshot of `Added to map · View`, the `npx convex data measurements` output, and the map screenshot with its card.

## Gotchas

- `sm ad alert accept` fails on the location prompt ("accept button not found") because it has three buttons. Press the button by label.
- If location was never set, the simulator may have no fix and the save ends in `Could not add this measurement to the map.` Set it before tapping.
- Uploading twice from the same summary is not possible (the button becomes `Added to map · View` and does not re-save). Re-measure to add a second row.
- `View` puts `?cell=` in the Map route.
- Expo's env module reads `.env.local` and ignores `EXPO_PUBLIC_CONVEX_URL` from the shell, so the proxy URL has to go in the file. Another worktree's Metro may own 8082. Check a port's owner with `lsof` before pointing the app at it.
