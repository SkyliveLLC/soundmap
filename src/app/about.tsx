import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import { LoudnessLegend } from '@/components/loudness-legend';
import { deviceCalibration } from '@/hooks/use-measurement';
import { clearOutbox } from '@/lib/outbox';
import { STREET_NOISE_RELEASE } from '@/lib/street-noise';
import { usePalette, type Palette } from '@/theme';

// Also the App Store listing's URLs (store.config.json).
const PRIVACY_URL = 'https://github.com/SkyliveLLC/soundmap/blob/main/PRIVACY.md';
const SUPPORT_URL = 'https://github.com/SkyliveLLC/soundmap/issues';

type DeleteState = 'idle' | 'deleting' | 'deleted' | 'offline' | 'failed';

/** How the app works, how accurate it is, the privacy policy, deleting your readings, and data credits. */
export default function AboutScreen() {
  const colors = usePalette();
  const { state, confirmDelete } = useDeleteMine();
  const version = Constants.expoConfig?.version;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.brand, { color: colors.ink }]}>Soundmap</Text>
          {version && <Text style={[styles.muted, { color: colors.muted }]}>Version {version}</Text>}
        </View>

        <Section title="How it works" colors={colors}>
          <Line colors={colors}>
            Measure takes 30 seconds of A-weighted sound on your phone. Add to map shares the levels, never audio, as
            the block you’re on.
          </Line>
          <Line colors={colors}>
            Strong colors are blocks people measured. Faint colors are traffic, rail and aviation noise modeled by the
            US DOT.
          </Line>
          <Line colors={colors}>Long-press the map where you’re going to plan a quiet walk. Walks cover California for now.</Line>
          <LoudnessLegend colors={colors} />
        </Section>

        <Section title="Accuracy" colors={colors}>
          <Line colors={colors}>
            {deviceCalibration.id
              ? `This phone model (${deviceCalibration.model}) is calibrated against a sound level meter. Readings are still phone estimates, usually within a few dB.`
              : `This phone model (${deviceCalibration.model}) isn’t calibrated yet, so its levels are estimates and can be off by several dB.`}
          </Line>
        </Section>

        <Section title="Your data" colors={colors}>
          <Line colors={colors}>
            No account. Your phone shares only what you add to the map, as a block, never your exact position.
          </Line>
          <Action label="Privacy policy" onPress={() => Linking.openURL(PRIVACY_URL)} colors={colors} />
          <Action
            label={state === 'deleting' ? 'Deleting…' : 'Delete my readings'}
            onPress={confirmDelete}
            disabled={state === 'deleting'}
            colors={colors}
          />
          {state !== 'idle' && state !== 'deleting' && <Line colors={colors}>{deleteCopy[state]}</Line>}
        </Section>

        <Section title="Help" colors={colors}>
          <Action label="Help and feedback" onPress={() => Linking.openURL(SUPPORT_URL)} colors={colors} />
        </Section>

        <Section title="Credits" colors={colors}>
          <Line colors={colors}>
            Map data, venues and walking paths © OpenStreetMap contributors, available under the Open Database License.
          </Line>
          <Line colors={colors}>Base map by OpenFreeMap, © OpenMapTiles.</Line>
          <Line colors={colors}>
            Transportation noise from the US DOT Bureau of Transportation Statistics National Transportation Noise Map (
            {STREET_NOISE_RELEASE}).
          </Line>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const deleteCopy: Record<Exclude<DeleteState, 'idle' | 'deleting'>, string> = {
  deleted: 'Your readings are off the map and deleted from our server.',
  offline: 'You’re offline. Readings waiting on this phone were deleted. Try again online to delete the rest.',
  failed: 'Couldn’t delete your readings. Please try again.',
};

/**
 * "Delete my readings": drops the ones still waiting on the phone, then has the server take this anonymous user's
 * readings off the map. Asks first, because it can't be undone.
 */
function useDeleteMine() {
  const db = useSQLiteContext();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const removeMine = useMutation(api.measurements.removeMine);
  const [state, setState] = useState<DeleteState>('idle');

  async function remove() {
    setState('deleting');
    try {
      await clearOutbox(db);
      // Without a user this phone never uploaded anything. Offline, the call would wait for a connection.
      if (isAuthenticated && !convex.connectionState().isWebSocketConnected) {
        setState('offline');
        return;
      }
      if (isAuthenticated) await removeMine();
      setState('deleted');
    } catch (error) {
      console.warn('[about] delete failed', error);
      setState('failed');
    }
  }

  const confirmDelete = () =>
    Alert.alert('Delete my readings?', 'Every reading this phone added comes off the map. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: remove },
    ]);

  return { state, confirmDelete };
}

function Section({ title, colors, children }: { title: string; colors: Palette; children: ReactNode }) {
  return (
    <View style={[styles.section, { borderTopColor: colors.track }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ colors, children }: { colors: Palette; children: ReactNode }) {
  return <Text style={[styles.line, { color: colors.muted }]}>{children}</Text>;
}

function Action({
  label,
  onPress,
  disabled,
  colors,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.actionLabel, { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 28, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20 },
  brand: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  muted: { fontSize: 13 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 16, gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  line: { fontSize: 15, lineHeight: 21 },
  action: { minHeight: 36, justifyContent: 'center' },
  actionLabel: { fontSize: 16, fontWeight: '500' },
});
