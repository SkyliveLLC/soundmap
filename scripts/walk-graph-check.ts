/**
 * Replays q1's 30 San Francisco trips against a walking graph archive and prints what each quiet preset buys.
 * It is the acceptance check for scripts/walk-graph.ts and src/lib/quiet-routes.ts together.
 *
 *   npm run walk-graph-check -- --tiles .walk-graph/walking-<osm>-noise-<ntnm>.pmtiles   (or an https URL)
 *
 * Plans use modeled noise only (measured: null), like q1. On its own graph q1's "quieter" gave a median 2.05 dB
 * for +0.75 % distance, 20/30 trips ≥ 1 dB, 11/30 ≥ 3 dB and none over +25 %; each row shows q1's numbers beside
 * ours. A preset the plan leaves out counts as 0 dB and +0 %: the user is shown the shortest way.
 * Times are node's, a JIT; Hermes on a phone is several times slower (q6).
 */
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PMTiles, type Source } from 'pmtiles';

import type { Bounds, LngLat } from '../src/lib/cells.ts';
import { planWalk, tripArea, type QuietPreset, type WalkPlan } from '../src/lib/quiet-routes.ts';
import { tilePosition } from '../src/lib/street-noise-tiles.ts';
import { WALK_ZOOM, decodeWalkTile, type WalkTile } from '../src/lib/walk-tiles.ts';
import pairs from './walk-graph-check-pairs.json' with { type: 'json' };

const { values } = parseArgs({ options: { tiles: { type: 'string' } } });
if (!values.tiles) {
  console.error('usage: npm run walk-graph-check -- --tiles <archive.pmtiles or https URL>');
  process.exit(1);
}
const archive = new PMTiles(/^https?:\/\//.test(values.tiles) ? values.tiles : await fileSource(values.tiles));
const decoded = new Map<string, WalkTile | null>();

type Gain = { db: number; detourPct: number };
type Row = { id: string; meters: number; ms: number; gains: Record<QuietPreset, Gain> };

const rows: Row[] = [];
let warm = false;
for (const pair of pairs) {
  const from: LngLat = [pair.from[0], pair.from[1]];
  const to: LngLat = [pair.to[0], pair.to[1]];
  const area = tripArea(from, to);
  if (area.kind !== 'area') {
    console.log(`${pair.id}\t${area.kind}`);
    continue;
  }
  const trip = { tiles: await tilesIn(area.bounds), measured: null, from, to };
  // The first plan pays for compiling; time warm plans only.
  if (!warm) {
    planWalk(trip);
    warm = true;
  }
  const started = performance.now();
  const outcome = planWalk(trip);
  const ms = performance.now() - started;
  if (outcome.kind !== 'planned') {
    console.log(`${pair.id}\t${outcome.kind}${outcome.kind === 'off-path' ? ` (${outcome.end})` : ''}`);
    continue;
  }
  const row = { id: pair.id, meters: outcome.plan.shortest.meters, ms, gains: gainsOf(outcome.plan) };
  rows.push(row);
  console.log(
    [
      row.id.padEnd(18),
      `${(row.meters / 1000).toFixed(2)} km`,
      `quieter ${show(row.gains.quieter)} (q1 ${pair.q1QuieterDb.toFixed(2)} dB, +${pair.q1QuieterDetourPct} %)`,
      `quietest ${show(row.gains.quietest)}`,
      `${ms.toFixed(0)} ms`,
    ].join('\t'),
  );
}

console.log(`\n${rows.length}/${pairs.length} trips planned`);
if (rows.length === 0) process.exit(1);
for (const preset of ['quieter', 'quietest'] as const) {
  const gains = rows.map((row) => row.gains[preset]);
  const db = gains.map((gain) => gain.db);
  const detour = gains.map((gain) => gain.detourPct);
  console.log(
    `${preset.padEnd(8)}  median ${median(db).toFixed(2)} dB, +${median(detour).toFixed(2)} % median detour, ` +
      `max +${Math.max(...detour).toFixed(1)} %, ${db.filter((d) => d >= 1).length} ≥ 1 dB, ` +
      `${db.filter((d) => d >= 3).length} ≥ 3 dB`,
  );
}
const times = rows.map((row) => row.ms);
console.log(`planWalk  median ${median(times).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);

function gainsOf(plan: WalkPlan): Record<QuietPreset, Gain> {
  const gain = (preset: QuietPreset): Gain => {
    const choice = plan.choices.find((candidate) => candidate.preset === preset);
    return choice
      ? {
          db: plan.shortest.laeq - choice.route.laeq,
          detourPct: (100 * choice.extraMeters) / plan.shortest.meters,
        }
      : { db: 0, detourPct: 0 };
  };
  return { quieter: gain('quieter'), quietest: gain('quietest') };
}

function show({ db, detourPct }: Gain): string {
  return db === 0 ? 'shortest' : `${db.toFixed(2)} dB, +${detourPct.toFixed(1)} %`;
}

function median(numbers: readonly number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[Math.floor(middle)];
}

/** The archive's tiles overlapping a box, decoded once per run. Tiles the archive lacks are left out. */
async function tilesIn([west, south, east, north]: Bounds): Promise<WalkTile[]> {
  const northWest = tilePosition(north, west, WALK_ZOOM);
  const southEast = tilePosition(south, east, WALK_ZOOM);
  const found: WalkTile[] = [];
  for (let x = northWest.x; x <= southEast.x; x++) {
    for (let y = northWest.y; y <= southEast.y; y++) {
      const key = `${x}/${y}`;
      if (!decoded.has(key)) {
        const response = await archive.getZxy(WALK_ZOOM, x, y);
        decoded.set(key, response ? decodeWalkTile(new Uint8Array(response.data)) : null);
      }
      const tile = decoded.get(key);
      if (tile) found.push(tile);
    }
  }
  return found;
}

/** pmtiles reads local files only through the browser's File; this is the same range read on a file handle. */
async function fileSource(path: string): Promise<Source> {
  const file = await open(path);
  return {
    getKey: () => path,
    getBytes: async (offset, length) => {
      const bytes = new Uint8Array(length);
      const { bytesRead } = await file.read(bytes, 0, length, offset);
      return { data: bytes.buffer.slice(0, bytesRead) };
    },
  };
}
