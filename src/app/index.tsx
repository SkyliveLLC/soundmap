import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  VectorSource,
  type CameraRef,
  type InitialViewState,
  type ViewState,
} from '@maplibre/maplibre-react-native';
import { useQuery } from 'convex/react';
import { getForegroundPermissionsAsync, getLastKnownPositionAsync } from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { cellToLatLng } from 'h3-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import { MAX_REGIONS, cellAt, cellPolygon, cellsToGeoJSON, regionsIn, type CellAggregate } from '@/lib/cells';
import { LOUDNESS_COLOR, loudnessBand, type LoudnessBand } from '@/lib/loudness';
import {
  BLOCK_ZOOM,
  DOT_FLOOR_DB,
  NOISE_LAYER,
  STREET_NOISE_RELEASE,
  STREET_NOISE_TILES,
  readCell,
  type CellReading,
  type StreetLevel,
} from '@/lib/street-noise';
import { streetNoiseReader } from '@/lib/street-noise-tiles';
import { usePalette, type Palette } from '@/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
// The lower 48, for a launch that doesn't know where you are.
const CONTINENTAL_US: InitialViewState = { center: [-98.6, 39.8], zoom: 3 };
const LOCAL_ZOOM = 13;
const CELL_ZOOM = 15;
// Measured hexagons are blocks, too small to see further out, so the map only loads them from here in.
const MEASURED_ZOOM = 10;
// Until the tiles answer, a card shows only what was measured.
const UNKNOWN_STREET: StreetLevel = { kind: 'not-covered' };
const readStreet = streetNoiseReader(STREET_NOISE_TILES);

export default function MapScreen() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  // The selected cell lives in the route so "Added to map · View" can open the map on it.
  const { cell: selectedCell } = useLocalSearchParams<{ cell?: string }>();
  const [initialCell] = useState(selectedCell);
  const [view, setView] = useState<Pick<ViewState, 'zoom' | 'bounds'>>();
  const aggregates = useMeasuredCells(view);
  // Street noise of the selected cell, read from the tiles.
  const [street, setStreet] = useState<{ cell: string; level: StreetLevel }>();
  const [locationGranted, setLocationGranted] = useState(false);
  // The cell the last map tap selected. Only selections from elsewhere ("View") move the camera.
  const tappedCell = useRef<string | undefined>(undefined);

  // "Add to map" may have just granted location. Only reads the permission: the prompt belongs to "Add to map".
  useFocusEffect(
    useCallback(() => {
      getForegroundPermissionsAsync().then(({ granted }) => setLocationGranted(granted));
    }, []),
  );

  // Opens where you are when the phone already knows it, unless the map was opened on a cell.
  useEffect(() => {
    if (initialCell) return;
    getForegroundPermissionsAsync()
      .then(({ granted }) => (granted ? getLastKnownPositionAsync() : null))
      .then((position) => {
        if (!position) return;
        const { longitude, latitude } = position.coords;
        camera.current?.jumpTo({ center: [longitude, latitude], zoom: LOCAL_ZOOM });
      });
  }, [initialCell]);

  useEffect(() => {
    const fromTap = selectedCell === tappedCell.current;
    tappedCell.current = undefined;
    if (!selectedCell || fromTap) return;
    const [latitude, longitude] = cellToLatLng(selectedCell);
    camera.current?.flyTo({ center: [longitude, latitude], zoom: CELL_ZOOM, duration: 800 });
  }, [selectedCell]);

  // A failed read (offline) leaves the street noise unknown, so the card shows only what was measured.
  useEffect(() => {
    if (!selectedCell) return;
    let current = true;
    readStreet(selectedCell)
      .then((level) => current && setStreet({ cell: selectedCell, level }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [selectedCell]);

  const readingAt = (cell: string, level = street?.cell === cell ? street.level : undefined) =>
    readCell(
      cell,
      aggregates?.find((aggregate) => aggregate.cell === cell),
      level ?? UNKNOWN_STREET,
    );
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
        // Any tap selects the block under it, so a quiet street can answer too. A block with nothing to
        // show clears the card instead: unmeasured and outside the DOT area, or too far out to see,
        // where the colors are areas rather than blocks.
        onPress={async (event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat;
          const cell = cellAt(latitude, longitude);
          const level = (view?.zoom ?? 0) >= BLOCK_ZOOM ? await readStreet(cell).catch(() => undefined) : undefined;
          if (level) setStreet({ cell, level });
          tappedCell.current = readingAt(cell, level) ? cell : undefined;
          router.setParams({ cell: tappedCell.current });
        }}
        onRegionDidChange={({ nativeEvent: { zoom, bounds } }) => setView({ zoom, bounds })}
      >
        <Camera ref={camera} initialViewState={initialViewOf(initialCell)} />
        <VectorSource id="street-noise" url={STREET_NOISE_TILES}>
          <Layer
            id="street-noise-fill"
            type="fill"
            source-layer={NOISE_LAYER}
            paint={{ 'fill-color': LOUDNESS_COLOR, 'fill-opacity': 0.28 }}
          />
        </VectorSource>
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

function initialViewOf(cell: string | undefined): InitialViewState {
  if (!cell) return CONTINENTAL_US;
  const [latitude, longitude] = cellToLatLng(cell);
  return { center: [longitude, latitude], zoom: CELL_ZOOM };
}

/**
 * Everyone's measured hexagons in view, kept live by Convex. Undefined until the first result. Keeps
 * showing the last result while a panned-to view loads, and when zoomed out too far to load any.
 */
function useMeasuredCells(view: Pick<ViewState, 'zoom' | 'bounds'> | undefined): CellAggregate[] | undefined {
  const regions = view && view.zoom >= MEASURED_ZOOM ? regionsIn(view.bounds) : [];
  const latest = useQuery(
    api.measurements.cells,
    regions.length > 0 && regions.length <= MAX_REGIONS ? { regions } : 'skip',
  );
  const [shown, setShown] = useState(latest);
  if (latest !== undefined && latest !== shown) setShown(latest);
  return shown;
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
  const source = `US DOT ${STREET_NOISE_RELEASE}`;
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
