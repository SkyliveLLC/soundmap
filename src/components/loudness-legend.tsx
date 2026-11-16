import { StyleSheet, Text, View } from 'react-native';

import { LOUDNESS_SCALE } from '@/lib/loudness';
import type { Palette } from '@/theme';

/** The map's color scale: one swatch per band with its dBA range. */
export function LoudnessLegend({ colors }: { colors: Palette }) {
  return (
    <View
      style={styles.legend}
      accessible
      accessibilityLabel={`Colors: ${LOUDNESS_SCALE.map(({ label, range }) => `${label}, ${range} dBA`).join('; ')}`}
    >
      {LOUDNESS_SCALE.map(({ label, color, range }) => (
        <View key={label} style={styles.band}>
          <View style={[styles.swatch, { backgroundColor: color }]} />
          <Text style={[styles.range, { color: colors.muted }]}>{range}</Text>
        </View>
      ))}
      <Text style={[styles.unit, { color: colors.muted }]}>dBA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  band: { flex: 1, gap: 3 },
  swatch: { height: 6, borderRadius: 3 },
  range: { fontSize: 11, fontVariant: ['tabular-nums'], textAlign: 'center' },
  unit: { fontSize: 11, paddingTop: 9 },
});
