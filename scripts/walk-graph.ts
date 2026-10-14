/**
 * Builds the walking graph archive from OpenStreetMap extracts and the street noise blocks.
 *
 *   1. Download OSM extracts, such as https://download.geofabrik.de/north-america/us/california-latest.osm.pbf.
 *   2. brew install osmium-tool pmtiles coreutils
 *   3. npm run walk-graph -- --release 2026-10 --osm california-latest.osm.pbf [--osm ...] \
 *        --blocks .street-noise/blocks.tsv
 *
 * Stages, all streaming through sorted files in --out (default .walk-graph/), so memory stays bounded at any
 * extract size:
 *   1. osmium keeps ways with a walkable highway tag and, of their nodes, those inside the 50 states and DC
 *      that NTNM models, out to state waters so piers stay whole (states-waters.geojson, fetched once). It
 *      writes each way with its node locations, one per line. A first pass over them lists every node's level,
 *      so nodes on different levels can be moved apart.
 *   2. Every segment of a walkable way is cut where it crosses into the next block (splitAtBlocks).
 *   3. sort -u drops the pieces two overlapping extracts both hold, then join with blocks.tsv bakes in each
 *      block's modeled level. A block missing from blocks.tsv has no DOT pixels: below the floor.
 *   4. Pieces grouped by z14 tile become walk tiles (encodeWalkTile) in an MBTiles file, which `pmtiles
 *      convert` turns into walking-<release>-noise-<NTNM release>.pmtiles with the tile bytes unchanged.
 * The guards below fail the build before the archive is written.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

import { cellAt } from '../src/lib/cells.ts';
import { STREET_NOISE_RELEASE } from '../src/lib/street-noise.ts';
import {
  EDGE_FLAGS,
  WALK_ZOOM,
  bakedLevel,
  decodeWalkTile,
  encodeWalkTile,
  splitAtBlocks,
  walkTileKey,
  type LngLatE7,
  type WalkBlock,
} from '../src/lib/walk-tiles.ts';
import { coverageGeometry } from './coverage.ts';

/** OSM highway values a person may walk on. Motorways and their links are excluded. */
const WALKABLE_HIGHWAYS: ReadonlySet<string> = new Set([
  'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'track', 'road',
  'footway', 'path', 'steps', 'corridor', 'cycleway', 'bridleway',
]);

// Guards. A wrong or truncated extract, or a blocks.tsv from somewhere else, falls far below these. California
// (2026-10) has 96.6 % of nodes in its largest component and 33.9 % of its length in modeled blocks.
const MIN_LARGEST_COMPONENT = 0.95;
const MIN_MODELED_SHARE = 0.05;

const { values } = parseArgs({
  options: {
    osm: { type: 'string', multiple: true, default: [] },
    blocks: { type: 'string' },
    release: { type: 'string' },
    out: { type: 'string', default: '.walk-graph' },
  },
});
if (!values.release || !values.blocks || values.osm.length === 0) {
  console.error('usage: npm run walk-graph -- --release <OSM snapshot> --osm <extract.osm.pbf>... --blocks <blocks.tsv>');
  process.exit(1);
}
const release = values.release;
const blocks = values.blocks;
const out = values.out;
const file = (name: string) => join(out, name);
await mkdir(out, { recursive: true });
// Both passes append once per extract, so a crashed run's output must go first.
await Promise.all(['pieces.unsorted', 'points.unsorted'].map((name) => rm(file(name), { force: true })));
const started = Date.now();
const log = (message: string) => console.log(`${((Date.now() - started) / 60_000).toFixed(1)} min  ${message}`);
const failures: string[] = [];
const sortCommand = gnuTool('sort');
const joinCommand = gnuTool('join');

const coverage = await coverageFile();
const extracts: string[] = [];
for (const [i, osm] of values.osm.entries()) extracts.push(await coveredWalkable(osm, coverage, i));
for (const extract of extracts) await listPoints(extract);
await sortFile(file('points.unsorted'), file('points.tsv'), ['-u']);
const moved = await separateLevels(file('points.tsv'));
for (const extract of extracts) await cutWays(extract, moved);
await Promise.all(extracts.map((extract) => rm(extract)));
await sortFile(file('pieces.unsorted'), file('pieces.tsv'), ['-u']);
await joinLevels(file('pieces.tsv'), file('pieces-by-tile.tsv'));
const components = await writeTiles(file('pieces-by-tile.tsv'), file('walk.mbtiles'));
await sortFile(file('nodes.unsorted'), file('nodes.tsv'), []);
await checkComponents(file('nodes.tsv'), components);

if (failures.length > 0) {
  for (const failure of failures) console.error(`guard failed: ${failure}`);
  process.exit(1);
}
const archive = file(`walking-${release}-noise-${STREET_NOISE_RELEASE}.pmtiles`);
await succeeded(spawn('pmtiles', ['convert', file('walk.mbtiles'), archive], { stdio: 'inherit' }));
await rm(file('walk.mbtiles'));
log(`wrote ${archive}`);

/** The 50 states and DC out to their waters, as a GeoJSON feature for osmium, fetched once per --out. */
async function coverageFile(): Promise<string> {
  const path = file('states-waters.geojson');
  if (!existsSync(path)) {
    const feature = { type: 'Feature', geometry: await coverageGeometry('waters'), properties: {} };
    await writeFile(`${path}.tmp`, JSON.stringify(feature));
    await rename(`${path}.tmp`, path);
  }
  return path;
}

/**
 * Stage 1: an extract's ways with a walkable highway tag, with their nodes, then only their nodes inside the
 * states. A way that crosses the border keeps its nodes on this side; the segment over it has no location on
 * the far end and is dropped. Each osmium step reads its input twice, so the first writes a file.
 */
async function coveredWalkable(osm: string, coverage: string, index: number): Promise<string> {
  const highways = file(`highways-${index}.osm.pbf`);
  const output = file(`walkable-${index}.osm.pbf`);
  const filter = ['tags-filter', osm, `w/highway=${[...WALKABLE_HIGHWAYS].join(',')}`, '-O', '-o', highways];
  await succeeded(spawn('osmium', filter, { stdio: 'inherit' }));
  const extract = ['extract', '--strategy', 'simple', '--polygon', coverage, highways, '-O', '-o', output];
  await succeeded(spawn('osmium', extract, { stdio: 'inherit' }));
  await rm(highways);
  log(`cut ${osm} to the states`);
  return output;
}

/** An extract's walkable ways, each with its node locations. */
async function* walkableWays(extract: string): AsyncGenerator<Way> {
  const locate = spawn(
    'osmium',
    ['add-locations-to-ways', '--ignore-missing-nodes', extract, '-f', 'opl,add_metadata=false', '-o', '-'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const exited = succeeded(locate);
  for await (const line of createInterface({ input: locate.stdout })) {
    if (!line.startsWith('w')) continue;
    const way = parseWay(line);
    if (walkable(way.tags)) yield way;
  }
  await exited;
}

/** Appends every node of an extract's walkable ways, with its way's level, for separateLevels. */
async function listPoints(extract: string): Promise<void> {
  const points = createWriteStream(file('points.unsorted'), { flags: 'a' });
  for await (const way of walkableWays(extract)) {
    const level = levelOf(way.tags);
    let lines = '';
    for (const { id, at } of way.nodes) if (at) lines += `${at.join(',')}\t${id}\t${level}\n`;
    await write(points, lines);
  }
  await close(points);
  log(`listed the nodes of ${extract}`);
}

/**
 * Tiles join nodes by E7 coordinate, so distinct OSM nodes at one point on different levels (a bridge over a
 * street) would become a junction nobody can walk. All but the lowest id move 1e-7° north each, about a
 * centimeter. Distinct nodes at one point on one level stay joined: a duplicate node mappers meant to connect.
 */
async function separateLevels(pointsFile: string): Promise<ReadonlyMap<string, LngLatE7>> {
  const moved = new Map<string, LngLatE7>();
  let shared = 0;
  for await (const { key, rows } of runs(pointsFile, 0)) {
    const ids = [...new Set(rows.map(([, id]) => id))];
    if (ids.length < 2) continue;
    shared++;
    if (new Set(rows.map(([, , level]) => level)).size < 2) continue;
    const [lng, lat] = key.split(',').map(Number);
    ids.sort((a, b) => Number(a) - Number(b));
    ids.slice(1).forEach((id, i) => moved.set(id, [lng, lat + i + 1]));
  }
  await rm(pointsFile);
  log(`${shared} points shared by distinct OSM nodes; moved ${moved.size} nodes on another level off them`);
  return moved;
}

/** Stage 2 for one extract: appends its pieces. */
async function cutWays(extract: string, moved: ReadonlyMap<string, LngLatE7>): Promise<void> {
  const pieces = createWriteStream(file('pieces.unsorted'), { flags: 'a' });
  let ways = 0;
  let segments = 0;
  let cuts = 0;
  for await (const way of walkableWays(extract)) {
    const flags = way.tags.highway === 'steps' ? EDGE_FLAGS.steps : 0;
    const points = way.nodes.map(({ id, at }) => moved.get(id) ?? at);
    let lines = '';
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
      // One direction per segment, so a segment two ways or two extracts share cuts identically and dedupes.
      const [from, to] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
      const split = splitAtBlocks(from, to);
      for (const piece of split) {
        lines += `${piece.cell}\t${walkTileKey(piece.from)}\t${piece.from.join(',')}\t${piece.to.join(',')}\t${flags}\n`;
      }
      segments++;
      cuts += split.length - 1;
    }
    await write(pieces, lines);
    if (++ways % 500_000 === 0) log(`${ways / 1_000_000}M walkable ways`);
  }
  await close(pieces);
  log(`${extract}: ${ways} walkable ways, ${segments} segments, ${cuts} cuts at block boundaries`);
}

type Way = { tags: Readonly<Record<string, string>>; nodes: { id: string; at: LngLatE7 | null }[] };

/** One way from `osmium add-locations-to-ways -f opl`: `w<id> T<k>=<v>,... Nn<id>x<lng>y<lat>,...`. */
function parseWay(line: string): Way {
  const [, tagField, nodeField] = line.split(' ');
  const tags: Record<string, string> = {};
  for (const pair of tagField.slice(1).split(',')) {
    const [key, value] = pair.split('=').map(unescapeOpl);
    if (key) tags[key] = value;
  }
  const nodes = nodeField
    .slice(1)
    .split(',')
    .map((ref) => {
      const [, id, lng, lat] = /^n(\d+)x(-?[\d.]*)y(-?[\d.]*)$/.exec(ref) ?? [];
      // A node outside the extract has no location.
      const at: LngLatE7 | null = lng && lat ? [Math.round(Number(lng) * 1e7), Math.round(Number(lat) * 1e7)] : null;
      return { id, at };
    });
  return { tags, nodes };
}

function unescapeOpl(text: string): string {
  return text.replace(/%([0-9a-f]+)%/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** Whether a way's tags allow walking: a walkable highway, not foot=no, not access=no/private unless foot says yes. */
function walkable(tags: Readonly<Record<string, string>>): boolean {
  if (!WALKABLE_HIGHWAYS.has(tags.highway)) return false;
  // use_sidepath: a separately mapped sidewalk carries the walkers.
  if (tags.foot === 'no' || tags.foot === 'use_sidepath') return false;
  if (tags.access === 'no' || tags.access === 'private') return ['yes', 'designated', 'permissive'].includes(tags.foot);
  return true;
}

/** Vertical level for separateLevels. A bridge or tunnel without a `layer` tag still sits off the ground. */
function levelOf(tags: Readonly<Record<string, string>>): number {
  const layer = Number(tags.layer);
  if (tags.layer && Number.isInteger(layer)) return layer;
  if (tags.bridge && tags.bridge !== 'no') return 1;
  if (tags.tunnel && tags.tunnel !== 'no') return -1;
  return 0;
}

/** Stage 3: appends each piece's modeled level from blocks.tsv, then orders pieces by tile. */
async function joinLevels(piecesFile: string, output: string): Promise<void> {
  const env = { ...process.env, LC_ALL: 'C' };
  const joined = spawn(joinCommand, ['-t', '\t', '-a', '1', '--check-order', piecesFile, blocks], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env,
  });
  const sort = spawn(sortCommand, [...sortOptions(), '-t', '\t', '-k2,2', '-o', `${output}.tmp`], {
    stdio: [joined.stdout, 'inherit', 'inherit'],
    env,
  });
  await Promise.all([succeeded(joined), succeeded(sort)]);
  await rename(`${output}.tmp`, output);
  await rm(piecesFile);
  log('joined modeled levels');
}

/**
 * Stage 4: one walk tile per run of pieces, checked by decoding it again, into MBTiles. Writes each tile's nodes
 * with a component id local to the tile, so checkComponents can join components across tiles without holding
 * the whole graph.
 */
async function writeTiles(piecesFile: string, mbtiles: string): Promise<number> {
  await rm(mbtiles, { force: true });
  const db = new DatabaseSync(mbtiles);
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    BEGIN;
  `);
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  const nodesOut = createWriteStream(file('nodes.unsorted'));
  const tileBytes: number[] = [];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let components = 0;
  let edges = 0;
  let spanning = 0;
  let meters = 0;
  let modeledMeters = 0;

  for await (const { key, rows } of runs(piecesFile, 1)) {
    const nodeIndex = new Map<string, number>();
    const blockIndex = new Map<string, number>();
    const blockList: WalkBlock[] = [];
    const edgeNodes: number[] = [];
    const edgeBlock: number[] = [];
    const edgeFlags: number[] = [];
    for (const [cell, , from, to, flags, laeq] of rows) {
      for (const at of [from, to]) {
        let node = nodeIndex.get(at);
        if (node === undefined) nodeIndex.set(at, (node = nodeIndex.size));
        edgeNodes.push(node);
      }
      let block = blockIndex.get(cell);
      if (block === undefined) {
        blockIndex.set(cell, (block = blockList.length));
        blockList.push({ cell, street: bakedLevel(laeq === undefined ? null : Number(laeq)) });
      }
      edgeBlock.push(block);
      edgeFlags.push(Number(flags));
    }
    const bytes = encodeWalkTile({
      nodes: Int32Array.from([...nodeIndex.keys()].flatMap((at) => at.split(',').map(Number))),
      edgeNodes: Uint32Array.from(edgeNodes),
      edgeBlock: Uint16Array.from(edgeBlock),
      edgeFlags: Uint8Array.from(edgeFlags),
      blocks: blockList,
    });

    const tile = decodeWalkTile(bytes);
    const parent = Int32Array.from({ length: nodeIndex.size }, (_, i) => i);
    const root = (node: number): number => {
      while (parent[node] !== node) node = parent[node] = parent[parent[node]];
      return node;
    };
    for (let edge = 0; edge < tile.edgeBlock.length; edge++) {
      const [a, b] = [tile.edgeNodes[2 * edge], tile.edgeNodes[2 * edge + 1]];
      const from: LngLatE7 = [tile.nodes[2 * a], tile.nodes[2 * a + 1]];
      const to: LngLatE7 = [tile.nodes[2 * b], tile.nodes[2 * b + 1]];
      const { cell, street } = tile.blocks[tile.edgeBlock[edge]];
      // Guard: the edge still lies in the block splitAtBlocks gave it, after sorting, joining and encoding. Not a
      // re-split: where a way grazes a block edge, rounding its cut to E7 can move the crossing by meters.
      if (cellAt((from[1] + to[1]) / 2e7, (from[0] + to[0]) / 2e7) !== cell) spanning++;
      const length = metersBetween(from, to);
      meters += length;
      if (street.kind === 'modeled') modeledMeters += length;
      parent[root(a)] = root(b);
      bounds[0] = Math.min(bounds[0], from[0], to[0]);
      bounds[1] = Math.min(bounds[1], from[1], to[1]);
      bounds[2] = Math.max(bounds[2], from[0], to[0]);
      bounds[3] = Math.max(bounds[3], from[1], to[1]);
    }
    const local = new Map<number, number>();
    let lines = '';
    for (const [at, node] of nodeIndex) {
      const component = root(node);
      if (!local.has(component)) local.set(component, components + local.size);
      lines += `${at}\t${local.get(component)}\n`;
    }
    components += local.size;
    await write(nodesOut, lines);

    const [x, y] = key.split('/').map(Number);
    insert.run(WALK_ZOOM, x, 2 ** WALK_ZOOM - 1 - y, bytes);
    tileBytes.push(bytes.byteLength);
    edges += edgeBlock.length;
    if (tileBytes.length % 10_000 === 0) log(`${tileBytes.length} tiles`);
  }
  await close(nodesOut);

  const [west, south, east, north] = bounds.map((value) => value / 1e7);
  const metadata = {
    name: 'Soundmap walking graph',
    description: `Walkable OpenStreetMap ways (${release}) cut at H3 blocks, with US DOT NTNM ${STREET_NOISE_RELEASE} levels`,
    attribution: '© OpenStreetMap contributors; US DOT BTS National Transportation Noise Map',
    // Not a known tile format: pmtiles keeps the bytes as they are, uncompressed.
    format: 'bin',
    minzoom: String(WALK_ZOOM),
    maxzoom: String(WALK_ZOOM),
    bounds: [west, south, east, north].join(','),
    center: [(west + east) / 2, (south + north) / 2, WALK_ZOOM].join(','),
  };
  const setMetadata = db.prepare('INSERT INTO metadata VALUES (?, ?)');
  for (const [name, value] of Object.entries(metadata)) setMetadata.run(name, value);
  db.exec('COMMIT');
  db.close();
  await rm(piecesFile);

  const sorted = tileBytes.toSorted((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  const total = sorted.reduce((sum, bytes) => sum + bytes, 0);
  log(
    `${sorted.length} tiles, ${edges} edges, ${(total / 1e6).toFixed(1)} MB of tiles; ` +
      `bytes per tile median ${at(0.5)}, p95 ${at(0.95)}, max ${sorted.at(-1)}`,
  );
  const modeledShare = modeledMeters / meters;
  log(`${(meters / 1000).toFixed(0)} km of edges, ${(100 * modeledShare).toFixed(1)} % of it in modeled blocks`);
  if (spanning > 0) failures.push(`${spanning} edges lie outside their block`);
  if (modeledShare < MIN_MODELED_SHARE) {
    failures.push(`only ${(100 * modeledShare).toFixed(1)} % of the graph is in modeled blocks: is --blocks for this area?`);
  }
  return components;
}

/**
 * Guard: most of the graph must be one walkable network. Components are local to a tile; a node in several
 * tiles merges theirs, which the sorted nodes file puts next to each other.
 */
async function checkComponents(nodesFile: string, components: number): Promise<void> {
  const parent = Int32Array.from({ length: components }, (_, i) => i);
  const size = new Float64Array(components);
  const root = (component: number): number => {
    while (parent[component] !== component) component = parent[component] = parent[parent[component]];
    return component;
  };
  let nodes = 0;
  for await (const { rows } of runs(nodesFile, 0)) {
    const [first, ...others] = rows.map(([, component]) => Number(component));
    nodes++;
    size[first]++;
    for (const other of others) parent[root(other)] = root(first);
  }
  await rm(nodesFile);
  const sizes = new Map<number, number>();
  for (let component = 0; component < components; component++) {
    const top = root(component);
    sizes.set(top, (sizes.get(top) ?? 0) + size[component]);
  }
  const largest = Math.max(...sizes.values());
  const share = largest / nodes;
  log(`${nodes} nodes in ${sizes.size} components, ${(100 * share).toFixed(2)} % in the largest`);
  if (share < MIN_LARGEST_COMPONENT) failures.push(`only ${(100 * share).toFixed(2)} % of nodes are in the largest component`);
}

/** Runs of consecutive rows of a sorted tab-separated file that agree on one field. */
async function* runs(path: string, field: number): AsyncGenerator<{ key: string; rows: string[][] }> {
  let rows: string[][] = [];
  for await (const line of createInterface({ input: createReadStream(path) })) {
    const row = line.split('\t');
    if (rows.length > 0 && rows[0][field] !== row[field]) {
      yield { key: rows[0][field], rows };
      rows = [];
    }
    rows.push(row);
  }
  if (rows.length > 0) yield { key: rows[0][field], rows };
}

/** Equirectangular, as the phone measures edges. */
function metersBetween(a: LngLatE7, b: LngLatE7): number {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2e7) * (Math.PI / 180));
  return Math.hypot(dx, a[1] - b[1]) * ((6_371_008.8 * Math.PI) / 180 / 1e7);
}

/**
 * GNU sort and join under whichever name this system gives them. uutils sort 0.8.0 (Ubuntu's `sort`) splits
 * lines, and the BSD tools on macOS lack the options used here.
 */
function gnuTool(name: string): string {
  const command = [`gnu${name}`, `g${name}`, name].find(
    (candidate) => spawnSync(candidate, ['--version'], { encoding: 'utf8' }).stdout?.includes('GNU coreutils'),
  );
  if (!command) throw new Error(`walk-graph needs GNU ${name}: brew install coreutils`);
  return command;
}

function sortOptions(): string[] {
  return ['-S', '25%', `--parallel=${availableParallelism()}`, '-T', out];
}

async function sortFile(input: string, output: string, options: string[]): Promise<void> {
  const sort = spawn(sortCommand, [...sortOptions(), ...options, '-o', `${output}.tmp`, input], {
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C' },
  });
  await succeeded(sort);
  await rename(`${output}.tmp`, output);
  await rm(input);
  log(`sorted ${output}`);
}

async function write(stream: WriteStream, text: string): Promise<void> {
  if (text && !stream.write(text)) await once(stream, 'drain');
}

async function close(stream: WriteStream): Promise<void> {
  stream.end();
  await once(stream, 'finish');
}

function succeeded(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited with ${code}`))));
  });
}
