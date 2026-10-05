# Measure noise

The Measure tab records 30 seconds of A-weighted sound level, shows a live dBA readout with a progress bar, and ends on a summary: the average (LAeq) as the big number, plus Loud moments (L10), Background (L90), Peak (LAmax) and Spikiness (L10 − L90). Nothing is saved until the user chooses "Add to map".

## Sub-features

- `measure-start` starts a session from idle and shows `Listening · N of 30 s`.
- `measure-done` ends after 30 s on the summary with four stat tiles and `Measure again`.
- `measure-cancel` stops a running session and returns to idle.
- `measure-denied` shows the microphone-off message with `Open Settings` and `Try again`.
- `measure-again` starts a fresh session from the summary.

## How to get to it (user POV)

- Tap the `Measure` tab, then `Start measuring`.
- From a finished summary, tap `Measure again`.
- From the denied or failed state, tap `Try again`.

## Driving it with agent-device

Preconditions:

- Baseline state from `README.md`. The microphone permission is `reset` (to test the prompt) or `grant`ed.

- **Open the tab.** Run `sm ad press 'label="Measure, tab, 2 of 2"' --settle`. The diff shows `Soundmap`, `UNCALIBRATED`, `—`, `dBA`, and `Start measuring`.
- **Start.** Run `sm tap "Start measuring"`. On first run, a `Allow “soundmap” to access your microphone?` prompt appears. Run `sm ad alert accept`. Within 2 s, `snapshot -i` shows a numeric readout, `Listening · N of 30 s`, and `Cancel`.
- **Finish.** Run `sm ad wait text "Measure again" 45000`. `snapshot -i` shows `Average (LAeq) over 30 s`, `Loud moments`, `Background`, `Peak`, `Spikiness`, and `Add to map`. On the simulator, LAeq is typically 55 to 62 and Background about 52.
- **Cancel.** Start again, then run `sm tap "Cancel"` before 30 s. The screen returns to `—` and `Start measuring`, and `sm db` shows no new row.
- **Denied.** Run `sm ad settings permission deny microphone` (or tap `Don’t Allow` on the prompt), then `sm tap "Start measuring"`. The screen shows `Soundmap needs the microphone to measure noise…`, `Open Settings`, and `Try again`.
- **Proof.** Save `snapshot -i` and a screenshot of `measuring` and `done`. Check the Spikiness tile against `L10 − L90` from the other two tiles.

## Gotchas

- Every in-screen control is `[covered]` to `agent-device`. Use `sm tap`, not a label press.
- `sm ad alert get` says "alert not found" while the mic prompt is up. `alert accept` still works.
- The session is counted in audio frames, not timer time. Waiting a fixed 30 s with `sleep` can be short. Wait for `Measure again`.
- The `no-input` failure ("No microphone is available on this device.") cannot be produced on the simulator.
