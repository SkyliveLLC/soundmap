# Map

The Map tab shows the US colored with modeled transportation noise (roads, rail and aviation) from the US DOT noise map (faint hexagons, read from a PMTiles archive), with everyone's measurements in view as stronger hexagons on top, updated live. It opens where the phone is when location is already allowed, otherwise on the lower 48. Zoomed out (below 12), the faint hexagons are area averages; from zoom 12 in, they are blocks. Both use one loudness scale: Very quiet (<45), Quiet (<55), Moderate (<65), Loud (<75), Very loud. Tapping any block selects it with an outline in the theme's ink color (dark in light mode, near white in dark mode) and a card; tapping it again clears both. The card shows the block's energy-averaged measurement when there is one, and the DOT value as a separate "modeled" line. The two are never averaged. A long-press plans a quiet walk: the phone downloads the walking tiles around the trip, plans on the JS thread, and draws the shortest way as a thin grey line under a thick route colored block by block, with a route card.

## Sub-features

- `map-street-noise` draws the DOT layer on launch, with no measurements needed.
- `map-initial-camera` opens at zoom 13 on the phone when location is already granted and the phone has a last fix, otherwise at zoom 3 on the lower 48.
- `map-zoomed-out` shows larger area hexagons further out, and a tap there clears the card instead of answering for a block. Below zoom 10, measured cells stop loading (the last result stays drawn) and venue dots hide.
- `map-empty` shows `Colors show modeled transportation noise. Measure a spot to add yours.` when a loaded view (zoom 10 or closer) has no measurement and nothing is selected. On the lower-48 launch view nothing has loaded, so no hint shows.
- `map-shared-down` shows `Can't load shared measurements right now. Colors show modeled transportation noise.` when the measured-cells or venues query fails (a backend behind the app, rolled back, or erroring): hexagons loaded before the failure stay drawn, venue dots go, a walk plans `· modeled only`, and the app stays open. The layer comes back on its own once the deployment's functions change.
- `map-cells` draws one stronger hexagon per measured cell, in its band color.
- `map-select-modeled` handles a tap on an unmeasured block with DOT data: `<N> dBA modeled transportation noise`, `<band>`, `24 h avg · US DOT 2022 · Modeled, not measured`.
- `map-select-below-floor` handles a tap on a blank block on US land: `Below 45 dBA modeled transportation noise`, `Very quiet`, `US DOT 2022 · Modeled, not measured`.
- `map-select-measured` shows `<N> dBA average`, `<band> · <count> measurement(s)`, plus `<N> dBA modeled transportation noise · 24 h avg · US DOT 2022` when DOT has a value, or `Modeled transportation noise below 45 dBA · US DOT 2022` when the block is below the floor.
- `map-tap-still` means a map tap never moves the camera. Only `Added to map · View` (or a `soundmap:///?cell=` link) flies to the cell.
- `map-deselect` clears the card when you tap an unmeasured block outside the DOT area: water, piers, or outside the US.
- `map-aggregate` combines several measurements in one cell into one energy-averaged level and count.
- `map-route-ask` handles a long-press with no walk: an end pin drops and the card shows `Walk here`, `From my location`, `or long-press where to start` and `Close`.
- `map-route-planned` handles a second long-press, which sets the start. The card shows `Finding a quieter way…`, then `<N> dB quieter` (plus `Noticeably quieter` at 3 or more), `+<m> m, about <n> min longer · <km> km, <min> min`, `<n> min less beside loud roads` when the shortest has loud stretches, and `US DOT 2022 modeled noise · measured on <n> block(s)`. The note ends `· modeled only` when Convex didn't answer within 2 s of the tiles. The start pin is hollow, the end pin filled. The camera fits both pins once per new pair.
- `map-route-already-quiet` shows `The shortest way is already the quiet one` and `<km> km, <min> min · <N> dBA along the way`, with one route and no grey line.
- `map-route-presets` shows a `Quieter` / `Quietest` switch only when both presets found different routes. Switching redraws at once and logs no new `planWalk` line.
- `map-route-from-location` makes `From my location` ask for location the first time and read one fix. Denied, the card keeps asking for a long-press.
- `map-route-edit` covers `Swap` (pins trade places, the route replans), `Change start` (the start pin goes and the card asks again) and `Close` (route, pins and card go).
- `map-route-failures` shows one line each: `Quiet routes are for walks up to 5 km.` with `These points are <km> km apart.`, `Pick an end farther from the start.`, `No walking map here yet.`, `Pick a start closer to a street or path.` (or `an end`), `No walking route joins these points.`, and `Can't load the walking map. Check your connection.` with a `Try again` button that reads the same trip again
- `map-route-cell-tap` makes a block tap mid-route show that block's card with the route still drawn. Tapping the same block again clears its card and brings the route card back.
- `map-live` shows a measurement added on another phone without any interaction on this one, while this phone's view is at zoom 10 or closer.

## How to get to it (user POV)

- Tap the `Map` tab (the app opens on it).
- Tap `Added to map · View` after saving (see `add-to-map.md`).
- Long-press the map for a walk's end, then long-press again or tap `From my location` for its start.
- Open `soundmap:///?from=<lng>,<lat>&to=<lng>,<lat>` for a walk, optionally with `&quiet=quietest`. Points are longitude first.
- Open `soundmap:///?cell=<h3>`: `sm ad open com.soundmap.app 'soundmap:///?cell=<h3>'` opens it directly. Opened another way (Safari, `simctl openurl`), iOS may ask `Open in "soundmap"?`. Accept it with `sm ad press 'label="Open"'`.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`, with location granted, so the map opens at zoom 13 on Hayes Valley. The street-noise layer needs the local archive (SKILL.md, Launch step 0). For the measured sub-features, at least one saved row (run `add-to-map.md` first).
- For `map-live`, a second simulator with the app open on the Map tab against the same Metro.

- **Street noise.** After launch at the Hayes Valley location, a screenshot shows colored hexagons before any measurement, with US-101 red. `.verify/tiles.log` shows the range requests.
- **Zoomed out.** `sm ad gesture pinch 0.35 201 400`, repeated, zooms out. Larger hexagons replace the blocks, then cover the country. Tap anywhere: the card clears.
- **Empty.** With cleared data, `sm ad snapshot -i` shows the hint text and no `dBA`.
- **Modeled block.** At the launch view, run `sm ad press 200 270`. The card shows `<N> dBA modeled transportation noise`, a band matching `<N>`, and `24 h avg · US DOT 2022 · Modeled, not measured` (57 dBA, Moderate, with the 2022 archive). Screenshots before and after show the same camera, plus an outline on the tapped block.
- **Below 45.** The launch view is already at block zoom. Tap a white, uncolored block, such as `sm ad press 130 285`. The card shows `Below 45 dBA modeled transportation noise`, `Very quiet` and `US DOT 2022 · Modeled, not measured`, with an outline.
- **Measured.** After `Added to map · View`, the card shows both lines. Check that `round(laeq)` of the `npx convex data measurements` row equals the first line, and that the DOT line matches the cell in `.street-noise/blocks.tsv` when you have a build. For cell `8a2830828317fff`, DOT 2022 is 57.5, shown as 58.
- **Aggregate.** Measure and add again at the same location (a venue reading counts too). The card shows `· 2 measurements`, and its dBA is the energy average of the two server rows. `npx convex data cells` holds that cell with `count` 2.
- **Live.** With phone B on the Map tab showing the empty hint, add a measurement on phone A. Without touching B, its hint disappears within a few seconds. Open the cell on B (deep link, because the puck covers it) and its card matches A's row.
- **Quiet walks.** These run on the Android emulator, driven with `adb` (scheme `soundmap`, package `com.soundmap.app`). Until the walking archive is hosted, serve the one `scripts/walk-graph.ts` built: `npx -y http-server <dir> -p 8792 -a 127.0.0.1 --cors`, `adb reverse tcp:8792 tcp:8792`, and `EXPO_PUBLIC_WALK_TILES=http://127.0.0.1:8792/<archive>.pmtiles` in `.env.local` before Metro starts.
  - Planned: `adb shell "am start -W -a android.intent.action.VIEW -d 'soundmap:///?from=-122.418,37.7785&to=-122.4082,37.77' com.soundmap.app"` opens Civic Center to Division & Bryant (q1's soma-4). The quiet route follows Dore and Harrison. `adb logcat -s ReactNativeJS` (or Metro's output) shows `planWalk planned in <ms> ms (<n> tiles)`, once per plan.
  - Long-press: `adb shell input swipe <x> <y> <x> <y> 800` is a long-press. With no walk it drops the end pin, and a second one sets the start.
  - From my location: `adb emu geo fix -122.4194 37.7793` (longitude first), then tap `From my location` and answer the system dialog: allow while using the app, or deny to see the card keep asking.
  - Too far: `from=-122.418,37.7785&to=-122.33,37.80`. Nevada: `from=-119.81,39.53&to=-119.80,39.525` gives `No walking map here yet.` while the archive covers only California. Off path: `from=-122.3937,37.7955&to=-122.386,37.805` puts the end in the Bay.
  - Offline: `adb shell cmd connectivity airplane-mode enable`, then plan a trip in an area this session hasn't loaded. The walking tiles read from Cloudflare R2, but a local `EXPO_PUBLIC_WALK_TILES` over `adb reverse` keeps working in airplane mode, so test this against R2. Re-enable with `disable`, then `Try again` plans the trip.
  - Block tap: with a route showing, tap a colored block beside it, then tap the Bay.
- **Proof.** Before and after screenshots of each tap, `snapshot -i` text, and `npx convex data` output.

## Gotchas

- Hexagons and the user-location dot have no accessibility elements. Press them by coordinates.
- At launch zoom, the location puck covers the measured Hayes Valley hexagon and swallows taps on it. Select it with `View` or the deep link instead.
- Map tiles come from `tiles.openfreemap.org`, so they need network. The DOT layer comes from `STREET_NOISE_TILES`, the nationwide archive on Cloudflare R2, so it needs network too. Offline, the layer is blank, the hint still says `Colors show…`, taps on unmeasured blocks clear the card, and measured cards have no modeled line. To test a new archive, serve it locally (SKILL.md, Launch step 0; the repo `README.md`'s "Refresh street noise data").
- A local archive covers only the area it was built for. Zoomed out past it, the larger hexagons stop at its edge.
- Metro sometimes keeps serving an old bundle after edits, even across `metro reload`. If the screen doesn't reflect a change, `sm stop && sm metro <port>` and relaunch before debugging further.
- Walking tiles stay in memory for the session, so an area loaded once still routes offline. Relaunch the app, or pick a new area, to see the offline copy.
- The permission text in `app.json` (`locationWhenInUsePermission`) is iOS only. Android's location dialog has system text only, and its new copy needs a native rebuild.
- The first plan waits up to 2 s for Convex's measured blocks after the tiles arrive. A Convex that is down gives `· modeled only` instead of a hang.
- The location dot shows only once location permission is granted. The Map tab never prompts for it.
- Data is live: a Convex query, not a reload on focus. A phone that was offline catches up when it reconnects.
