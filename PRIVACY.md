# Soundmap privacy policy

Last updated: November 15, 2026

Soundmap is a shared map of how loud places are. This page says what the app collects, why, and who sees it.

## What the app collects

- **Sound levels, not audio.** The app listens to the microphone only while you run a measurement. It turns the sound into a few numbers on the phone: the average level, the background level, the loud moments and the peak. Audio is never recorded, stored or sent.
- **The block a measurement was taken in.** When you choose to add a measurement to the map, the app sends the map block it was taken in (an H3 hexagon about 130 m across) and the time. It never sends your exact position.
- **The phone model.** Each measurement carries the phone model and the microphone calibration it used, because phone microphones differ.
- **A venue, if you name one.** If you say you were in a café, library or coworking space, the measurement carries that place's OpenStreetMap id and the hour of day.
- **An anonymous id.** There are no accounts. When the app first opens it signs in as an anonymous user: a random id with no name, email or phone number. Measurements you add are stored with it, so we can recognize a retried upload, limit how often one phone can add measurements, and delete your readings when you ask. On iPhone the id is kept in the keychain, so it can survive deleting and reinstalling the app.

The app uses your location when you add a measurement, plan a walk from where you are, or tap the button that shows where you are, and, once you've allowed it, to open the map where you are and show your position on it. Your exact position stays on the phone. Planning a quiet walk happens on the phone too: your start and end never leave it.

## What the app downloads

To draw the map, the app downloads map tiles and the shared measurements for the area on screen, starting when it opens. Like any web server, each server it downloads from sees your IP address and which map areas you look at. Our backend does not store which areas you looked at.

## Who sees it

- **Everyone using Soundmap** sees per-block and per-venue averages and counts, and each venue's average by hour of day. Nobody else sees who measured, on which day, or from which phone.
- **Our backend**, hosted by [Convex](https://www.convex.dev), stores each measurement with the data above.
- **OpenFreeMap** serves the base map.
- **Cloudflare** serves the street noise and walking map tiles.
- **OpenStreetMap.** To list venues near a block, our server asks OpenStreetMap's Overpass service. Your phone never contacts it.

Soundmap has no ads, no analytics and no tracking. It does not sell or share data with anyone else.

## Keeping and deleting data

Measurements are kept so the map stays useful, until you delete them. To delete every reading this phone added, open **About** in the app and tap **Delete my readings**. They come off the map and out of our database straight away. A measurement that has not uploaded yet waits on the phone and is deleted then too, or when you uninstall the app.

## Children

Soundmap is not directed at children under 13.

## Changes and contact

We will update this page when the app's data use changes. Questions go to [GitHub issues](https://github.com/SkyliveLLC/soundmap/issues).
