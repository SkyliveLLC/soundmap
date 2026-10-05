# Add to map

After a measurement finishes, "Add to map" asks for location, saves the summary at the H3 cell (about one city block) around the user, and turns into "Added to map · View", which opens the Map tab focused on that cell. Only the cell is stored, never coordinates.

## Sub-features

- `add-save` saves one row and shows `Added to map · View`.
- `add-view` opens the Map tab, flies to the saved cell, and shows its card.
- `add-denied` shows the location-off message with `Open Settings`, and saves nothing.
- `add-privacy` stores the H3 cell and noise numbers only, with no latitude or longitude.

## How to get to it (user POV)

- Finish a measurement (see `measure.md`), then tap `Add to map` on the summary.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`, with the summary screen showing (`Measure again` visible).
- Simulated location set to `37.7763 -122.4232`. Location permission is `reset` (to test the prompt) or `grant`ed.

- **Add.** Run `sm tap "Add to map"`. On first run, `Allow “soundmap” to use your location?` appears with three buttons. Run `sm ad press 'label="Allow While Using App"'`. Run `sm ad wait text "Added to map · View" 20000`.
- **Side effect.** Run `sm db`. Exactly one new row has `cell` `8a2830828317fff` (for the coordinates above), `duration_sec` 30.0, and `laeq` whose rounding equals the summary's big number. The schema has no latitude or longitude column. Prove `add-privacy` with `sm db "PRAGMA table_info(measurements)"`.
- **View.** Run `sm tap "Added to map · View"`. The Map tab is selected. `snapshot -i` shows `<round(laeq)> dBA average` and `<band> · 1 measurement`, and a screenshot shows a hexagon in the band color at the map center.
- **Denied.** From a fresh summary, run `sm ad settings permission deny location`, then `sm tap "Add to map"`. The screen shows `Location is off for Soundmap, so this measurement was not added to the map.` and `Open Settings`. `sm db` shows no new row.
- **Proof.** Save a screenshot of `Added to map · View`, the `sm db` output, and the map screenshot with its card.

## Gotchas

- `sm ad alert accept` fails on the location prompt ("accept button not found") because it has three buttons. Press the button by label.
- If location was never set, the simulator may have no fix and the save ends in `Could not add this measurement to the map.` Set it before tapping.
- Saving twice from the same summary is possible (the button becomes `Added to map · View` and does not re-save). Re-measure to add a second row.
- `View` puts `?cell=` in the Map route.
