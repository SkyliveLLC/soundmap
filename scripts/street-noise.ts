/**
 * Builds the street noise tiles from the US DOT National Transportation Noise Map (NTNM) road layers.
 *
 *   1. In a browser, download the CONUS, Alaska and Hawaii road noise zips from
 *      https://www.bts.gov/geospatial/national-transportation-noise-map and unzip them. Akamai blocks curl.
 *   2. brew install gdal tippecanoe
 *   3. npm run street-noise -- --release 2022 \
 *        --raster OpenFileGDB:<CONUS gdb>:<layer> --raster OpenFileGDB:<Alaska gdb>:<layer> ...
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

import { CELL_RESOLUTION, type Bounds } from '../src/lib/cells.ts';
import {
  BLOCK_ZOOM,
  COVERAGE_LAYER,
  NOISE_LAYER,
  NOISE_ZOOMS,
  areaLevels,
  noiseFeature,
} from '../src/lib/street-noise.ts';

// 50 states and DC (FIPS 1-56; territories start at 60): what NTNM models.
const STATES = 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip';
const WINDOW_DEG = 1;

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

/** Runs scripts/street-noise-window.ts over a 1° grid of every raster, then sorts the blocks by index. */
async function buildBlocks(rasters: string[], file: string): Promise<string> {
  const windows = (await Promise.all(rasters.map(async (raster) => gridOver(await extentOf(raster), raster)))).flat();
  const unsorted = `${file}.unsorted`;
  const output = await open(unsorted, 'w');
  const started = Date.now();
  let done = 0;
  try {
    await runAll(windows, Number(values.jobs), async ({ raster, window }) => {
      const child = spawn(
        process.execPath,
        // `=` because western longitudes start with a dash, which would read as an option.
        [join(import.meta.dirname, 'street-noise-window.ts'), '--raster', raster, `--window=${window.join(',')}`],
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
      ...['-n', 'Soundmap street noise', '-N', `US DOT NTNM ${release} road noise on H3 hexagons`],
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
      // Windows own disjoint blocks, so a repeat means two rasters overlap.
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

/** The 50 states and DC dissolved into one feature, in block tiles only: the app reads it on a tap. */
async function coverageFeature(): Promise<string> {
  const layer = STATES.split('/').at(-1)!.replace('.zip', '');
  const ogr = spawn(
    'ogr2ogr',
    [
      ...['-f', 'GeoJSONSeq', '/vsistdout/', `/vsizip//vsicurl/${STATES}`, '-dialect', 'sqlite'],
      ...['-sql', `SELECT ST_Union(geometry) AS geometry FROM ${layer} WHERE CAST(STATEFP AS INTEGER) <= 56`],
      ...['-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6'],
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const chunks: Buffer[] = [];
  for await (const chunk of ogr.stdout) chunks.push(chunk);
  await succeeded(ogr);
  const { geometry } = JSON.parse(Buffer.concat(chunks).toString().replace(/^\x1e/, ''));
  return JSON.stringify({
    type: 'Feature',
    tippecanoe: { layer: COVERAGE_LAYER, minzoom: BLOCK_ZOOM, maxzoom: BLOCK_ZOOM },
    geometry,
    properties: {},
  });
}

async function extentOf(raster: string): Promise<Bounds> {
  const info = spawn('gdalinfo', ['-json', raster], { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks: Buffer[] = [];
  for await (const chunk of info.stdout) chunks.push(chunk);
  await succeeded(info);
  const { wgs84Extent } = JSON.parse(Buffer.concat(chunks).toString());
  const ring: [number, number][] = wgs84Extent.coordinates[0];
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function gridOver([west, south, east, north]: Bounds, raster: string): { raster: string; window: Bounds }[] {
  const windows: { raster: string; window: Bounds }[] = [];
  for (let lng = Math.floor(west); lng < east; lng += WINDOW_DEG) {
    for (let lat = Math.floor(south); lat < north; lat += WINDOW_DEG) {
      windows.push({ raster, window: [lng, lat, lng + WINDOW_DEG, lat + WINDOW_DEG] });
    }
  }
  return windows;
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
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited with ${code}`))));
  });
}
