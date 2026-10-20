# Soundmap privacy policy

Last updated: October 20, 2026

Soundmap is a shared map of how loud places are. This page says what the app collects, why, and who sees it.

## What the app collects

- **Sound levels, not audio.** The app listens to the microphone only while you run a measurement. It turns the sound into a few numbers on the phone: the average level, the background level, the loud moments and the peak. Audio is never recorded, stored or sent.
- **An approximate location.** When you add a measurement to the map, the app sends the map block it was taken in (an H3 hexagon about one city block across), never your exact position. Planning a quiet walk happens on the phone, and your start and end never leave it.
- **The phone model.** Each measurement carries the phone model and the microphone calibration it used, because phone microphones differ.
- **A venue, if you name one.** If you say you were in a café, library or coworking space, the measurement carries that place's OpenStreetMap id and the hour of day.
- **An anonymous id.** There are no accounts. Each install signs in as an anonymous user, which the app uses to recognize a retried upload and to limit how often one install can add measurements.

The app sends nothing until you choose to add a measurement to the map.

## Who sees it

- **Everyone using Soundmap** sees only per-block and per-venue averages and counts. Nobody else sees who measured, or when.
- **Our backend**, hosted by [Convex](https://www.convex.dev), stores each measurement with the data above.
- **Cloudflare** serves the map's street noise and walking tiles. Like any web server, it sees your IP address and which map areas the app downloads.
- **OpenStreetMap.** To list venues near a block, our server asks OpenStreetMap's Overpass service. Your phone never contacts it.

Soundmap has no ads and no analytics, and it does not sell or share data with anyone else.

## Keeping and deleting data

Measurements are kept so the map stays useful. A measurement that has not uploaded yet waits on the phone and is gone if you uninstall the app. Because there are no accounts, we can't tell which measurements are yours. If you want something removed, open an issue on [GitHub](https://github.com/SkyliveLLC/soundmap/issues) with the block and the time, and we will remove it.

## Children

Soundmap is not directed at children under 13.

## Changes and contact

We will update this page when the app's data use changes. Questions go to [GitHub issues](https://github.com/SkyliveLLC/soundmap/issues).
