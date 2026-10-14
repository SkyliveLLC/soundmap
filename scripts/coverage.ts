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
