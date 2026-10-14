import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { MultiPolygon, Polygon } from 'geojson';

/**
 * Census Bureau state boundaries, in two cuts. `shoreline` (1:500k cartographic boundaries) stops at a
 * generalized shoreline: the street noise coverage layer, so a tap on the water reads as not covered rather than
 * quiet. `waters` (TIGER/Line) runs out to each state's waters and follows land borders exactly: the walking
 * graph, so a pier stays whole and a way stops at the border.
 */
const STATE_BOUNDARIES = {
  shoreline: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip',
  waters: 'https://www2.census.gov/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip',
} as const;

/** The 50 states and DC (FIPS 1-56; territories start at 60), what NTNM models, dissolved into one geometry. */
export async function coverageGeometry(boundary: keyof typeof STATE_BOUNDARIES): Promise<Polygon | MultiPolygon> {
  const url = STATE_BOUNDARIES[boundary];
  const layer = url.split('/').at(-1)!.replace('.zip', '');
  const ogr = spawn(
    'ogr2ogr',
    [
      ...['-f', 'GeoJSONSeq', '/vsistdout/', `/vsizip//vsicurl/${url}`, '-dialect', 'sqlite'],
      ...['-sql', `SELECT ST_Union(geometry) AS geometry FROM ${layer} WHERE CAST(STATEFP AS INTEGER) <= 56`],
      ...['-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6'],
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const closed = once(ogr, 'close');
  const chunks: Buffer[] = [];
  for await (const chunk of ogr.stdout) chunks.push(chunk);
  const [code] = await closed;
  if (code !== 0) throw new Error(`ogr2ogr exited with ${code}`);
  const { geometry }: { geometry: Polygon | MultiPolygon } = JSON.parse(
    Buffer.concat(chunks).toString().replace(/^\x1e/, ''),
  );
  return geometry;
}

const LAT_ROW_DEG = 0.01;

/**
 * A point-in-geometry test for millions of points: even-odd over every ring, as the app tests a tap against the
 * coverage layer.
 */
export function containsPoint(geometry: Polygon | MultiPolygon): (lng: number, lat: number) => boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const filed = new Map<number, number[]>();
  for (const ring of polygons.flat()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay === by) continue;
      const last = Math.floor(Math.max(ay, by) / LAT_ROW_DEG);
      for (let row = Math.floor(Math.min(ay, by) / LAT_ROW_DEG); row <= last; row++) {
        const edges = filed.get(row);
        if (edges) edges.push(ax, ay, bx, by);
        else filed.set(row, [ax, ay, bx, by]);
      }
    }
  }
  const rows = new Map([...filed].map(([row, edges]) => [row, Float64Array.from(edges)]));
  return (lng, lat) => {
    const edges = rows.get(Math.floor(lat / LAT_ROW_DEG));
    if (!edges) return false;
    let inside = false;
    for (let k = 0; k < edges.length; k += 4) {
      const [ax, ay, bx, by] = [edges[k], edges[k + 1], edges[k + 2], edges[k + 3]];
      if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
}
