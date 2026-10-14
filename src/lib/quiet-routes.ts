import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import { energyOf, levelOf } from './acoustics.ts';
import { regionsIn, type Bounds, type CellAggregate, type LngLat } from './cells.ts';
import { loudnessBand } from './loudness.ts';
import { DOT_FLOOR_DB, type CoveredStreetLevel } from './street-noise.ts';
import { EDGE_FLAGS, type WalkBlock, type WalkTile } from './walk-tiles.ts';

/** Longest trip offered, straight line. The graph for it is ~24 z14 tiles and the plan ~0.7 s in Hermes (q6). */
export const MAX_TRIP_METERS = 5_000;
/** Shorter than this, start and end are the same place. */
export const MIN_TRIP_METERS = 100;
/** Walking pace for "x min". */
export const WALK_METERS_PER_MINUTE = 80;
/** At or above this, a stretch counts as "on loud blocks". The scale's "Moderate" ends here too. */
export const LOUD_DB = 65;
/** A quieter route is offered from this many dB quieter (energy average), and called noticeable from NOTICEABLE_DB. */
export const OFFER_DB = 1;
export const NOTICEABLE_DB = 3;

/**
 * The quiet presets the card offers, in display order. λ scales the linear cost len·(1 + λ·max(0, L − 45)/10).
 * A preset runs its λs in order and keeps the first route within its detour cap, so list them largest first:
 * that is the quietest which fits, in ~3 searches per plan (q6). Numbers from the q1 sweep.
 * The route param `quiet` is validated against these keys, so adding a preset is one line here.
 */
export const QUIET_PRESETS = {
  quieter: { label: 'Quieter', lambdas: [0.5], maxDetour: 0.25 },
  quietest: { label: 'Quietest', lambdas: [3, 2, 1], maxDetour: 0.25 },
} as const satisfies Record<string, { label: string; lambdas: readonly number[]; maxDetour: number }>;

export type QuietPreset = keyof typeof QUIET_PRESETS;

// Object.keys can't type its result; these are exactly QUIET_PRESETS' keys, in its order.
const PRESETS = Object.keys(QUIET_PRESETS) as QuietPreset[];

/**
 * What a route knows about one block's loudness. Measured wins over modeled, block by block; the two are never
 * averaged together for a block (README promise). Different blocks of one route may use different sources.
 */
export type BlockLevel = { kind: 'measured'; laeq: number; count: number } | CoveredStreetLevel;

/** A run of the route inside one block, in walking order. The card's line is colored piece by piece. */
export type RoutePiece = { line: readonly [LngLat, LngLat, ...LngLat[]]; meters: number; cell: string; level: BlockLevel };

export type Route = {
  pieces: readonly [RoutePiece, ...RoutePiece[]];
  meters: number;
  /**
   * Length-weighted energy average of the pieces' levels, below-floor counted as DOT_FLOOR_DB: what a meter
   * carried along the route would integrate. Mixes measured and modeled blocks, so the card never calls it a reading.
   */
  laeq: number;
  /** Meters at or above LOUD_DB. */
  loudMeters: number;
  /** Meters whose level is measured rather than modeled. */
  measuredMeters: number;
};

/** One quieter alternative, already compared with the shortest. The card formats these; it computes nothing. */
export type QuietChoice = {
  preset: QuietPreset;
  route: Route;
  /** Math.round(shortest.laeq − route.laeq). Always ≥ OFFER_DB. */
  quieterDb: number;
  /** quieterDb ≥ NOTICEABLE_DB, judged on the rounded number so the badge never contradicts the headline. */
  noticeable: boolean;
  /** Negative when the shortest climbs fewer steps than this route but walks farther (steps cost extra). */
  extraMeters: number;
  /** shortest.loudMeters − route.loudMeters, never negative. 0 when the shortest has no loud stretch. */
  loudMetersAvoided: number;
};

export type WalkPlan = {
  shortest: Route;
  /**
   * In QUIET_PRESETS order. A preset is left out when it found nothing OFFER_DB quieter within its cap, or the
   * same route as the choice before it. Empty means the shortest way is already the quiet one.
   */
  choices: readonly QuietChoice[];
  /** 'unavailable' when measured blocks weren't in hand (loading, offline): every level is then modeled. */
  measured: 'included' | 'unavailable';
};

/** Every way a plan can end. The card has copy for each; nothing throws for an ordinary failure. */
export type PlanOutcome =
  | { kind: 'planned'; plan: WalkPlan }
  /** No graph tiles for this area: outside what the pipeline has built. */
  | { kind: 'no-walking-data' }
  /** An end is more than SNAP_METERS from any walkable way (a lake, a rail yard). */
  | { kind: 'off-path'; end: 'from' | 'to' }
  /** Both ends snap, but no walkable way joins them inside the fetched area, or they snap to the same point. */
  | { kind: 'no-path' };

/** The area a trip needs, decided before anything is fetched. */
export type TripArea =
  | { kind: 'area'; bounds: Bounds; regions: string[] }
  | { kind: 'too-far'; meters: number }
  | { kind: 'too-close' };

/**
 * Box around both ends with a margin of max(300 m, 40 % of the trip) so a detour has room, and the res-5 regions
 * covering it for the measured query. The hook fetches tiles and measurements for exactly this, and planWalk
 * clips the graph to the same box.
 */
export function tripArea(from: LngLat, to: LngLat): TripArea {
  const meters = greatCircleMeters(from, to);
  if (meters > MAX_TRIP_METERS) return { kind: 'too-far', meters };
  if (meters < MIN_TRIP_METERS) return { kind: 'too-close' };
  const bounds = corridor(from, to);
  return { kind: 'area', bounds, regions: regionsIn(bounds) };
}

/**
 * Plans the shortest walk and the quiet presets between two points. Pure and synchronous: 0.69 s for 5 km and
 * 0.38 s for 3 km in Hermes V1 on the emulator (q6), roughly half join, half search. `measured: null` plans on
 * modeled levels alone.
 */
export function planWalk({
  tiles,
  measured,
  from,
  to,
}: {
  tiles: readonly WalkTile[];
  measured: readonly CellAggregate[] | null;
  from: LngLat;
  to: LngLat;
}): PlanOutcome {
  if (tiles.length === 0) return { kind: 'no-walking-data' };
  const graph = joinTiles(tiles, corridor(from, to));
  const levels = blockLevels(graph.blocks, measured);
  const blockDb = Float64Array.from(levels, levelDb);
  const start = snap(graph, from);
  if (!start) return { kind: 'off-path', end: 'from' };
  const end = snap(graph, to);
  if (!end) return { kind: 'off-path', end: 'to' };

  const walkAt = (lambda: number) => {
    const walk = search(graph, costFor(graph, blockDb, lambda), start, end);
    return walk && { walk, route: toRoute(graph, walk, levels) };
  };
  const shortest = walkAt(0);
  if (!shortest) return { kind: 'no-path' };

  const choices: QuietChoice[] = [];
  let previous: Walk | null = null;
  for (const preset of PRESETS) {
    const { lambdas, maxDetour } = QUIET_PRESETS[preset];
    const cap = shortest.route.meters * (1 + maxDetour);
    let found: ReturnType<typeof walkAt> = null;
    for (const lambda of lambdas) {
      const planned = walkAt(lambda);
      if (planned && planned.route.meters <= cap) {
        found = planned;
        break;
      }
    }
    if (!found || shortest.route.laeq - found.route.laeq < OFFER_DB) continue;
    if (previous && sameEdges(previous, found.walk)) continue;
    previous = found.walk;
    choices.push(compare(preset, shortest.route, found.route));
  }
  return {
    kind: 'planned',
    plan: { shortest: shortest.route, choices, measured: measured ? 'included' : 'unavailable' },
  };
}

/** The route line for MapLibre: one feature per piece, colored on the same scale as every hexagon. */
export function routeToGeoJSON(route: Route): FeatureCollection<LineString, { color: string }> {
  return {
    type: 'FeatureCollection',
    features: route.pieces.map(({ line, level }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line.map(([longitude, latitude]) => [longitude, latitude]) },
      // Below the floor means quieter than any modeled level, so it takes the quietest color.
      properties: { color: loudnessBand(level.kind === 'below-floor' ? -Infinity : levelDb(level)).color },
    })),
  };
}

/** Start and end pins. `from` is optional while the card asks for a start. */
export function pinsToGeoJSON({
  from,
  to,
}: {
  from: LngLat | null;
  to: LngLat;
}): FeatureCollection<Point, { end: 'from' | 'to' }> {
  const pin = (end: 'from' | 'to', [longitude, latitude]: LngLat): Feature<Point, { end: 'from' | 'to' }> => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { end },
  });
  return { type: 'FeatureCollection', features: from ? [pin('from', from), pin('to', to)] : [pin('to', to)] };
}

/** Route params carry points as "lng,lat" with 6 decimals (~10 cm). They stay on the phone. */
export function formatLngLat([longitude, latitude]: LngLat): string {
  return `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
}

const DEGREES = /^-?\d{1,3}(\.\d+)?$/;

/** Null for a missing or malformed param, so a stale deep link shows no route instead of crashing. */
export function parseLngLat(param: string | undefined): LngLat | null {
  const parts = param?.split(',');
  if (parts?.length !== 2 || !parts.every((part) => DEGREES.test(part))) return null;
  const [longitude, latitude] = parts.map(Number);
  return Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90 ? [longitude, latitude] : null;
}

/** Null for anything that isn't a preset key. */
export function parseQuietPreset(param: string | undefined): QuietPreset | null {
  return PRESETS.find((preset) => preset === param) ?? null;
}

// ── Internals: not exported. Tests reach them only through planWalk. ──

/** Edges within this of a point can start or end a walk. */
const SNAP_METERS = 150;
/** A snapped point this close to an edge's end is on its node. */
const NODE_METERS = 0.01;
/**
 * Steps cost this many times their length in every preset, shortest included, so stairs aren't free detours.
 * Per meter, not per edge: cutting edges at block boundaries must not multiply the penalty.
 */
const STEPS_FACTOR = 3;
/** Corridor margin around the trip's box. A +25 % detour can bulge 37.5 % of the trip sideways. */
const MARGIN_SHARE = 0.4;
const MIN_MARGIN_METERS = 300;
const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180;
const E7 = 1e7;

/** One plane for the whole graph, so edge lengths, snapping and the A* heuristic agree exactly. */
type Plane = { west: number; south: number; metersPerLng: number; metersPerLat: number };

/**
 * All fetched tiles joined into one CSR graph, clipped to the trip corridor. Nodes are deduplicated across tiles
 * by exact E7 coordinate.
 */
type Graph = {
  plane: Plane;
  /** Degrees, [lng, lat] pairs, for drawing. */
  lngLat: Float64Array;
  /** Meters on `plane`, [x, y] pairs, for snapping and the heuristic. */
  xy: Float64Array;
  /** CSR: arcs of node n are arcStart[n] … arcStart[n+1]; each undirected edge appears as two arcs. */
  arcStart: Int32Array;
  arcTo: Int32Array;
  arcEdge: Int32Array;
  /** Per edge. */
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  meters: Float64Array;
  steps: Uint8Array;
  /** Per edge, index into `blocks`, deduplicated by cell across tiles. */
  edgeBlock: Int32Array;
  blocks: readonly WalkBlock[];
};

function corridor(from: LngLat, to: LngLat): Bounds {
  const margin = Math.max(MIN_MARGIN_METERS, MARGIN_SHARE * greatCircleMeters(from, to));
  const dLat = margin / METERS_PER_DEGREE;
  const dLng = margin / (METERS_PER_DEGREE * Math.cos(toRadians((from[1] + to[1]) / 2)));
  return [
    Math.min(from[0], to[0]) - dLng,
    Math.min(from[1], to[1]) - dLat,
    Math.max(from[0], to[0]) + dLng,
    Math.max(from[1], to[1]) + dLat,
  ];
}

function joinTiles(tiles: readonly WalkTile[], [west, south, east, north]: Bounds): Graph {
  const [westE7, southE7, eastE7, northE7] = [west, south, east, north].map((degrees) => Math.round(degrees * E7));
  const inside = (lngE7: number, latE7: number) =>
    westE7 <= lngE7 && lngE7 <= eastE7 && southE7 <= latE7 && latE7 <= northE7;

  let maxNodes = 0;
  let maxEdges = 0;
  for (const tile of tiles) {
    maxNodes += tile.nodes.length / 2;
    maxEdges += tile.edgeBlock.length;
  }
  const nodeE7 = new Int32Array(2 * maxNodes);
  const edgeFrom = new Int32Array(maxEdges);
  const edgeTo = new Int32Array(maxEdges);
  const edgeBlock = new Int32Array(maxEdges);
  const steps = new Uint8Array(maxEdges);
  const nodeIndex = new Map<number, number>();
  const blockIndex = new Map<string, number>();
  const blocks: WalkBlock[] = [];
  let nodeCount = 0;
  let edgeCount = 0;

  // Both ends are inside the corridor, so each offset is under 2^26 (6.7°) and the key is exact in a double.
  const intern = (lngE7: number, latE7: number) => {
    const key = (lngE7 - westE7) * 2 ** 26 + (latE7 - southE7);
    let node = nodeIndex.get(key);
    if (node === undefined) {
      node = nodeCount++;
      nodeIndex.set(key, node);
      nodeE7[2 * node] = lngE7;
      nodeE7[2 * node + 1] = latE7;
    }
    return node;
  };

  for (const tile of tiles) {
    const tileBlocks = new Int32Array(tile.blocks.length).fill(-1);
    for (let e = 0; e < tile.edgeBlock.length; e++) {
      const a = 2 * tile.edgeNodes[2 * e];
      const b = 2 * tile.edgeNodes[2 * e + 1];
      const [aLng, aLat, bLng, bLat] = [tile.nodes[a], tile.nodes[a + 1], tile.nodes[b], tile.nodes[b + 1]];
      // An edge lies in one block (~150 m at most) and both trip ends are ≥ 300 m inside the box, so dropping
      // the edges that cross its rim never cuts a walk off from either end.
      if (!inside(aLng, aLat) || !inside(bLng, bLat)) continue;
      edgeFrom[edgeCount] = intern(aLng, aLat);
      edgeTo[edgeCount] = intern(bLng, bLat);
      const local = tile.edgeBlock[e];
      if (tileBlocks[local] === -1) {
        const block = tile.blocks[local];
        let index = blockIndex.get(block.cell);
        if (index === undefined) {
          index = blocks.push(block) - 1;
          blockIndex.set(block.cell, index);
        }
        tileBlocks[local] = index;
      }
      edgeBlock[edgeCount] = tileBlocks[local];
      steps[edgeCount] = tile.edgeFlags[e] & EDGE_FLAGS.steps;
      edgeCount++;
    }
  }

  const plane: Plane = {
    west,
    south,
    metersPerLng: METERS_PER_DEGREE * Math.cos(toRadians((south + north) / 2)),
    metersPerLat: METERS_PER_DEGREE,
  };
  const lngLat = new Float64Array(2 * nodeCount);
  const xy = new Float64Array(2 * nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    lngLat[2 * n] = nodeE7[2 * n] / E7;
    lngLat[2 * n + 1] = nodeE7[2 * n + 1] / E7;
    [xy[2 * n], xy[2 * n + 1]] = project(plane, lngLat[2 * n], lngLat[2 * n + 1]);
  }

  const meters = new Float64Array(edgeCount);
  const arcStart = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeFrom[e];
    const b = edgeTo[e];
    meters[e] = Math.hypot(xy[2 * b] - xy[2 * a], xy[2 * b + 1] - xy[2 * a + 1]);
    arcStart[a + 1]++;
    arcStart[b + 1]++;
  }
  for (let n = 0; n < nodeCount; n++) arcStart[n + 1] += arcStart[n];
  const arcTo = new Int32Array(2 * edgeCount);
  const arcEdge = new Int32Array(2 * edgeCount);
  const fill = arcStart.slice(0, nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    const a = edgeFrom[e];
    const b = edgeTo[e];
    arcTo[fill[a]] = b;
    arcEdge[fill[a]++] = e;
    arcTo[fill[b]] = a;
    arcEdge[fill[b]++] = e;
  }

  return {
    plane,
    lngLat,
    xy,
    arcStart,
    arcTo,
    arcEdge,
    edgeFrom: edgeFrom.subarray(0, edgeCount),
    edgeTo: edgeTo.subarray(0, edgeCount),
    meters,
    steps: steps.subarray(0, edgeCount),
    edgeBlock: edgeBlock.subarray(0, edgeCount),
    blocks,
  };
}

/** Per block: measured (any count ≥ 1) else the baked modeled level. */
function blockLevels(blocks: readonly WalkBlock[], measured: readonly CellAggregate[] | null): BlockLevel[] {
  const byCell = new Map(measured?.map((aggregate) => [aggregate.cell, aggregate] as const));
  return blocks.map(({ cell, street }): BlockLevel => {
    const aggregate = byCell.get(cell);
    return aggregate ? { kind: 'measured', laeq: aggregate.laeq, count: aggregate.count } : street;
  });
}

/** The dB that costs and metrics use. Below the floor counts as the floor: for metrics an upper bound, which shrinks gains. */
function levelDb(level: BlockLevel): number {
  switch (level.kind) {
    case 'measured':
      return level.laeq;
    case 'modeled':
      return level.laeq24h;
    case 'below-floor':
      return DOT_FLOOR_DB;
  }
}

function costFor(graph: Graph, blockDb: Float64Array, lambda: number): Float64Array {
  const { meters, edgeBlock, steps } = graph;
  const cost = new Float64Array(meters.length);
  for (let e = 0; e < meters.length; e++) {
    const loudness = Math.max(0, blockDb[edgeBlock[e]] - DOT_FLOOR_DB) / 10;
    cost[e] = meters[e] * (1 + lambda * loudness) * (steps[e] ? STEPS_FACTOR : 1);
  }
  return cost;
}

/** A point on an edge, as the fraction along it from edgeFrom. */
type Snap = { edge: number; along: number };

/** Nearest point on any edge. Linear scan: two calls per plan. */
function snap(graph: Graph, point: LngLat): Snap | null {
  const { xy, edgeFrom, edgeTo } = graph;
  const [px, py] = project(graph.plane, point[0], point[1]);
  let nearest: Snap | null = null;
  let nearestSquared = SNAP_METERS ** 2;
  for (let e = 0; e < edgeFrom.length; e++) {
    const ax = xy[2 * edgeFrom[e]];
    const ay = xy[2 * edgeFrom[e] + 1];
    const dx = xy[2 * edgeTo[e]] - ax;
    const dy = xy[2 * edgeTo[e] + 1] - ay;
    const lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
    const distanceSquared = (ax + along * dx - px) ** 2 + (ay + along * dy - py) ** 2;
    if (distanceSquared <= nearestSquared) {
      nearestSquared = distanceSquared;
      nearest = { edge: e, along };
    }
  }
  if (!nearest) return null;
  // Rounding leaves a point on a node at 1 − ε of one of its edges; without this the walk ends in a sliver piece.
  const length = graph.meters[nearest.edge];
  if (nearest.along * length < NODE_METERS) return { edge: nearest.edge, along: 0 };
  if ((1 - nearest.along) * length < NODE_METERS) return { edge: nearest.edge, along: 1 };
  return nearest;
}

/** Part of one edge, walked from fraction `start` to `end` (0 is edgeFrom): 0 → 1 walks it forward. */
type Stretch = { edge: number; start: number; end: number };
/** A route through the graph in walking order. The first and last stretch may be partial. */
type Walk = readonly [Stretch, ...Stretch[]];

/**
 * A* from one snapped point to the other, with a binary heap and a straight-line heuristic: every cost is at least
 * the edge's length, so it never overestimates for any λ. The target is a virtual node reached from either end of
 * its edge; a trip inside one edge is a direct candidate too.
 */
function search(graph: Graph, cost: Float64Array, from: Snap, to: Snap): Walk | null {
  const { xy, arcStart, arcTo, arcEdge, edgeFrom, edgeTo } = graph;
  const nodeCount = arcStart.length - 1;
  const [tx, ty] = pointOnPlane(graph, to);
  const reached = new Float64Array(nodeCount).fill(Infinity);
  // The edge each node was reached by; -1 for the two ends of the start edge.
  const via = new Int32Array(nodeCount).fill(-1);
  const settled = new Uint8Array(nodeCount);

  // Each settled node pushes at most once per arc, so the heap never outgrows arcs plus the two seeds.
  const heapKey = new Float64Array(arcTo.length + 2);
  const heapNode = new Int32Array(arcTo.length + 2);
  let heapSize = 0;
  const push = (key: number, node: number) => {
    let i = heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKey[parent] <= key) break;
      heapKey[i] = heapKey[parent];
      heapNode[i] = heapNode[parent];
      i = parent;
    }
    heapKey[i] = key;
    heapNode[i] = node;
  };
  const pop = () => {
    const node = heapNode[0];
    const key = heapKey[--heapSize];
    const last = heapNode[heapSize];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= heapSize) break;
      if (child + 1 < heapSize && heapKey[child + 1] < heapKey[child]) child++;
      if (heapKey[child] >= key) break;
      heapKey[i] = heapKey[child];
      heapNode[i] = heapNode[child];
      i = child;
    }
    heapKey[i] = key;
    heapNode[i] = last;
    return node;
  };
  const reach = (node: number, total: number, edge: number) => {
    if (total >= reached[node]) return;
    reached[node] = total;
    via[node] = edge;
    push(total + Math.hypot(xy[2 * node] - tx, xy[2 * node + 1] - ty), node);
  };

  reach(edgeFrom[from.edge], cost[from.edge] * from.along, -1);
  reach(edgeTo[from.edge], cost[from.edge] * (1 - from.along), -1);
  let best = from.edge === to.edge ? cost[to.edge] * Math.abs(to.along - from.along) : Infinity;
  // The node the walk leaves the graph from onto the target edge; -1 while the best walk stays inside one edge.
  let exit = -1;

  while (heapSize > 0 && heapKey[0] < best) {
    const node = pop();
    if (settled[node]) continue;
    settled[node] = 1;
    if (node === edgeFrom[to.edge] && reached[node] + cost[to.edge] * to.along < best) {
      best = reached[node] + cost[to.edge] * to.along;
      exit = node;
    }
    if (node === edgeTo[to.edge] && reached[node] + cost[to.edge] * (1 - to.along) < best) {
      best = reached[node] + cost[to.edge] * (1 - to.along);
      exit = node;
    }
    for (let arc = arcStart[node]; arc < arcStart[node + 1]; arc++) {
      if (!settled[arcTo[arc]]) reach(arcTo[arc], reached[node] + cost[arcEdge[arc]], arcEdge[arc]);
    }
  }
  if (best === Infinity) return null;
  if (exit === -1) return walkOf([{ edge: from.edge, start: from.along, end: to.along }]);

  const backwards: Stretch[] = [{ edge: to.edge, start: exit === edgeFrom[to.edge] ? 0 : 1, end: to.along }];
  let node = exit;
  while (via[node] !== -1) {
    const edge = via[node];
    const forward = edgeTo[edge] === node;
    backwards.push({ edge, start: forward ? 0 : 1, end: forward ? 1 : 0 });
    node = forward ? edgeFrom[edge] : edgeTo[edge];
  }
  backwards.push({ edge: from.edge, start: from.along, end: node === edgeFrom[from.edge] ? 0 : 1 });
  return walkOf(backwards.reverse());
}

/** Drops zero-length stretches (an end snapped onto a node). Null when nothing is left to walk. */
function walkOf(stretches: readonly Stretch[]): Walk | null {
  const [first, ...rest] = stretches.filter(({ start, end }) => start !== end);
  return first ? [first, ...rest] : null;
}

function sameEdges(a: Walk, b: Walk): boolean {
  return a.length === b.length && a.every((stretch, i) => stretch.edge === b[i].edge);
}

/** Merges consecutive stretches in one block into one piece, then measures the pieces. */
function toRoute(graph: Graph, [first, ...rest]: Walk, levels: readonly BlockLevel[]): Route {
  type Draft = { line: [LngLat, LngLat, ...LngLat[]]; meters: number; cell: string; level: BlockLevel };
  const draft = ({ edge, start, end }: Stretch): Draft => {
    const block = graph.edgeBlock[edge];
    return {
      line: [pointAt(graph, edge, start), pointAt(graph, edge, end)],
      meters: Math.abs(end - start) * graph.meters[edge],
      cell: graph.blocks[block].cell,
      level: levels[block],
    };
  };
  const pieces: [Draft, ...Draft[]] = [draft(first)];
  for (const stretch of rest) {
    const next = draft(stretch);
    const last = pieces[pieces.length - 1];
    if (last.cell === next.cell) {
      last.line.push(next.line[1]);
      last.meters += next.meters;
    } else {
      pieces.push(next);
    }
  }

  let meters = 0;
  let energy = 0;
  let loudMeters = 0;
  let measuredMeters = 0;
  for (const piece of pieces) {
    const db = levelDb(piece.level);
    meters += piece.meters;
    energy += piece.meters * energyOf(db);
    if (db >= LOUD_DB) loudMeters += piece.meters;
    if (piece.level.kind === 'measured') measuredMeters += piece.meters;
  }
  return { pieces, meters, laeq: levelOf(energy / meters), loudMeters, measuredMeters };
}

function compare(preset: QuietPreset, shortest: Route, route: Route): QuietChoice {
  const quieterDb = Math.round(shortest.laeq - route.laeq);
  return {
    preset,
    route,
    quieterDb,
    noticeable: quieterDb >= NOTICEABLE_DB,
    extraMeters: route.meters - shortest.meters,
    loudMetersAvoided: Math.max(0, shortest.loudMeters - route.loudMeters),
  };
}

function pointAt(graph: Graph, edge: number, along: number): LngLat {
  const a = 2 * graph.edgeFrom[edge];
  const b = 2 * graph.edgeTo[edge];
  const { lngLat } = graph;
  return [lngLat[a] + along * (lngLat[b] - lngLat[a]), lngLat[a + 1] + along * (lngLat[b + 1] - lngLat[a + 1])];
}

function pointOnPlane(graph: Graph, { edge, along }: Snap): [x: number, y: number] {
  const a = 2 * graph.edgeFrom[edge];
  const b = 2 * graph.edgeTo[edge];
  const { xy } = graph;
  return [xy[a] + along * (xy[b] - xy[a]), xy[a + 1] + along * (xy[b + 1] - xy[a + 1])];
}

function project(plane: Plane, longitude: number, latitude: number): [x: number, y: number] {
  return [(longitude - plane.west) * plane.metersPerLng, (latitude - plane.south) * plane.metersPerLat];
}

function greatCircleMeters([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const a =
    Math.sin(toRadians(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(toRadians(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
