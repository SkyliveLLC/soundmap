import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  type CameraRef,
  type InitialViewState,
} from '@maplibre/maplibre-react-native';
import { useQuery } from 'convex/react';
import { getForegroundPermissionsAsync } from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { cellToLatLng } from 'h3-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import { cellAt, cellPolygon, cellsToGeoJSON } from '@/lib/cells';
import { LOUDNESS_COLOR, loudnessBand, type LoudnessBand } from '@/lib/loudness';
import { DOT_FLOOR_DB, readCell, type CellReading, type StreetLevel } from '@/lib/street-noise';
import { STREET_NOISE, STREET_NOISE_GEOJSON_URI } from '@/lib/street-noise-assets';
import { usePalette, type Palette } from '@/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const SAN_FRANCISCO: InitialViewState = { center: [-122.4194, 37.7749], zoom: 12.5 };

export default function MapScreen() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  // The selected cell lives in the route so "Added to map · View" can open the map on it.
  const { cell: selectedCell } = useLocalSearchParams<{ cell?: string }>();
  // Everyone's measured hexagons, kept live by Convex. Undefined until the first result arrives.
  const aggregates = useQuery(api.measurements.cells);
  const [locationGranted, setLocationGranted] = useState(false);
  // The cell the last map tap selected. Only selections from elsewhere ("View") move the camera.
  const tappedCell = useRef<string | undefined>(undefined);

  // "Add to map" may have just granted location. Only reads the permission: the prompt belongs to "Add to map".
  useFocusEffect(
    useCallback(() => {
      getForegroundPermissionsAsync().then(({ granted }) => setLocationGranted(granted));
    }, []),
  );

  useEffect(() => {
    const fromTap = selectedCell === tappedCell.current;
    tappedCell.current = undefined;
    if (!selectedCell || fromTap) return;
    const [latitude, longitude] = cellToLatLng(selectedCell);
    camera.current?.flyTo({ center: [longitude, latitude], zoom: 15, duration: 800 });
  }, [selectedCell]);

  const readingAt = (cell: string) =>
    readCell(cell, aggregates?.find((aggregate) => aggregate.cell === cell), STREET_NOISE);
  const reading = selectedCell ? readingAt(selectedCell) : null;

  return (
    <View style={styles.screen}>
      <Map
        style={styles.screen}
        mapStyle={MAP_STYLE}
        logo={false}
        tintColor={colors.accent}
        // Keeps the attribution clear of the cell card at the bottom.
        attributionPosition={{ top: insets.top + 8, left: 8 }}
        // Any tap selects the block under it, so a quiet street can answer too. Outside the street
        // noise area an unmeasured block has nothing to show, so that tap clears the card instead.
        onPress={(event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat;
          const cell = cellAt(latitude, longitude);
          tappedCell.current = readingAt(cell) ? cell : undefined;
          router.setParams({ cell: tappedCell.current });
        }}
      >
        <Camera ref={camera} initialViewState={SAN_FRANCISCO} />
        <GeoJSONSource id="street-noise" data={STREET_NOISE_GEOJSON_URI}>
          <Layer id="street-noise-fill" type="fill" paint={{ 'fill-color': LOUDNESS_COLOR, 'fill-opacity': 0.28 }} />
        </GeoJSONSource>
        <GeoJSONSource id="cells" data={cellsToGeoJSON(aggregates ?? [])}>
          <Layer id="cell-fill" type="fill" paint={{ 'fill-color': LOUDNESS_COLOR, 'fill-opacity': 0.45 }} />
          <Layer id="cell-outline" type="line" paint={{ 'line-color': LOUDNESS_COLOR, 'line-width': 1.5 }} />
        </GeoJSONSource>
        {reading && (
          <GeoJSONSource id="selected-cell" data={cellPolygon(reading.cell)}>
            <Layer
              id="selected-cell-outline"
              type="line"
              afterId="cell-outline"
              paint={{ 'line-color': colors.ink, 'line-width': 3 }}
            />
          </GeoJSONSource>
        )}
        {locationGranted && <NativeUserLocation />}
      </Map>
      {reading ? (
        <CellCard reading={reading} colors={colors} />
      ) : (
        aggregates?.length === 0 && (
          <View style={[styles.card, { backgroundColor: colors.background }]}>
            <Text style={[styles.hint, { color: colors.muted }]}>
              Colors show modeled street noise. Measure a spot to add yours.
            </Text>
          </View>
        )
      )}
    </View>
  );
}

function CellCard({ reading, colors }: { reading: CellReading; colors: Palette }) {
  const { band, level, unit, detail, note } = cardLines(reading);
  return (
    <View style={[styles.card, styles.cellCard, { backgroundColor: colors.background }]}>
      <View style={[styles.swatch, { backgroundColor: band.color }]} />
      <View style={styles.cardText}>
        <Text style={[styles.level, { color: colors.ink }]}>
          {level} <Text style={[styles.unit, { color: colors.muted }]}>{unit}</Text>
        </Text>
        <Text style={[styles.detail, { color: colors.ink }]}>{detail}</Text>
        {note && <Text style={[styles.note, { color: colors.muted }]}>{note}</Text>}
      </View>
    </View>
  );
}

type CardLines = { band: LoudnessBand; level: string; unit: string; detail: string; note: string | null };

// A measurement leads when there is one. DOT street noise is a different quantity (a modeled 24 h
// average), so it is always labeled as modeled and never merged into the measured level.
function cardLines(reading: CellReading): CardLines {
  const source = `US DOT ${STREET_NOISE.release}`;
  if (reading.measured) {
    const { laeq, count } = reading.measured;
    const band = loudnessBand(laeq);
    return {
      band,
      level: `${Math.round(laeq)}`,
      unit: 'dBA average',
      detail: `${band.label} · ${count} ${count === 1 ? 'measurement' : 'measurements'}`,
      note: streetNote(reading.street, source),
    };
  }
  switch (reading.street.kind) {
    case 'modeled': {
      const band = loudnessBand(reading.street.laeq24h);
      return {
        band,
        level: `${Math.round(reading.street.laeq24h)}`,
        unit: 'dBA modeled street noise',
        detail: band.label,
        note: `24 h avg · ${source} · Modeled, not measured`,
      };
    }
    case 'below-floor': {
      const band = loudnessBand(-Infinity);
      return {
        band,
        level: `Below ${DOT_FLOOR_DB}`,
        unit: 'dBA modeled street noise',
        detail: band.label,
        note: `${source} · Modeled, not measured`,
      };
    }
  }
}

function streetNote(street: StreetLevel, source: string): string | null {
  switch (street.kind) {
    case 'modeled':
      return `${Math.round(street.laeq24h)} dBA modeled street noise · 24 h avg · ${source}`;
    case 'below-floor':
      return `Modeled street noise below ${DOT_FLOOR_DB} dBA · ${source}`;
    case 'not-covered':
      return null;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  cellCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  swatch: { width: 14, height: 44, borderRadius: 7 },
  cardText: { flex: 1, gap: 2 },
  level: { fontSize: 28, fontWeight: '300', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, fontWeight: '400' },
  detail: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
