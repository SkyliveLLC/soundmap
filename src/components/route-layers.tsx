import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';

import type { LngLat } from '@/lib/cells';
import { pinsToGeoJSON, routeToGeoJSON, type Route } from '@/lib/quiet-routes';
import type { Palette } from '@/theme';

const NOTHING: FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * The walk on the map: the shortest way thin and grey (MapLibre Native on Android draws nothing for a
 * line-dasharray here, so it isn't dashed), the chosen route thick and colored block by block on the
 * hexagons' scale, and the pins. The sources stay mounted, empty when there's nothing to draw, so the layers keep
 * the order they were declared in instead of landing on top of whatever mounted before them.
 */
export function RouteLayers({
  shortest,
  route,
  from,
  to,
  colors,
}: {
  /** Null unless a quieter route is drawn, since otherwise the route is the shortest. */
  shortest: Route | null;
  route: Route | null;
  from: LngLat | null;
  to: LngLat | null;
  colors: Palette;
}) {
  return (
    <>
      <GeoJSONSource id="route-shortest" data={shortest ? routeToGeoJSON(shortest) : NOTHING}>
        <Layer
          id="route-shortest-line"
          type="line"
          paint={{ 'line-color': colors.muted, 'line-width': 3 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="route" data={route ? routeToGeoJSON(route) : NOTHING}>
        <Layer
          id="route-casing"
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': colors.ink, 'line-width': 8 }}
        />
        <Layer
          id="route-line"
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': 5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="route-pins" data={to ? pinsToGeoJSON({ from, to }) : NOTHING}>
        <Layer
          id="route-pin"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': ['match', ['get', 'end'], 'from', colors.background, colors.ink],
            'circle-stroke-color': ['match', ['get', 'end'], 'from', colors.ink, colors.background],
            'circle-stroke-width': 3,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
