# Venues

After "Add to map", the app asks the server for cafés, libraries and coworking spaces around the block (`venueSearch:nearby`, which asks OpenStreetMap's Overpass and saves the result per block). If any come back within 6 s, it shows `Were you at one of these? Its hour by hour loudness gets your reading.` with one row per venue and `Not at any of these`. Picking one saves the reading to that venue's local hour, and the button becomes `Added to <name> · View`. Measured venues show on the Map tab as dots in their band color. Tapping a dot, or `View`, opens a card with the venue's average, a 24-bar chart by hour of day, the current hour, and the quietest hour.

## Sub-features

- `venue-question` lists nearby venues, nearest first, as `<name>, <kind>` rows (`Café`, `Library`, `Coworking space`).
- `venue-skip` saves the reading without a venue when the search fails, is slow, or finds nothing, or when `Not at any of these` is tapped.
- `venue-save` adds the reading to the venue's hour: `npx convex data venues` holds the venue with `count` 1 at the current local hour.
- `venue-card` shows `<name>`, `<kind> · <N> dBA average · <count> measurement(s)`, the chart (`Loudness by hour. <hour> <N> dBA, …`), `Now, <hour>: <N> dBA · <band>` or `Nobody has measured at <hour> yet`, and `Quietest at <hour> · <N> dBA`.
- `venue-dot-tap` opens the venue card instead of the block under the dot. A later block tap shows the block card. Neither moves the camera.
- `venue-aggregate` energy-averages repeat readings at the same venue and hour.
- `venue-cache` answers a block's second search from `npx convex data venueSearches`, without asking Overpass.

## How to get to it (user POV)

- Finish a measurement, tap `Add to map`, then pick a venue (see `add-to-map.md` for the steps before).
- `Added to <name> · View`, or a tap on a venue dot on the Map tab.
- `soundmap:///?venue=<osmId>`, for example `node/123`.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`, with location granted and set to `37.7763 -122.4232` (Hayes Valley, which has several cafés in OpenStreetMap).

- **Question.** Run `sm tap "Add to map"`, then `sleep 8` and `sm ad snapshot -i`. Rows show as `[cell] "<name>, Café"`. If `Added to map · View` shows instead, the search failed. Check `npx convex logs` for `[venueSearch] Overpass search failed`, then measure and add again. Once a search for this block succeeds, later ones come from `venueSearches` and always show the question.
- **Save.** Run `sm tap "<name>, Café"`. Expect `Added to <name> · View`. `npx convex data venues` has the venue with one reading at the current hour, and `10*log10(energy)` rounds to the summary's big number.
- **Card.** Run `sm tap "Added to <name> · View"`. `snapshot -i` shows the `venue-card` lines.
- **Dot tap.** Move the simulated location a few blocks away first (`sm ad settings location set 37.7800 -122.4300`), because the location puck covers the venue dot. Tap an empty block, such as `sm ad press 300 200`, to get a block card. Then tap the dot, about `(201, 395)` after `View`, to get the venue card back. Screenshots before and after show the same camera. Set the location back before measuring again.
- **Proof.** Screenshots of the question, the saved button and the card. `npx convex data venues`, `npx convex data venueSearches`, and `npx convex run venues:list`.

## Gotchas

- The public Overpass server is often overloaded and answers 504 after 7–14 s, past the phone's 6 s wait. The server still saves a late result, so the next reading in that block gets the question.
- `dev:resetMap` keeps `venueSearches`. It is a cache of OpenStreetMap, not map data. To test a first search, delete the block's row in the dashboard.
- Venue dots are map features with no accessibility element. Press them by coordinates.
- `View` puts `?venue=` in the Map route and clears `?cell=`.
