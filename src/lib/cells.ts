import type { FeatureCollection, Polygon } from 'geojson';
import {
  cellToBoundary,
  cellToCenterChild,
  getResolution,
  isValidCell,
  latLngToCell,
  polygonToCellsExperimental,
  POLYGON_TO_CELLS_FLAGS,
} from 'h3-js';

// Resolution 10 hexagons are about 15,000 m², roughly a city block: coarse enough
// that a saved cell does not pinpoint where someone sat.
export const CELL_RESOLUTION = 10;

/** The map loads measurements one region at a time: a resolution 5 hexagon, about 250 km². */
export const REGION_RESOLUTION = 5;

/** Most regions one query may ask for: a tablet at zoom 10 needs about 30. */
export const MAX_REGIONS = 64;

/** [west, south, east, north] in degrees. */
export type Bounds = readonly [west: number, south: number, east: number, north: number];

/** A measured hexagon: the energy average of its readings' LAeqs, and how many there are. */
export type CellAggregate = { cell: string; laeq: number; count: number };

export function cellAt(latitude: number, longitude: number): string {
  return latLngToCell(latitude, longitude, CELL_RESOLUTION);
}

export function isRegion(region: string): boolean {
  return isValidCell(region) && getResolution(region) === REGION_RESOLUTION;
}

/** Regions overlapping a box, sorted so the same view always asks the same query. */
export function regionsIn([west, south, east, north]: Bounds): string[] {
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return polygonToCellsExperimental(
    ring,
    REGION_RESOLUTION,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
    true,
  ).sort();
}

/**
 * The first and last block index inside a region. Block indexes are same-length hex strings that
 * sort like the numbers they encode, so this is an index range: `by_cell` serves a region in one scan.
 */
export function regionRange(region: string): [first: string, last: string] {
  const first = cellToCenterChild(region, CELL_RESOLUTION);
  // Each finer resolution appends a 3-bit digit (bit 0 is the last of 15): 0 in the center child, at most 6.
  let last = BigInt(`0x${first}`);
  for (let resolution = REGION_RESOLUTION + 1; resolution <= CELL_RESOLUTION; resolution++) {
    last |= 6n << BigInt(3 * (15 - resolution));
  }
  return [first, last.toString(16)];
}

export function cellPolygon(cell: string): Polygon {
  // `true` returns [lng, lat] pairs with the ring closed, as GeoJSON requires.
  return { type: 'Polygon', coordinates: [cellToBoundary(cell, true)] };
}

/** Hexagon polygons for the map, each carrying its aggregate. Layers color them with `LOUDNESS_COLOR`. */
export function cellsToGeoJSON(aggregates: readonly CellAggregate[]): FeatureCollection<Polygon, CellAggregate> {
  return {
    type: 'FeatureCollection',
    features: aggregates.map((aggregate) => ({
      type: 'Feature',
      id: aggregate.cell,
      geometry: cellPolygon(aggregate.cell),
      properties: aggregate,
    })),
  };
}
