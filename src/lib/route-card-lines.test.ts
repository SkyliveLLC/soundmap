/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { QuietChoice, Route, RoutePiece, WalkPlan } from './quiet-routes.ts';
import { routeCardLines } from './route-card-lines.ts';

const piece = (cell: string, level: RoutePiece['level'], meters = 100): RoutePiece => ({
  line: [
    [-122.42, 37.77],
    [-122.41, 37.77],
  ],
  meters,
  cell,
  level,
});

const shortest: Route = {
  pieces: [piece('a', { kind: 'modeled', laeq24h: 68 }), piece('b', { kind: 'modeled', laeq24h: 64 })],
  meters: 1760,
  laeq: 66.4,
  loudMeters: 480,
  measuredMeters: 0,
};

const quiet: Route = {
  pieces: [
    piece('c', { kind: 'measured', laeq: 55, count: 2 }),
    piece('c', { kind: 'measured', laeq: 55, count: 2 }),
    piece('d', { kind: 'measured', laeq: 60, count: 1 }),
    piece('e', { kind: 'measured', laeq: 52, count: 4 }),
    piece('f', { kind: 'below-floor' }),
  ],
  meters: 1900,
  laeq: 63.2,
  loudMeters: 160,
  measuredMeters: 400,
};

const quieter: QuietChoice = {
  preset: 'quieter',
  route: { ...quiet, pieces: [piece('c', { kind: 'measured', laeq: 55, count: 2 })] },
  quieterDb: 2,
  noticeable: false,
  extraMeters: 30,
  loudMetersAvoided: 30,
};

const quietest: QuietChoice = {
  preset: 'quietest',
  route: quiet,
  quieterDb: 3,
  noticeable: true,
  extraMeters: 140,
  loudMetersAvoided: 320,
};

const planned = (plan: Partial<WalkPlan>) =>
  ({ kind: 'planned', plan: { shortest, choices: [], measured: 'included', ...plan } }) as const;

const oneLine = (headline: string, detail: string | null = null) => ({
  headline,
  badge: null,
  detail,
  loud: null,
  note: null,
});

test('before a start, the card asks for one', () => {
  assert.deepEqual(routeCardLines({ kind: 'idle' }, 'quieter'), {
    headline: 'Walk here',
    badge: null,
    detail: null,
    loud: null,
    note: 'or long-press where to start',
  });
});

test('each state that is not a plan gets one line', () => {
  assert.deepEqual(routeCardLines({ kind: 'loading' }, 'quieter'), oneLine('Finding a quieter way…'));
  assert.deepEqual(
    routeCardLines({ kind: 'offline', retry: () => {} }, 'quieter'),
    oneLine("Can't load the walking map. Check your connection."),
  );
  assert.deepEqual(
    routeCardLines({ kind: 'too-far', meters: 8240 }, 'quieter'),
    oneLine('Quiet routes are for walks up to 5 km.', 'These points are 8.2 km apart.'),
  );
  assert.deepEqual(routeCardLines({ kind: 'too-close' }, 'quieter'), oneLine('Pick an end farther from the start.'));
  assert.deepEqual(routeCardLines({ kind: 'no-walking-data' }, 'quieter'), oneLine('No walking map here yet.'));
  assert.deepEqual(
    routeCardLines({ kind: 'off-path', end: 'from' }, 'quieter'),
    oneLine('Pick a start closer to a street or path.'),
  );
  assert.deepEqual(
    routeCardLines({ kind: 'off-path', end: 'to' }, 'quieter'),
    oneLine('Pick an end closer to a street or path.'),
  );
  assert.deepEqual(routeCardLines({ kind: 'no-path' }, 'quieter'), oneLine('No walking route joins these points.'));
});

test('a noticeably quieter route shows its gain, detour, loud minutes and measured blocks', () => {
  assert.deepEqual(routeCardLines(planned({ choices: [quieter, quietest] }), 'quietest'), {
    headline: '3 dB quieter',
    badge: 'Noticeably quieter',
    detail: '+140 m, about 2 min longer · 1.9 km, 24 min',
    loud: '4 min less on loud blocks',
    note: 'US DOT 2022 modeled noise · measured on 3 blocks',
  });
});

test('a small gain has no badge, and a short detour or loud stretch no minutes', () => {
  assert.deepEqual(routeCardLines(planned({ choices: [quieter, quietest] }), 'quieter'), {
    headline: '2 dB quieter',
    badge: null,
    detail: '+30 m · 1.9 km, 24 min',
    loud: null,
    note: 'US DOT 2022 modeled noise · measured on 1 block',
  });
});

test('a preset the plan left out falls back to the choice it has', () => {
  assert.equal(routeCardLines(planned({ choices: [quietest] }), 'quieter').headline, '3 dB quieter');
});

test('a quiet route shorter than the shortest says so', () => {
  const shorter = { ...quieter, extraMeters: -42 };
  assert.equal(routeCardLines(planned({ choices: [shorter] }), 'quieter').detail, '40 m shorter · 1.9 km, 24 min');
  const same = { ...quieter, extraMeters: 3 };
  assert.equal(routeCardLines(planned({ choices: [same] }), 'quieter').detail, 'Same distance · 1.9 km, 24 min');
});

test('without measured blocks in hand the note says modeled only', () => {
  assert.equal(
    routeCardLines(planned({ choices: [quietest], measured: 'unavailable' }), 'quietest').note,
    'US DOT 2022 modeled noise · modeled only',
  );
});

test('when the shortest way is already quiet, the card says so with its level', () => {
  assert.deepEqual(routeCardLines(planned({}), 'quietest'), {
    headline: 'The shortest way is already the quiet one',
    badge: null,
    detail: '1.8 km, 22 min · 66 dBA along the way',
    loud: null,
    note: 'US DOT 2022 modeled noise',
  });
});
