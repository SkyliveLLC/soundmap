import { h3IndexToSplitLong, splitLongToH3Index } from 'h3-js';

import { cellAt, type Bounds } from './cells.ts';
import { STREET_NOISE_RELEASE, TILE_HOST, type StreetLevel } from './street-noise.ts';
import { tilePosition, tileReader } from './street-noise-tiles.ts';

/** OSM snapshot the walking graph was cut from. */
export const WALK_GRAPH_RELEASE = '2026-10';

const FORMAT = 2;

/**
 * The archive's file name, for the build and the phone. Each OSM snapshot, tile format and NTNM release gets its
 * own, so phones never join tiles of two and a route's modeled levels come from the same blocks the map draws.
 */
export function walkTilesName(osmRelease: string): string {
  return `walking-v${FORMAT}-${osmRelease}-noise-${STREET_NOISE_RELEASE}.pmtiles`;
}

/**
 * The walking graph (built by scripts/walk-graph.ts) with modeled street noise baked into it.
 * EXPO_PUBLIC_WALK_TILES overrides it.
 */
export const WALK_TILES =
  process.env.EXPO_PUBLIC_WALK_TILES ??
  `${TILE_HOST}/${walkTilesName(WALK_GRAPH_RELEASE)}`;

/** Graph tiles exist at this zoom only: about 2 km across in the lower 48. */
export const WALK_ZOOM = 14;

/** Edge flag bits. Only what the cost function reads. */
export const EDGE_FLAGS = { steps: 1 } as const;

/** A block the graph crosses, with the modeled level baked in at build time as the map reads it. */
export type WalkBlock = { cell: string; street: StreetLevel };

/**
 * One z14 tile of the walking graph: every walkable OSM segment whose first node lies in the tile, cut where it
 * crosses into the next H3 block, so every edge lies in exactly one block. Struct of arrays over the tile's
 * own bytes: decoding is slicing, not parsing.
 *
 * Invariants (checked by decodeWalkTile, trusted everywhere else):
 * - `nodes.length` is even; `edgeNodes.length === 2 * edgeBlock.length === 2 * edgeFlags.length`.
 * - every `edgeNodes` value < nodes.length / 2; every `edgeBlock` value < blocks.length.
 */
export type WalkTile = {
  /** [lngE7, latE7] pairs. Equal integers are the same node, in this tile and its neighbors: that is how tiles join. */
  nodes: Int32Array;
  /** [from, to] pairs of indexes into `nodes`. Undirected: walking has no one-ways. */
  edgeNodes: Uint32Array;
  /** Per edge, an index into `blocks`. */
  edgeBlock: Uint16Array;
  /** Per edge, a bitset of EDGE_FLAGS. */
  edgeFlags: Uint8Array;
  blocks: readonly WalkBlock[];
};

const MAGIC = new DataView(Uint8Array.from(`SMW${FORMAT}`, (char) => char.charCodeAt(0)).buffer).getUint32(0, true);
const HEADER_BYTES = 16;
const BLOCK_BYTES = 10;
const BELOW_FLOOR = 0;
const NOT_COVERED = 0xffff;

/**
 * Byte offsets of each section. Wire layout, little-endian, stored uncompressed (gunzip in JS was 0.95 s of a
 * 1.7 s plan in q6):
 *   u32 magic 'SMW2' · u32 nodeCount · u32 edgeCount · u32 blockCount
 *   i32[2·nodeCount] nodes · u32[2·edgeCount] edgeNodes · u16[edgeCount] edgeBlock · u8[edgeCount] edgeFlags (padded to 4)
 *   blockCount × (u32 cellHigh · u32 cellLow · u16 level)
 *     level: 0 = below floor, 0xffff = not covered, else laeq24h × 10
 */
function layout(nodeCount: number, edgeCount: number, blockCount: number) {
  const nodes = HEADER_BYTES;
  const edgeNodes = nodes + 8 * nodeCount;
  const edgeBlock = edgeNodes + 8 * edgeCount;
  const edgeFlags = edgeBlock + 2 * edgeCount;
  const blocks = Math.ceil((edgeFlags + edgeCount) / 4) * 4;
  return { nodes, edgeNodes, edgeBlock, edgeFlags, blocks, bytes: blocks + BLOCK_BYTES * blockCount };
}

// The arrays are copied and read in the platform's byte order, which is little-endian on every phone and build machine.
export function encodeWalkTile({ nodes, edgeNodes, edgeBlock, edgeFlags, blocks }: WalkTile): Uint8Array {
  // edgeBlock is u16. A z14 tile crosses a few hundred blocks.
  if (blocks.length > 0x10000) throw new Error(`walk tile: ${blocks.length} blocks`);
  const at = layout(nodes.length / 2, edgeBlock.length, blocks.length);
  const bytes = new Uint8Array(at.bytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, nodes.length / 2, true);
  view.setUint32(8, edgeBlock.length, true);
  view.setUint32(12, blocks.length, true);
  new Int32Array(bytes.buffer, at.nodes, nodes.length).set(nodes);
  new Uint32Array(bytes.buffer, at.edgeNodes, edgeNodes.length).set(edgeNodes);
  new Uint16Array(bytes.buffer, at.edgeBlock, edgeBlock.length).set(edgeBlock);
  bytes.set(edgeFlags, at.edgeFlags);
  blocks.forEach(({ cell, street }, i) => {
    const level = encodedLevel(street);
    if (street.kind === 'modeled' && (level <= BELOW_FLOOR || level >= NOT_COVERED)) {
      throw new Error(`walk tile: ${cell} level ${street.laeq24h}`);
    }
    const [low, high] = h3IndexToSplitLong(cell);
    const offset = at.blocks + i * BLOCK_BYTES;
    view.setUint32(offset, high, true);
    view.setUint32(offset + 4, low, true);
    view.setUint16(offset + 8, level, true);
  });
  return bytes;
}

/** Views onto `bytes` plus the block table. Throws on a bad magic or a broken invariant: a corrupt tile is a build bug. */
export function decodeWalkTile(bytes: Uint8Array): WalkTile {
  // Typed-array views need their offset aligned to the element size.
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const { buffer, byteOffset, byteLength } = aligned;
  const view = new DataView(buffer, byteOffset, byteLength);
  if (byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) throw new Error('walk tile: bad magic');
  const nodeCount = view.getUint32(4, true);
  const edgeCount = view.getUint32(8, true);
  const blockCount = view.getUint32(12, true);
  const at = layout(nodeCount, edgeCount, blockCount);
  if (at.bytes !== byteLength) throw new Error(`walk tile: ${byteLength} bytes where the header needs ${at.bytes}`);

  const edgeNodes = new Uint32Array(buffer, byteOffset + at.edgeNodes, 2 * edgeCount);
  for (let i = 0; i < edgeNodes.length; i++) {
    if (edgeNodes[i] >= nodeCount) throw new Error(`walk tile: edge node ${edgeNodes[i]} of ${nodeCount}`);
  }
  const edgeBlock = new Uint16Array(buffer, byteOffset + at.edgeBlock, edgeCount);
  for (let i = 0; i < edgeBlock.length; i++) {
    if (edgeBlock[i] >= blockCount) throw new Error(`walk tile: edge block ${edgeBlock[i]} of ${blockCount}`);
  }
  const blocks = Array.from({ length: blockCount }, (_, i): WalkBlock => {
    const offset = at.blocks + i * BLOCK_BYTES;
    return {
      cell: splitLongToH3Index(view.getUint32(offset + 4, true), view.getUint32(offset, true)),
      street: decodedLevel(view.getUint16(offset + 8, true)),
    };
  });
  return {
    nodes: new Int32Array(buffer, byteOffset + at.nodes, 2 * nodeCount),
    edgeNodes,
    edgeBlock,
    edgeFlags: new Uint8Array(buffer, byteOffset + at.edgeFlags, edgeCount),
    blocks,
  };
}

function encodedLevel(street: StreetLevel): number {
  switch (street.kind) {
    case 'modeled':
      return Math.round(street.laeq24h * 10);
    case 'below-floor':
      return BELOW_FLOOR;
    case 'not-covered':
      return NOT_COVERED;
  }
}

function decodedLevel(level: number): StreetLevel {
  switch (level) {
    case BELOW_FLOOR:
      return { kind: 'below-floor' };
    case NOT_COVERED:
      return { kind: 'not-covered' };
    default:
      return { kind: 'modeled', laeq24h: level / 10 };
  }
}

/** Tiles kept decoded: a 5 km trip needs up to 30. */
const CACHED_TILES = 32;

/**
 * Reads the graph tiles overlapping a box from the archive. Tiles the archive lacks (outside the built area) are
 * left out, so an empty list means "no walking data here". Rejects when any fetch fails, such as offline; a
 * failed tile isn't cached, so the next call retries. Keeps the last CACHED_TILES decoded tiles.
 */
export function walkTilesReader(url: string): (bounds: Bounds) => Promise<readonly WalkTile[]> {
  const tileAt = tileReader(url, WALK_ZOOM, CACHED_TILES, (bytes) => decodeWalkTile(new Uint8Array(bytes)));

  return async ([west, south, east, north]) => {
    const northWest = tilePosition(north, west, WALK_ZOOM);
    const southEast = tilePosition(south, east, WALK_ZOOM);
    const reads: Promise<WalkTile | null>[] = [];
    for (let x = northWest.x; x <= southEast.x; x++) {
      for (let y = northWest.y; y <= southEast.y; y++) reads.push(tileAt(x, y));
    }
    return (await Promise.all(reads)).filter((tile) => tile !== null);
  };
}

// ── Pipeline helpers (pure; scripts/walk-graph.ts calls them, tests pin them) ──

/** A point in integer 1e-7 degrees, the precision OSM stores. Integers make node identity exact. */
export type LngLatE7 = readonly [lngE7: number, latE7: number];

/** One segment piece inside one block. */
export type BlockPiece = { from: LngLatE7; to: LngLatE7; cell: string };

/** Crossings are located to within this. */
const BISECT_METERS = 0.1;
/** A crossing this close to an end of the segment is no cut. */
const END_METERS = 0.5;
const METERS_PER_E7 = (6_371_008.8 * Math.PI) / 180 / 1e7;

/**
 * Cuts an OSM segment where it crosses block boundaries. Consecutive pieces share their cut point exactly, and
 * each piece is labeled with the block holding its midpoint. A segment inside one block comes back whole.
 *
 * Blocks are convex, so a span whose two ends lie in one block lies wholly in it. Bisection therefore only
 * descends into spans whose ends differ, and finds every crossing, however short the stretch through a block.
 * A crossing within END_METERS of an end is dropped, so a cut never lands on an OSM node.
 */
export function splitAtBlocks(from: LngLatE7, to: LngLatE7): readonly [BlockPiece, ...BlockPiece[]] {
  const fromCell = cellOfE7(from);
  if (fromCell === cellOfE7(to)) return [{ from, to, cell: fromCell }];

  const cuts: LngLatE7[] = [];
  const bisect = (a: LngLatE7, aCell: string, b: LngLatE7, bCell: string) => {
    if (aCell === bCell) return;
    const middle = midpoint(a, b);
    if (meters(a, b) <= BISECT_METERS) {
      const cut: LngLatE7 = [Math.round(middle[0]), Math.round(middle[1])];
      const previous = cuts.at(-1) ?? from;
      if (meters(cut, from) > END_METERS && meters(cut, to) > END_METERS && (cut[0] !== previous[0] || cut[1] !== previous[1])) {
        cuts.push(cut);
      }
      return;
    }
    const middleCell = cellOfE7(middle);
    bisect(a, aCell, middle, middleCell);
    bisect(middle, middleCell, b, bCell);
  };
  bisect(from, fromCell, to, cellOfE7(to));

  const points = [from, ...cuts, to];
  const pieces = points.slice(1).map((end, i): BlockPiece => {
    const start = points[i];
    return { from: start, to: end, cell: cellOfE7(midpoint(start, end)) };
  });
  return pieces as [BlockPiece, ...BlockPiece[]];
}

/** The z14 tile holding a node, as `${x}/${y}`: the pipeline's grouping key and the archive's address. */
export function walkTileKey([lngE7, latE7]: LngLatE7): string {
  const { x, y } = tilePosition(latE7 / 1e7, lngE7 / 1e7, WALK_ZOOM);
  return `${x}/${y}`;
}

function cellOfE7([lngE7, latE7]: LngLatE7): string {
  return cellAt(latE7 / 1e7, lngE7 / 1e7);
}

function midpoint(a: LngLatE7, b: LngLatE7): LngLatE7 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Equirectangular: it only has to compare sub-meter spans with BISECT_METERS and END_METERS. */
function meters(a: LngLatE7, b: LngLatE7): number {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2e7) * (Math.PI / 180));
  return Math.hypot(dx, a[1] - b[1]) * METERS_PER_E7;
}
