import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAddToMap } from '@/hooks/use-add-to-map';
import {
  FRAME_SEC,
  SESSION_FRAMES,
  useMeasurement,
  type FailureReason,
  type MeasurementState,
} from '@/hooks/use-measurement';
import type { NoiseSummary } from '@/lib/acoustics';
import { SESSION_SEC } from '@/lib/measurement';
import { usePalette, type Palette } from '@/theme';

export default function MeasureScreen() {
  const colors = usePalette();
  const { state, start, cancel } = useMeasurement();
  // Once a summary is on screen, "Add to map" is the primary action.
  const quiet = state.status === 'measuring' || state.status === 'done';

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: colors.ink }]}>Soundmap</Text>
        <View style={[styles.pill, { borderColor: colors.muted }]}>
          <Text style={[styles.pillText, { color: colors.muted }]}>UNCALIBRATED</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Body state={state} colors={colors} />
      </View>

      {state.status === 'denied' && (
        <Pressable onPress={() => Linking.openSettings()} style={styles.secondaryButton}>
          <Text style={[styles.secondaryLabel, { color: colors.accent }]}>Open Settings</Text>
        </Pressable>
      )}
      <Pressable
        onPress={state.status === 'measuring' ? cancel : start}
        style={({ pressed }) => [
          styles.button,
          quiet
            ? { borderWidth: 1, borderColor: colors.muted }
            : { backgroundColor: colors.accent },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: quiet ? colors.ink : colors.onAccent }]}>
          {buttonLabel[state.status]}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const buttonLabel: Record<MeasurementState['status'], string> = {
  idle: 'Start measuring',
  measuring: 'Cancel',
  done: 'Measure again',
  denied: 'Try again',
  failed: 'Try again',
};

const failureCopy: Record<FailureReason, string> = {
  'no-input': 'No microphone is available on this device.',
  unexpected: 'Something went wrong while measuring. Please try again.',
};

function Body({ state, colors }: { state: MeasurementState; colors: Palette }) {
  switch (state.status) {
    case 'idle':
      return (
        <>
          <Readout value={null} colors={colors} />
          <Caption colors={colors}>
            Hold your phone still for {SESSION_SEC} seconds. Sound is measured on your phone and never recorded.
          </Caption>
        </>
      );
    case 'measuring': {
      const frames = state.levels.length;
      return (
        <>
          <Readout value={state.levels.at(-1) ?? null} colors={colors} />
          <View style={[styles.track, { backgroundColor: colors.track }]}>
            <View style={[styles.fill, { backgroundColor: colors.accent, width: `${(frames / SESSION_FRAMES) * 100}%` }]} />
          </View>
          <Caption colors={colors}>
            Listening · {Math.floor(frames * FRAME_SEC)} of {SESSION_SEC} s
          </Caption>
        </>
      );
    }
    case 'done':
      return (
        <>
          <Summary summary={state.summary} colors={colors} />
          <AddToMap summary={state.summary} colors={colors} />
        </>
      );
    case 'denied':
      return (
        <Caption colors={colors}>
          Soundmap needs the microphone to measure noise. Turn it on in Settings, then try again.
        </Caption>
      );
    case 'failed':
      return <Caption colors={colors}>{failureCopy[state.reason]}</Caption>;
  }
}

function Readout({ value, colors }: { value: number | null; colors: Palette }) {
  return (
    <View style={styles.readout}>
      <Text style={[styles.readoutValue, { color: colors.ink }]}>{value === null ? '—' : Math.round(value)}</Text>
      <Text style={[styles.readoutUnit, { color: colors.muted }]}>dBA</Text>
    </View>
  );
}

function Summary({ summary, colors }: { summary: NoiseSummary; colors: Palette }) {
  const stats = [
    { label: 'Loud moments', detail: 'L10', value: summary.l10 },
    { label: 'Background', detail: 'L90', value: summary.l90 },
    { label: 'Peak', detail: 'LAmax', value: summary.lamax },
    { label: 'Spikiness', detail: 'L10 − L90', value: summary.l10 - summary.l90 },
  ];
  return (
    <>
      <Readout value={summary.laeq} colors={colors} />
      <Caption colors={colors}>Average (LAeq) over {Math.round(summary.durationSec)} s</Caption>
      <View style={styles.grid}>
        {stats.map((stat) => (
          <View key={stat.detail} style={[styles.stat, { borderColor: colors.track }]}>
            <Text style={[styles.statValue, { color: colors.ink }]}>{stat.value.toFixed(1)}</Text>
            <Text style={[styles.statLabel, { color: colors.ink }]}>{stat.label}</Text>
            <Text style={[styles.statDetail, { color: colors.muted }]}>{stat.detail}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function AddToMap({ summary, colors }: { summary: NoiseSummary; colors: Palette }) {
  const { state, add } = useAddToMap(summary);
  switch (state.status) {
    case 'idle':
    case 'locating':
      return (
        <View>
          <Caption colors={colors}>Shared anonymously on the public map, as the block you’re on.</Caption>
          <Pressable
            onPress={add}
            disabled={state.status === 'locating'}
            style={({ pressed }) => [
              styles.button,
              styles.shareButton,
              { backgroundColor: colors.accent },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.buttonLabel, { color: colors.onAccent }]}>
              {state.status === 'idle' ? 'Add to map' : 'Finding your location…'}
            </Text>
          </Pressable>
        </View>
      );
    case 'saved':
      return (
        <Pressable
          onPress={() => router.navigate({ pathname: '/', params: { cell: state.cell } })}
          style={({ pressed }) => [styles.button, { borderWidth: 1, borderColor: colors.accent }, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.accent }]}>Added to map · View</Text>
        </Pressable>
      );
    case 'queued':
      return (
        <View style={styles.queued}>
          <Caption colors={colors}>Saved. It will appear on the map when you’re back online.</Caption>
        </View>
      );
    case 'denied':
      return (
        <View>
          <Caption colors={colors}>Location is off for Soundmap, so this measurement was not added to the map.</Caption>
          <Pressable onPress={() => Linking.openSettings()} style={styles.secondaryButton}>
            <Text style={[styles.secondaryLabel, { color: colors.accent }]}>Open Settings</Text>
          </Pressable>
        </View>
      );
    case 'failed':
      return (
        <View>
          <Caption colors={colors}>Could not add this measurement to the map.</Caption>
          <Pressable onPress={add} style={styles.secondaryButton}>
            <Text style={[styles.secondaryLabel, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      );
  }
}

function Caption({ children, colors }: { children: ReactNode; colors: Palette }) {
  return <Text style={[styles.caption, { color: colors.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 28, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 },
  brand: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2 },
  body: { flex: 1, justifyContent: 'center', gap: 24 },
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8 },
  readoutValue: { fontSize: 120, fontWeight: '200', letterSpacing: -4, fontVariant: ['tabular-nums'] },
  readoutUnit: { fontSize: 22, fontWeight: '400' },
  caption: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  stat: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: 16, gap: 2 },
  statValue: { fontSize: 28, fontWeight: '300', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 15, fontWeight: '500' },
  statDetail: { fontSize: 12, letterSpacing: 0.4 },
  button: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 17, fontWeight: '600' },
  shareButton: { marginTop: 12 },
  queued: { height: 56, justifyContent: 'center' },
  secondaryButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  secondaryLabel: { fontSize: 16, fontWeight: '500' },
});
