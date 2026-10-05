/**
 * Rebuilds assets/street-noise/ from the US DOT National Transportation Noise Map (NTNM) road layer.
 *
 *   1. In a browser, download CONUS_road_noise_<year>.zip from
 *      https://www.bts.gov/geospatial/national-transportation-noise-map and unzip it. Akamai blocks curl.
 *   2. brew install gdal    # needs the OpenFileGDB raster driver
 *   3. npm run street-noise -- --gdb ~/Downloads/CONUS_road_noise_2024/CONUS_road_noise.gdb --release 2024
 *
 * Options: --layer (default CA_road_noise), --extent w,s,e,n (default San Francisco), --out (default assets/street-noise).
 * Writes levels.json and cells.geojson. The output is deterministic, so rerunning on the same input changes nothing.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { loudnessBand } from '../src/lib/loudness.ts';
import {
  aggregatePixels,
  parsePixelLine,
  parseStreetNoise,
  serializeCells,
  serializeLevels,
  type Extent,
  type Pixel,
} from '../src/lib/street-noise.ts';

const { values } = parseArgs({
  options: {
    gdb: { type: 'string' },
    release: { type: 'string' },
    layer: { type: 'string', default: 'CA_road_noise' },
    extent: { type: 'string', default: '-122.53,37.70,-122.35,37.84' },
    out: { type: 'string', default: 'assets/street-noise' },
  },
});
if (!values.gdb || !values.release) {
  console.error('usage: npm run street-noise -- --gdb <CONUS_road_noise.gdb> --release <year>');
  process.exit(1);
}
const [west, south, east, north] = values.extent.split(',').map(Number);
const extent: Extent = [west, south, east, north];

// Clip in the raster's own Albers grid so pixels are never resampled, then convert each pixel
// center to lng/lat. gdaltransform passes the third column (dB) through untouched.
const translate = spawn(
  'gdal_translate',
  [
    ...['-q', '-projwin_srs', 'EPSG:4326', '-projwin', ...[west, north, east, south].map(String)],
    ...['-of', 'XYZ', `OpenFileGDB:${values.gdb}:${values.layer}`, '/vsistdout/'],
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const transform = spawn('gdaltransform', ['-s_srs', 'ESRI:102039', '-t_srs', 'EPSG:4326'], {
  stdio: [translate.stdout, 'pipe', 'inherit'],
});
const finished = Promise.all([succeeded(translate), succeeded(transform)]);

const pixels: Pixel[] = [];
for await (const line of createInterface({ input: transform.stdout })) {
  const pixel = parsePixelLine(line);
  if (pixel) pixels.push(pixel);
}
await finished;

const noise = aggregatePixels(pixels, { release: values.release, extent });
const levels = serializeLevels(noise);
// The app's own parse, so a bad build fails here instead of on launch.
const written = parseStreetNoise(JSON.parse(levels));

await mkdir(values.out, { recursive: true });
const staging = await mkdtemp(join(values.out, '.build-'));
try {
  await writeFile(join(staging, 'levels.json'), levels);
  await writeFile(join(staging, 'cells.geojson'), serializeCells(noise));
  await rename(join(staging, 'levels.json'), join(values.out, 'levels.json'));
  await rename(join(staging, 'cells.geojson'), join(values.out, 'cells.geojson'));
} finally {
  await rm(staging, { recursive: true, force: true });
}

const ascending = [...written.levels.values()].sort((a, b) => a - b);
const bands = Map.groupBy(ascending, (laeq) => loudnessBand(laeq).label);
console.log(`${pixels.length} pixels -> ${written.levels.size} cells`);
for (const [label, laeqs] of bands) console.log(`  ${label}: ${laeqs.length}`);

function succeeded(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited with ${code}`))));
  });
}
