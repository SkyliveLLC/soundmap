#!/usr/bin/env bash
# Renders every icon and splash image in app.json from assets/brand/mark.svg, a hexagon (one map block) with a
# waveform cut out of it. Needs ImageMagick 7: brew install imagemagick.
set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='#4F7360'
CREAM='#F3F0E8'
MARK=assets/brand/mark.svg
# Leaves out the timestamp chunks, so rerunning the script changes no image that did not change.
PNG=(-define png:exclude-chunks=date,time)
OUT=assets/images

# mark <color> <size> <out>: the mark alone, recolored, on a transparent square.
mark() {
  sed "s/#000000/$1/" "$MARK" | magick -background none -density 96 svg:- -resize "$2x$2" -depth 8 "${PNG[@]}" "$3"
}

mark "$CREAM" 1024 /tmp/soundmap-mark-cream.png
magick -size 1024x1024 "xc:$GREEN" /tmp/soundmap-mark-cream.png -composite -depth 8 "${PNG[@]}" "$OUT/icon.png"
# Android masks adaptive layers to the middle 66 %, so the foreground and monochrome marks sit smaller.
mark "$CREAM" 340 png:- | magick - -background none -gravity center -extent 512x512 "${PNG[@]}" "$OUT/android-icon-foreground.png"
mark '#FFFFFF' 290 png:- | magick - -background none -gravity center -extent 432x432 "${PNG[@]}" "$OUT/android-icon-monochrome.png"
mark "$GREEN" 200 "$OUT/splash-icon.png"
magick "$OUT/icon.png" -resize 48x48 "${PNG[@]}" "$OUT/favicon.png"
sed "s/#000000/$CREAM/" "$MARK" > assets/expo.icon/Assets/mark.svg
