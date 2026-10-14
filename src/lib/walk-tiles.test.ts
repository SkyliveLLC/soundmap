/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellAt } from './cells.ts';
import { EDGE_FLAGS, decodeWalkTile, encodeWalkTile, splitAtBlocks, walkTileKey, type WalkTile } from './walk-tiles.ts';

// Three blocks by City Hall, San Francisco.
const WEST = '8a2830828747fff';
const MIDDLE = '8a2830828757fff';
const EAST = '8a2830828627fff';

const tile: WalkTile = {
  nodes: Int32Array.from([-1224180000, 377800000, -1224178882, 377800056, -1224163218, 377800839]),
  edgeNodes: Uint32Array.from([0, 1, 1, 2]),
  edgeBlock: Uint16Array.from([0, 1]),
  edgeFlags: Uint8Array.from([0, EDGE_FLAGS.steps]),
  blocks: [
    { cell: WEST, street: { kind: 'modeled', laeq24h: 62.3 } },
    { cell: MIDDLE, street: { kind: 'below-floor' } },
  ],
};

function plain({ nodes, edgeNodes, edgeBlock, edgeFlags, blocks }: WalkTile) {
  return { nodes: [...nodes], edgeNodes: [...edgeNodes], edgeBlock: [...edgeBlock], edgeFlags: [...edgeFlags], blocks };
}

test('a tile survives encoding and decoding', () => {
  const bytes = encodeWalkTile(tile);
  assert.equal(bytes.byteLength, 84);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'SMW1');
  assert.deepEqual(plain(decodeWalkTile(bytes)), {
    nodes: [-1224180000, 377800000, -1224178882, 377800056, -1224163218, 377800839],
    edgeNodes: [0, 1, 1, 2],
    edgeBlock: [0, 1],
    edgeFlags: [0, 1],
    blocks: [
      { cell: WEST, street: { kind: 'modeled', laeq24h: 62.3 } },
      { cell: MIDDLE, street: { kind: 'below-floor' } },
    ],
  });
});

test('a tile decodes from bytes that start at an odd offset', () => {
  const shifted = new Uint8Array(85);
  shifted.set(encodeWalkTile(tile), 1);
  assert.deepEqual(plain(decodeWalkTile(shifted.subarray(1))).nodes, [...tile.nodes]);
});

test('a corrupt tile is rejected', () => {
  const corrupt = (offset: number, value: number) => {
    const bytes = encodeWalkTile(tile);
    bytes[offset] = value;
    return bytes;
  };
  assert.throws(() => decodeWalkTile(corrupt(0, 0)), /bad magic/);
  // The second edge's `to` (byte 52) and its block (byte 58).
  assert.throws(() => decodeWalkTile(corrupt(52, 3)), /edge node 3 of 3/);
  assert.throws(() => decodeWalkTile(corrupt(58, 2)), /edge block 2 of 2/);
  assert.throws(() => decodeWalkTile(encodeWalkTile(tile).subarray(0, 83)), /83 bytes where the header needs 84/);
});

test('a segment is cut where it crosses into each block, at points its pieces share', () => {
  const pieces = splitAtBlocks([-1224180000, 377800000], [-1224160000, 377801000]);
  assert.deepEqual(pieces, [
    { from: [-1224180000, 377800000], to: [-1224178882, 377800056], cell: WEST },
    { from: [-1224178882, 377800056], to: [-1224163218, 377800839], cell: MIDDLE },
    { from: [-1224163218, 377800839], to: [-1224160000, 377801000], cell: EAST },
  ]);
  for (const [before, after] of [pieces.slice(0, 2), pieces.slice(1, 3)]) {
    // A meter along the segment either side of the cut lies in the block on that side.
    const [lng, lat] = before.to;
    assert.equal(cellAt((lat - 6) / 1e7, (lng - 113) / 1e7), before.cell);
    assert.equal(cellAt((lat + 6) / 1e7, (lng + 113) / 1e7), after.cell);
  }
  for (const piece of pieces) assert.deepEqual(splitAtBlocks(piece.from, piece.to), [piece]);
});

test('a segment inside one block comes back whole', () => {
  assert.deepEqual(splitAtBlocks([-1224180000, 377800000], [-1224179000, 377800030]), [
    { from: [-1224180000, 377800000], to: [-1224179000, 377800030], cell: WEST },
  ]);
});

test('a node belongs to the z14 tile around it', () => {
  assert.equal(walkTileKey([-1224180000, 377800000]), '2620/6332');
  assert.equal(walkTileKey([-1224180000, 377900000]), '2620/6331');
});
