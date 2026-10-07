import type { FeatureCollection, Polygon } from 'geojson';
import { cellToBoundary, latLngToCell } from 'h3-js';

// Resolution 10 hexagons are about 15,000 m², roughly a city block: coarse enough
// that a saved cell does not pinpoint where someone sat.
export const CELL_RESOLUTION = 10;

/** A measured hexagon: the energy average of its readings' LAeqs, and how many there are. */
export type CellAggregate = { cell: string; laeq: number; count: number };

export function cellAt(latitude: number, longitude: number): string {
  return latLngToCell(latitude, longitude, CELL_RESOLUTION);
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
