/**
 * Builds the street noise tiles from the US DOT National Transportation Noise Map (NTNM) all-modes layers.
 *
 *   1. In a browser, download the "Aviation, Rail, and Road Noise" zips for CONUS and Alaska, and
 *      "Hawaii Aviation and Road Noise" (Hawaii has no rail layer), from
 *      https://www.bts.gov/geospatial/national-transportation-noise-map and unzip them. Akamai blocks curl.
 *   2. brew install gdal tippecanoe
 *   3. npm run street-noise -- --release 2022 \
 *        --raster OpenFileGDB:<CONUS gdb>:<layer> --raster OpenFileGDB:<Alaska gdb>:<layer> ...
 *      CONUS is one raster per state, so it takes one --raster per state layer (`gdalinfo <gdb>` lists
 *      them as subdatasets). A window on a state line reads both states' rasters.
 *
 * Two stages, both in --out (default .street-noise/):
 *   blocks.tsv                     every block (H3 res 10) with DOT pixels, `cell<TAB>laeq`, sorted.
 *                                  Hours for the whole US, so --blocks <file> reuses one instead of --raster.
 *   street-noise-<release>.pmtiles blocks, the coarser areas that stand in for them when zoomed out,
 *                                  and the modeled area (50 states and DC, from the Census Bureau).
 * Then upload the .pmtiles (see README) and bump STREET_NOISE_RELEASE / STREET_NOISE_TILES.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { CELL_RESOLUTION } from '../src/lib/cells.ts';
import {
  BLOCK_ZOOM,
  COVERAGE_LAYER,
  NOISE_LAYER,
  NOISE_ZOOMS,
  type Footprint,
  areaLevels,
  boxesAround,
  noiseFeature,
  windowsOver,
} from '../src/lib/street-noise.ts';
import { coverageGeometry } from './coverage.ts';

const { values } = parseArgs({
  options: {
    raster: { type: 'string', multiple: true, default: [] },
    blocks: { type: 'string' },
    release: { type: 'string' },
    out: { type: 'string', default: '.street-noise' },
    jobs: { type: 'string', default: String(Math.max(1, availableParallelism() - 1)) },
  },
});
if (!values.release || (values.raster.length === 0) === !values.blocks) {
  console.error('usage: npm run street-noise -- --release <year> (--raster <GDAL raster>... | --blocks <blocks.tsv>)');
  process.exit(1);
}
const release = values.release;
await mkdir(values.out, { recursive: true });

const blocks = values.blocks ?? (await buildBlocks(values.raster, join(values.out, 'blocks.tsv')));
const tiles = join(values.out, `street-noise-${release}.pmtiles`);
await buildTiles(blocks, tiles);
console.log(`wrote ${tiles}`);

/** Runs scripts/street-noise-window.ts over the 1° grid cells any raster reaches, then sorts the blocks by index. */
async function buildBlocks(rasters: string[], file: string): Promise<string> {
  const windows = windowsOver(await Promise.all(rasters.map(footprintOf)));
  console.log(`${windows.length} windows over ${rasters.length} rasters`);
  const unsorted = `${file}.unsorted`;
  const output = await open(unsorted, 'w');
  const started = Date.now();
  let done = 0;
  try {
    await runAll(windows, Number(values.jobs), async ({ bounds, rasters }) => {
      const child = spawn(
        process.execPath,
        [
          join(import.meta.dirname, 'street-noise-window.ts'),
          ...rasters.flatMap((raster) => ['--raster', raster]),
          // `=` because western longitudes start with a dash, which would read as an option.
          `--window=${bounds.join(',')}`,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      const chunks: Buffer[] = [];
      for await (const chunk of child.stdout) chunks.push(chunk);
      await succeeded(child);
      // One write per window, so windows finishing together never interleave their lines.
      await output.write(Buffer.concat(chunks));
      done++;
      const minutes = (Date.now() - started) / 60_000;
      console.log(`${done}/${windows.length} windows, ${minutes.toFixed(1)} min, ~${((minutes / done) * (windows.length - done)).toFixed(0)} min left`);
    });
  } finally {
    await output.close();
  }
  const sort = spawn('sort', ['-T', values.out, '-o', `${file}.sorted`, unsorted], {
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C' },
  });
  await succeeded(sort);
  await rename(`${file}.sorted`, file);
  await rm(unsorted);
  return file;
}

/** Streams the coverage, every block and every area into tippecanoe, which writes one PMTiles archive. */
async function buildTiles(blocksFile: string, file: string): Promise<void> {
  const tippecanoe = spawn(
    'tippecanoe',
    [
      ...['-o', file, '--force', '--quiet', '-t', values.out, '-l', NOISE_LAYER],
      ...['-Z', String(NOISE_ZOOMS[0].minzoom), '-z', String(BLOCK_ZOOM)],
      // Every hexagon is drawn exactly, at every zoom it belongs to.
      ...['--no-feature-limit', '--no-tile-size-limit', '--no-tiny-polygon-reduction', '--no-line-simplification'],
      ...['-n', 'Soundmap street noise', '-N', `US DOT NTNM ${release} road, rail and aviation noise on H3 hexagons`],
      ...['-A', `US DOT BTS National Transportation Noise Map ${release}`],
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const finished = succeeded(tippecanoe);
  const write = async (line: string) => {
    if (!tippecanoe.stdin.write(`${line}\n`)) await once(tippecanoe.stdin, 'drain');
  };

  await write(await coverageFeature());
  let count = 0;
  async function* writtenBlocks(): AsyncGenerator<[string, number]> {
    let previous = '';
    for await (const line of createInterface({ input: createReadStream(blocksFile) })) {
      const [cell, level] = line.split('\t');
      const laeq = Number(level);
      if (cell.length !== 15 || !Number.isFinite(laeq)) throw new Error(`blocks: bad line "${line}"`);
      // Each window owns the blocks centered in it, so a repeat is a bug in the grid.
      if (cell <= previous) throw new Error(`blocks: ${cell} is ${cell === previous ? 'repeated' : 'out of order'}`);
      previous = cell;
      await write(noiseFeature(cell, laeq));
      if (++count % 1_000_000 === 0) console.log(`${count / 1_000_000}M blocks`);
      yield [cell, laeq];
    }
  }
  for await (const [cell, laeq] of areaLevels(writtenBlocks())) await write(noiseFeature(cell, laeq));
  tippecanoe.stdin.end();
  await finished;
  console.log(`${count} blocks at resolution ${CELL_RESOLUTION}`);
}

/** The modeled area as one feature, in block tiles only: the app reads it on a tap. */
async function coverageFeature(): Promise<string> {
  return JSON.stringify({
    type: 'Feature',
    tippecanoe: { layer: COVERAGE_LAYER, minzoom: BLOCK_ZOOM, maxzoom: BLOCK_ZOOM },
    geometry: await coverageGeometry('shoreline'),
    properties: {},
  });
}

/**
 * The raster's edge in lng/lat, sampled every 1/64 of each side rather than at the corners: the
 * rasters are Albers grids, so an edge is an arc (Alaska's top edge rises 4° between its corners,
 * and its northwest corner is past 180°).
 */
async function footprintOf(raster: string): Promise<Footprint> {
  const [width, height]: [number, number] = JSON.parse(await output('gdalinfo', ['-json', raster])).size;
  const along = Array.from({ length: 64 }, (_, i) => i / 64);
  const edge = [
    ...along.map((t) => [t * width, 0]),
    ...along.map((t) => [width, t * height]),
    ...along.map((t) => [(1 - t) * width, height]),
    ...along.map((t) => [0, (1 - t) * height]),
  ];
  // With the raster as its source, gdaltransform takes pixel/line coordinates.
  const lngLat = await output(
    'gdaltransform',
    ['-t_srs', 'EPSG:4326', '-output_xy', raster],
    edge.map((point) => point.join(' ')).join('\n'),
  );
  const ring = lngLat.trim().split('\n').map((line) => line.split(' ').map(Number) as [number, number]);
  return { raster, boxes: boxesAround(ring) };
}

/** Runs a command to completion and returns its stdout. */
async function output(command: string, args: string[], input?: string): Promise<string> {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.end(input);
  const chunks: Buffer[] = [];
  for await (const chunk of child.stdout) chunks.push(chunk);
  await succeeded(child);
  return Buffer.concat(chunks).toString();
}

async function runAll<T>(items: T[], jobs: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
    }),
  );
}

function succeeded(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited with ${code}`));
    // Callers read stdout first, and a child can exit before its output drains: then `exit` has already fired.
    if (child.exitCode !== null || child.signalCode !== null) return settle(child.exitCode);
    child.on('error', reject);
    child.on('exit', settle);
  });
}
