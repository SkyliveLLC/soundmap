import { Camera, Map, NativeUserLocation, type InitialViewState } from '@maplibre/maplibre-react-native';
import { getForegroundPermissionsAsync } from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const SAN_FRANCISCO: InitialViewState = { center: [-122.4194, 37.7749], zoom: 12.5 };

export default function MapScreen() {
  const [locationGranted, setLocationGranted] = useState(false);

  // Only reads the permission: the prompt belongs to "Add to map", where the user asks for it.
  useFocusEffect(
    useCallback(() => {
      getForegroundPermissionsAsync().then(({ granted }) => setLocationGranted(granted));
    }, []),
  );

  return (
    <Map style={styles.map} mapStyle={MAP_STYLE} logo={false}>
      <Camera initialViewState={SAN_FRANCISCO} />
      {locationGranted && <NativeUserLocation />}
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
