# Map

The Map tab shows San Francisco colored with modeled road noise from the US DOT noise map (faint hexagons), with everyone's measurements as stronger hexagons on top, updated live. Both use one loudness scale: Very quiet (<45), Quiet (<55), Moderate (<65), Loud (<75), Very loud. Tapping any block selects it with a dark outline and a card. The card shows the block's energy-averaged measurement when there is one, and the DOT value as a separate "modeled" line. The two are never averaged.

## Sub-features

- `map-street-noise` draws the DOT layer on launch, with no measurements needed.
- `map-empty` shows `Colors show modeled street noise. Measure a spot to add yours.` when there are no rows and nothing is selected.
- `map-cells` draws one stronger hexagon per measured cell, in its band color.
- `map-select-modeled` handles a tap on an unmeasured block with DOT data: `<N> dBA modeled street noise`, `<band>`, `24 h avg · US DOT 2022 · Modeled, not measured`.
- `map-select-below-floor` handles a tap on a blank block inside SF: `Below 45 dBA modeled street noise`, `Very quiet`.
- `map-select-measured` shows `<N> dBA average`, `<band> · <count> measurement(s)`, plus `<N> dBA modeled street noise · 24 h avg · US DOT 2022` when DOT has a value.
- `map-tap-still` means a map tap never moves the camera. Only `Added to map · View` (or a `soundmap:///?cell=` link) flies to the cell.
- `map-deselect` clears the card when you tap an unmeasured block outside the DOT area (outside SF).
- `map-aggregate` combines several measurements in one cell into one energy-averaged level and count.
- `map-live` shows a measurement added on another phone without any interaction on this one.

## How to get to it (user POV)

- Tap the `Map` tab (the app opens on it).
- Tap `Added to map · View` after saving (see `add-to-map.md`).
- Open `soundmap:///?cell=<h3>`. iOS asks `Open in "soundmap"?`. Accept it with `sm ad press 'label="Open"'`.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`. For the measured sub-features, at least one saved row (run `add-to-map.md` first).
- For `map-live`, a second simulator with the app open on the Map tab against the same Metro.

- **Street noise.** After launch, a screenshot shows colored hexagons across SF before any measurement, with US-101 red.
- **Empty.** With cleared data, `sm ad snapshot -i` shows the hint text and no `dBA`.
- **Modeled block.** At the launch view, run `sm ad press 200 270`. The card shows `52 dBA modeled street noise`. Screenshots before and after show the same camera, plus a dark outline on the tapped block.
- **Below 45.** Zoom in first (use `View`, or the US-101 tap from an older build), then tap a white, uncolored block. The card shows `Below 45 dBA modeled street noise` and `Very quiet`, with an outline.
- **Measured.** After `Added to map · View`, the card shows both lines. Check that `round(laeq)` of the `npx convex data measurements` row equals the first line, and that the cell's value in `assets/street-noise/levels.json` rounds to the DOT line. For cell `8a2830828317fff`, DOT is 57.5, shown as 58.
- **Aggregate.** Measure and add again at the same location. The card shows `· 2 measurements`, and its dBA is the energy average of the two server rows. `npx convex data cells` holds that cell with `count` 2.
- **Live.** With phone B on the Map tab showing the empty hint, add a measurement on phone A. Without touching B, its hint disappears within a few seconds. Open the cell on B (deep link, because the puck covers it) and its card matches A's row.
- **Proof.** Before and after screenshots of each tap, `snapshot -i` text, and `npx convex data` output.

## Gotchas

- Hexagons and the user-location dot have no accessibility elements. Press them by coordinates.
- At launch zoom, the location puck covers the measured Hayes Valley hexagon and swallows taps on it. Select it with `View` or the deep link instead.
- Map tiles come from `tiles.openfreemap.org`, so the basemap needs network. The DOT layer is bundled.
- The location dot shows only once location permission is granted. The Map tab never prompts for it.
- Data is live: a Convex query, not a reload on focus. A phone that was offline catches up when it reconnects.
