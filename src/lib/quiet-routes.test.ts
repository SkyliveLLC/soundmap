/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LngLat } from './cells.ts';
import {
  formatLngLat,
  parseLngLat,
  parseQuietPreset,
  pinsToGeoJSON,
  planWalk,
  routeToGeoJSON,
  tripArea,
  type Route,
  type WalkPlan,
} from './quiet-routes.ts';
import type { CoveredStreetLevel } from './street-noise.ts';
import { EDGE_FLAGS, type WalkBlock, type WalkTile } from './walk-tiles.ts';

const ORIGIN: LngLat = [-122.42, 37.77];
const METERS_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;

/** The point `x` meters east and `y` meters north of ORIGIN. */
function at(x: number, y: number): LngLat {
  const [longitude, latitude] = ORIGIN;
  return [
    longitude + x / (METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)),
    latitude + y / METERS_PER_DEGREE,
  ];
}

const modeled = (laeq24h: number): CoveredStreetLevel => ({ kind: 'modeled', laeq24h });
const BELOW_FLOOR: CoveredStreetLevel = { kind: 'below-floor' };

/** A polyline of [x, y] meters inside one block. */
type Street = { cell: string; street: CoveredStreetLevel; points: readonly (readonly [number, number])[]; steps?: true };

/**
 * A tile holding these streets, built the way decodeWalkTile hands them over: E7 nodes shared by equal coordinates,
 * and edges at most 100 m long, as cutting at blocks makes them.
 */
function tile(...streets: Street[]): WalkTile {
  const nodes: number[] = [];
  const nodeIndex = new Map<string, number>();
  const blocks: WalkBlock[] = [];
  const edgeNodes: number[] = [];
  const edgeBlock: number[] = [];
  const edgeFlags: number[] = [];
  const node = ([x, y]: readonly [number, number]) => {
    const e7 = at(x, y).map((degrees) => Math.round(degrees * 1e7));
    const key = e7.join();
    if (!nodeIndex.has(key)) nodeIndex.set(key, nodes.push(...e7) / 2 - 1);
    return nodeIndex.get(key)!;
  };
  for (const { cell, street, points, steps } of streets) {
    let block = blocks.findIndex((existing) => existing.cell === cell);
    if (block === -1) block = blocks.push({ cell, street }) - 1;
    for (let i = 1; i < points.length; i++) {
      const [[x0, y0], [x1, y1]] = [points[i - 1], points[i]];
      const cuts = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 100);
      for (let cut = 1; cut <= cuts; cut++) {
        const point = (t: number) => [x0 + t * (x1 - x0), y0 + t * (y1 - y0)] as const;
        edgeNodes.push(node(point((cut - 1) / cuts)), node(point(cut / cuts)));
        edgeBlock.push(block);
        edgeFlags.push(steps ? EDGE_FLAGS.steps : 0);
      }
    }
  }
  return {
    nodes: Int32Array.from(nodes),
    edgeNodes: Uint32Array.from(edgeNodes),
    edgeBlock: Uint16Array.from(edgeBlock),
    edgeFlags: Uint8Array.from(edgeFlags),
    blocks,
  };
}

/** A 1 km main street with a side street 100 m north, joined by a link at each end. Links match the side street. */
function ladder(main: CoveredStreetLevel, side: CoveredStreetLevel): WalkTile {
  return tile(
    { cell: 'main', street: main, points: [[0, 0], [1000, 0]] },
    { cell: 'west', street: side, points: [[0, 0], [0, 100]] },
    { cell: 'side', street: side, points: [[0, 100], [1000, 100]] },
    { cell: 'east', street: side, points: [[1000, 100], [1000, 0]] },
  );
}

function planned(trip: Parameters<typeof planWalk>[0]): WalkPlan {
  const outcome = planWalk(trip);
  if (outcome.kind !== 'planned') assert.fail(`expected a plan, got ${outcome.kind}`);
  return outcome.plan;
}

function summary(route: Route) {
  return {
    meters: Math.round(route.meters),
    laeq: Math.round(route.laeq * 10) / 10,
    cells: route.pieces.map((piece) => piece.cell),
  };
}

function choices(plan: WalkPlan) {
  return plan.choices.map((choice) => ({
    preset: choice.preset,
    ...summary(choice.route),
    quieterDb: choice.quieterDb,
    noticeable: choice.noticeable,
    extraMeters: Math.round(choice.extraMeters),
    loudMetersAvoided: Math.round(choice.loudMetersAvoided),
  }));
}

const roundPoint = (point: LngLat) => point.map((degrees) => degrees.toFixed(6));

test('the quiet route leaves a loud street for a quiet parallel, and quietest does not repeat it', () => {
  const plan = planned({ tiles: [ladder(modeled(70), modeled(50))], measured: null, from: at(0, 0), to: at(1000, 0) });
  assert.deepEqual(summary(plan.shortest), { meters: 1000, laeq: 70, cells: ['main'] });
  assert.equal(Math.round(plan.shortest.loudMeters), 1000);
  assert.deepEqual(choices(plan), [
    {
      preset: 'quieter',
      meters: 1200,
      laeq: 50,
      cells: ['west', 'side', 'east'],
      quieterDb: 20,
      noticeable: true,
      extraMeters: 200,
      loudMetersAvoided: 1000,
    },
  ]);
  assert.equal(plan.measured, 'unavailable');
});

test('quietest keeps the quietest route within +25 % of the shortest', () => {
  // λ 0.5 takes B; λ 3 takes D (+60 %, over the cap); λ 2 takes C (+20 %).
  const rung = (cell: string, x: number, y0: number, y1: number): Street => ({
    cell,
    street: BELOW_FLOOR,
    points: [[x, y0], [x, y1]],
  });
  const street = (cell: string, laeq: CoveredStreetLevel, y: number): Street => ({
    cell,
    street: laeq,
    points: [[0, y], [1000, y]],
  });
  const plan = planned({
    tiles: [
      tile(
        street('main', modeled(70), 0),
        street('B', modeled(48), 50),
        street('C', modeled(46.5), 100),
        street('D', BELOW_FLOOR, 300),
        rung('w1', 0, 0, 50),
        rung('w2', 0, 50, 100),
        rung('w3', 0, 100, 300),
        rung('e1', 1000, 0, 50),
        rung('e2', 1000, 50, 100),
        rung('e3', 1000, 100, 300),
      ),
    ],
    measured: null,
    from: at(0, 0),
    to: at(1000, 0),
  });
  assert.deepEqual(choices(plan), [
    {
      preset: 'quieter',
      meters: 1100,
      laeq: 47.8,
      cells: ['w1', 'B', 'e1'],
      quieterDb: 22,
      noticeable: true,
      extraMeters: 100,
      loudMetersAvoided: 1000,
    },
    {
      preset: 'quietest',
      meters: 1200,
      laeq: 46.3,
      cells: ['w1', 'w2', 'C', 'e2', 'e1'],
      quieterDb: 24,
      noticeable: true,
      extraMeters: 200,
      loudMetersAvoided: 1000,
    },
  ]);
});

test('a measured quiet block on the loud street keeps the walk there, with its reading not averaged in', () => {
  const plan = planned({
    tiles: [ladder(modeled(70), modeled(50))],
    measured: [{ cell: 'main', laeq: 48, count: 1 }],
    from: at(0, 0),
    to: at(1000, 0),
  });
  assert.deepEqual(summary(plan.shortest), { meters: 1000, laeq: 48, cells: ['main'] });
  assert.deepEqual(plan.shortest.pieces[0].level, { kind: 'measured', laeq: 48, count: 1 });
  assert.equal(Math.round(plan.shortest.measuredMeters), 1000);
  assert.deepEqual(plan.choices, []);
  assert.equal(plan.measured, 'included');
});

test('a measured loud block on a modeled quiet street pushes the walk onto the parallel', () => {
  const trip = { tiles: [ladder(modeled(50), modeled(50))], from: at(0, 0), to: at(1000, 0) };
  assert.deepEqual(planned({ ...trip, measured: null }).choices, []);

  const plan = planned({ ...trip, measured: [{ cell: 'main', laeq: 70, count: 1 }] });
  assert.deepEqual(summary(plan.shortest), { meters: 1000, laeq: 70, cells: ['main'] });
  assert.deepEqual(
    choices(plan).map(({ preset, meters, cells, quieterDb }) => ({ preset, meters, cells, quieterDb })),
    [{ preset: 'quieter', meters: 1200, cells: ['west', 'side', 'east'], quieterDb: 20 }],
  );
});

test('a block below the modeling floor counts as 45 dB along the route', () => {
  const plan = planned({
    tiles: [
      tile(
        { cell: 'a', street: BELOW_FLOOR, points: [[0, 0], [500, 0]] },
        { cell: 'b', street: modeled(55), points: [[500, 0], [1000, 0]] },
      ),
    ],
    measured: null,
    from: at(0, 0),
    to: at(1000, 0),
  });
  // Energy average of 45 and 55 over equal lengths; a silent floor would give 51.99.
  assert.equal(plan.shortest.laeq.toFixed(2), '52.40');
  assert.deepEqual(
    routeToGeoJSON(plan.shortest).features.map((feature) => feature.properties.color),
    ['#1A9850', '#E3A21A'],
  );
});

test('tiles join across a seam only where their nodes share exact coordinates', () => {
  const west = tile({ cell: 'main', street: modeled(60), points: [[0, 0], [500, 0]] });
  const east = (seamX: number) => tile({ cell: 'main', street: modeled(60), points: [[seamX, 0], [1000, 0]] });
  const trip = { measured: null, from: at(0, 0), to: at(1000, 0) };

  const plan = planned({ ...trip, tiles: [west, east(500)] });
  assert.deepEqual(summary(plan.shortest), { meters: 1000, laeq: 60, cells: ['main'] });
  // 2 cm apart is a few E7 units: two separate nodes.
  assert.deepEqual(planWalk({ ...trip, tiles: [west, east(500.02)] }), { kind: 'no-path' });
});

test('ends snap onto edge interiors and walk partial first and last edges', () => {
  const tiles = [ladder(modeled(50), modeled(50))];
  // Both ends on the edge from 100 to 200 m.
  const inside = planned({ tiles, measured: null, from: at(110, 20), to: at(190, 20) });
  assert.deepEqual(summary(inside.shortest), { meters: 80, laeq: 50, cells: ['main'] });
  assert.deepEqual(inside.shortest.pieces[0].line.map(roundPoint), [at(110, 0), at(190, 0)].map(roundPoint));

  const across = planned({ tiles, measured: null, from: at(150, -10), to: at(450, 110) });
  assert.deepEqual(summary(across.shortest), { meters: 700, laeq: 50, cells: ['main', 'west', 'side'] });
  assert.deepEqual(
    across.shortest.pieces.map((piece) => piece.line.map(roundPoint)),
    [
      [at(150, 0), at(100, 0), at(0, 0)],
      [at(0, 0), at(0, 100)],
      [at(0, 100), at(100, 100), at(200, 100), at(300, 100), at(400, 100), at(450, 100)],
    ].map((line) => line.map(roundPoint)),
  );
});

test('steps cost three times their length', () => {
  const plan = planned({
    tiles: [
      tile(
        { cell: 'stairs', street: BELOW_FLOOR, points: [[0, 0], [300, 0]], steps: true },
        { cell: 'road', street: BELOW_FLOOR, points: [[0, 0], [150, 200], [300, 0]] },
      ),
    ],
    measured: null,
    from: at(0, 0),
    to: at(300, 0),
  });
  assert.deepEqual(summary(plan.shortest), { meters: 500, laeq: 45, cells: ['road'] });
});

test('a plan fails without walking data, off the paths, or with nothing joining the ends', () => {
  const tiles = [ladder(modeled(50), modeled(50))];
  assert.deepEqual(planWalk({ tiles: [], measured: null, from: at(0, 0), to: at(1000, 0) }), {
    kind: 'no-walking-data',
  });
  assert.deepEqual(planWalk({ tiles, measured: null, from: at(500, -200), to: at(1000, 0) }), {
    kind: 'off-path',
    end: 'from',
  });
  assert.deepEqual(planWalk({ tiles, measured: null, from: at(0, 0), to: at(500, 300) }), {
    kind: 'off-path',
    end: 'to',
  });
  const islands = [
    tile({ cell: 'a', street: modeled(50), points: [[0, 0], [400, 0]] }),
    tile({ cell: 'b', street: modeled(50), points: [[600, 0], [1000, 0]] }),
  ];
  assert.deepEqual(planWalk({ tiles: islands, measured: null, from: at(0, 0), to: at(1000, 0) }), { kind: 'no-path' });
});

test('a trip area is too far past 5 km, too close under 100 m, and otherwise a padded box', () => {
  const tooFar = tripArea(at(0, 0), at(0, 6000));
  assert.equal(tooFar.kind === 'too-far' && Math.round(tooFar.meters), 6000);
  assert.deepEqual(tripArea(at(0, 0), at(60, 0)), { kind: 'too-close' });

  const area = tripArea(at(0, 0), at(1000, 0));
  if (area.kind !== 'area') assert.fail(`expected an area, got ${area.kind}`);
  // 400 m around the trip: 40 % of 1 km.
  assert.deepEqual(
    area.bounds.map((degrees) => degrees.toFixed(6)),
    [...roundPoint(at(-400, -400)), ...roundPoint(at(1400, 400))],
  );
  assert.deepEqual(area.regions, ['85283083fffffff']);
});

test('pins put the start first and leave it out while the card asks for one', () => {
  const to: LngLat = [-122.41, 37.71];
  const pins = (from: LngLat | null) =>
    pinsToGeoJSON({ from, to }).features.map((feature) => [feature.properties.end, feature.geometry.coordinates]);
  assert.deepEqual(pins([-122.4, 37.7]), [
    ['from', [-122.4, 37.7]],
    ['to', [-122.41, 37.71]],
  ]);
  assert.deepEqual(pins(null), [['to', [-122.41, 37.71]]]);
});

test('route params round-trip a point and reject anything else', () => {
  assert.equal(formatLngLat([-122.4196, 37.7651]), '-122.419600,37.765100');
  assert.deepEqual(parseLngLat('-122.419600,37.765100'), [-122.4196, 37.7651]);
  for (const junk of [undefined, '', 'abc', '1,2,3', '1,', ',2', ' 1,2', '1e3,2', 'NaN,1', '0x10,2', '181,0', '0,91']) {
    assert.equal(parseLngLat(junk), null, `${junk}`);
  }
  assert.equal(parseQuietPreset('quietest'), 'quietest');
  for (const junk of [undefined, '', 'loudest', 'toString', '__proto__', 'Quieter']) {
    assert.equal(parseQuietPreset(junk), null, `${junk}`);
  }
});
