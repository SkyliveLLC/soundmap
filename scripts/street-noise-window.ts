/**
 * Street noise blocks for one window of one NTNM raster, as `cell<TAB>laeq` lines on stdout.
 * scripts/street-noise.ts runs one of these per window, in parallel.
 *
 *   node scripts/street-noise-window.ts --raster <GDAL raster> --window=w,s,e,n
 *
 * Writes only the blocks centered in the window, so windows that tile a raster write each block once.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import type { Bounds } from '../src/lib/cells.ts';
import { aggregatePixels, parsePixelLine, type Pixel } from '../src/lib/street-noise.ts';

// Wider than a block's radius at any US latitude, so edge blocks see all of their pixels.
const MARGIN_DEG = 0.01;

const { values } = parseArgs({ options: { raster: { type: 'string' }, window: { type: 'string' } } });
if (!values.raster || !values.window) {
  console.error('usage: node scripts/street-noise-window.ts --raster <GDAL raster> --window=w,s,e,n');
  process.exit(1);
}
const [west, south, east, north] = values.window.split(',').map(Number);
const window: Bounds = [west, south, east, north];

// Clip in the raster's own grid so pixels are never resampled, drop NoData (3.4e38) before the slow
// per-point reprojection, then convert each pixel center to lng/lat. gdaltransform passes dB through.
const clip = [west - MARGIN_DEG, north + MARGIN_DEG, east + MARGIN_DEG, south - MARGIN_DEG].map(String);
const translate = spawn(
  'gdal_translate',
  ['-q', '-projwin_srs', 'EPSG:4326', '-projwin', ...clip, '-of', 'XYZ', values.raster, '/vsistdout/'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
const valid = spawn('grep', ['-v', 'e+38'], { stdio: [translate.stdout, 'pipe', 'inherit'] });
const transform = spawn('gdaltransform', ['-t_srs', 'EPSG:4326', '-s_srs', await sourceSrs(values.raster)], {
  stdio: [valid.stdout, 'pipe', 'inherit'],
});
// grep exits 1 when every pixel was NoData: an empty window, not a failure.
const finished = Promise.all([succeeded(translate), succeeded(valid, [0, 1]), succeeded(transform)]);

const pixels: Pixel[] = [];
for await (const line of createInterface({ input: transform.stdout })) {
  const pixel = parsePixelLine(line);
  if (pixel) pixels.push(pixel);
}
await finished;

const lines = Array.from(aggregatePixels(pixels, window), ([cell, laeq]) => `${cell}\t${laeq}\n`);
process.stdout.write(lines.join(''));

/** The raster's CRS as WKT, so each raster (CONUS, Alaska, Hawaii) reprojects from its own grid. */
async function sourceSrs(raster: string): Promise<string> {
  const info = spawn('gdalsrsinfo', ['-o', 'wkt1', raster], { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks: Buffer[] = [];
  for await (const chunk of info.stdout) chunks.push(chunk);
  await succeeded(info);
  return Buffer.concat(chunks).toString().trim();
}

function succeeded(child: ChildProcess, codes = [0]): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code !== null && codes.includes(code) ? resolve() : reject(new Error(`${child.spawnfile} exited with ${code}`)),
    );
  });
}
