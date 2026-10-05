import type { FeatureCollection, Polygon } from 'geojson';
import { cellToBoundary, latLngToCell } from 'h3-js';

import { energyAverage, type NoiseSummary } from './acoustics.ts';

// Resolution 10 hexagons are about 15,000 m², roughly a city block: coarse enough
// that a saved cell does not pinpoint where someone sat.
const CELL_RESOLUTION = 10;

/** A saved measurement. Only the H3 cell is kept, never the raw position. */
export type Measurement = { id: string; at: number; cell: string; summary: NoiseSummary };

export type CellAggregate = { cell: string; laeq: number; count: number };

export function cellAt(latitude: number, longitude: number): string {
  return latLngToCell(latitude, longitude, CELL_RESOLUTION);
}

/** One entry per cell, with the energy average of its measurements' LAeqs. */
export function aggregateByCell(measurements: readonly Measurement[]): CellAggregate[] {
  const levelsByCell = new Map<string, [number, ...number[]]>();
  for (const { cell, summary } of measurements) {
    const levels = levelsByCell.get(cell);
    if (levels) levels.push(summary.laeq);
    else levelsByCell.set(cell, [summary.laeq]);
  }
  return Array.from(levelsByCell, ([cell, levels]) => ({ cell, laeq: energyAverage(levels), count: levels.length }));
}

/** Hexagon polygons for the map, each carrying its aggregate. Layers color them with `LOUDNESS_COLOR`. */
export function cellsToGeoJSON(aggregates: readonly CellAggregate[]): FeatureCollection<Polygon, CellAggregate> {
  return {
    type: 'FeatureCollection',
    features: aggregates.map((aggregate) => ({
      type: 'Feature',
      id: aggregate.cell,
      // `true` returns [lng, lat] pairs with the ring closed, as GeoJSON requires.
      geometry: { type: 'Polygon', coordinates: [cellToBoundary(aggregate.cell, true)] },
      properties: aggregate,
    })),
  };
}
