import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  type CameraRef,
  type InitialViewState,
} from '@maplibre/maplibre-react-native';
import { getForegroundPermissionsAsync } from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { cellToLatLng } from 'h3-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { aggregateByCell, cellsToGeoJSON, type CellAggregate } from '@/lib/cells';
import { loudnessBand } from '@/lib/loudness';
import { listMeasurements } from '@/lib/measurement-store';
import { usePalette, type Palette } from '@/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const SAN_FRANCISCO: InitialViewState = { center: [-122.4194, 37.7749], zoom: 12.5 };

export default function MapScreen() {
  const db = useSQLiteContext();
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  // The selected cell lives in the route so "Added to map · View" can open the map on it.
  const { cell: selectedCell } = useLocalSearchParams<{ cell?: string }>();
  const [aggregates, setAggregates] = useState<CellAggregate[] | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);

  // Saves happen on the Measure tab, so returning here is when the data can have changed.
  // Only reads the location permission: the prompt belongs to "Add to map".
  useFocusEffect(
    useCallback(() => {
      listMeasurements(db).then((measurements) => setAggregates(aggregateByCell(measurements)));
      getForegroundPermissionsAsync().then(({ granted }) => setLocationGranted(granted));
    }, [db]),
  );

  useEffect(() => {
    if (!selectedCell) return;
    const [latitude, longitude] = cellToLatLng(selectedCell);
    camera.current?.flyTo({ center: [longitude, latitude], zoom: 15, duration: 800 });
  }, [selectedCell]);

  const selected = aggregates?.find((aggregate) => aggregate.cell === selectedCell);

  return (
    <View style={styles.screen}>
      <Map
        style={styles.screen}
        mapStyle={MAP_STYLE}
        logo={false}
        tintColor={colors.accent}
        // Keeps the attribution clear of the cell card at the bottom.
        attributionPosition={{ top: insets.top + 8, left: 8 }}
        onPress={() => router.setParams({ cell: undefined })}
      >
        <Camera ref={camera} initialViewState={SAN_FRANCISCO} />
        {aggregates && (
          <GeoJSONSource
            id="cells"
            data={cellsToGeoJSON(aggregates)}
            onPress={(event) => {
              event.stopPropagation();
              const cell = event.nativeEvent.features[0]?.properties?.cell;
              if (typeof cell === 'string') router.setParams({ cell });
            }}
          >
            <Layer id="cell-fill" type="fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 }} />
            <Layer
              id="cell-outline"
              type="line"
              paint={{
                'line-color': ['get', 'color'],
                'line-width': ['case', ['==', ['get', 'cell'], selectedCell ?? ''], 3, 1.5],
              }}
            />
          </GeoJSONSource>
        )}
        {locationGranted && <NativeUserLocation />}
      </Map>
      {selected ? (
        <CellCard aggregate={selected} colors={colors} />
      ) : (
        aggregates?.length === 0 && (
          <View style={[styles.card, { backgroundColor: colors.background }]}>
            <Text style={[styles.hint, { color: colors.muted }]}>
              Your measurements appear here. Measure a spot, then add it to the map.
            </Text>
          </View>
        )
      )}
    </View>
  );
}

function CellCard({ aggregate, colors }: { aggregate: CellAggregate; colors: Palette }) {
  const band = loudnessBand(aggregate.laeq);
  return (
    <View style={[styles.card, styles.cellCard, { backgroundColor: colors.background }]}>
      <View style={[styles.swatch, { backgroundColor: band.color }]} />
      <View style={styles.cardText}>
        <Text style={[styles.level, { color: colors.ink }]}>
          {Math.round(aggregate.laeq)} <Text style={[styles.unit, { color: colors.muted }]}>dBA average</Text>
        </Text>
        <Text style={[styles.detail, { color: colors.ink }]}>
          {band.label} · {aggregate.count} {aggregate.count === 1 ? 'measurement' : 'measurements'}
        </Text>
      </View>
    </View>
  );
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
  cardText: { gap: 2 },
  level: { fontSize: 28, fontWeight: '300', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, fontWeight: '400' },
  detail: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
