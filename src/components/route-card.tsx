import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { WalkState } from '@/hooks/use-walk-plan';
import type { LngLat } from '@/lib/cells';
import { QUIET_PRESETS, type QuietPreset } from '@/lib/quiet-routes';
import { routeCardLines } from '@/lib/route-card-lines';
import type { Palette } from '@/theme';

export type RouteCardProps = {
  state: WalkState;
  /** Null while the card asks where to start. */
  from: LngLat | null;
  preset: QuietPreset;
  colors: Palette;
  onPreset: (preset: QuietPreset) => void;
  /** Asks for location if needed, then sets `from` to where the phone is. */
  onStartHere: () => void;
  /** Clears the start, so the card asks again and the next long-press sets it. */
  onChangeStart: () => void;
  onSwap: () => void;
  onClose: () => void;
};

/** A walk between two points, or the question of where it starts. Rendered inside the map's bottom card. */
export function RouteCard({
  state,
  from,
  preset,
  colors,
  onPreset,
  onStartHere,
  onChangeStart,
  onSwap,
  onClose,
}: RouteCardProps) {
  const { headline, badge, detail, loud, note } = routeCardLines(from ? state : { kind: 'idle' }, preset);
  // The switch only offers presets that found different routes, so it shows only when there are two.
  const choices = from && state.kind === 'planned' && state.plan.choices.length > 1 ? state.plan.choices : [];

  return (
    <View style={styles.route}>
      <View style={styles.heading}>
        <Text style={[styles.headline, { color: colors.ink }]}>{headline}</Text>
        {badge && (
          <Text style={[styles.badge, { color: colors.onAccent, backgroundColor: colors.accent }]}>{badge}</Text>
        )}
        <Pressable onPress={onClose} style={[styles.textButton, styles.close]} hitSlop={8}>
          <Text style={[styles.textLabel, { color: colors.accent }]}>Close</Text>
        </Pressable>
      </View>
      {detail && <Text style={[styles.detail, { color: colors.ink }]}>{detail}</Text>}
      {loud && <Text style={[styles.detail, { color: colors.ink }]}>{loud}</Text>}
      {choices.length > 0 && (
        <View style={[styles.segments, { backgroundColor: colors.track }]}>
          {choices.map((choice) => {
            const selected = choice.preset === preset;
            return (
              <Pressable
                key={choice.preset}
                onPress={() => onPreset(choice.preset)}
                accessibilityState={{ selected }}
                style={[styles.segment, selected && { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.segmentLabel, { color: selected ? colors.onAccent : colors.ink }]}>
                  {QUIET_PRESETS[choice.preset].label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {!from && (
        <Pressable onPress={onStartHere} style={[styles.button, { backgroundColor: colors.accent }]}>
          <Text style={[styles.buttonLabel, { color: colors.onAccent }]}>From my location</Text>
        </Pressable>
      )}
      {note && <Text style={[styles.note, { color: colors.muted }]}>{note}</Text>}
      {from && (
        <View style={styles.actions}>
          <Pressable onPress={onChangeStart} style={styles.textButton}>
            <Text style={[styles.textLabel, { color: colors.accent }]}>Change start</Text>
          </Pressable>
          <Pressable onPress={onSwap} style={styles.textButton}>
            <Text style={[styles.textLabel, { color: colors.accent }]}>Swap</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  route: { gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headline: { flexShrink: 1, fontSize: 20, fontWeight: '500' },
  badge: {
    fontSize: 13,
    fontWeight: '600',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  detail: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 13, lineHeight: 18 },
  segments: { flexDirection: 'row', borderRadius: 999, padding: 3 },
  segment: { flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentLabel: { fontSize: 15, fontWeight: '600' },
  button: { height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 20 },
  textButton: { minHeight: 32, justifyContent: 'center' },
  close: { marginLeft: 'auto' },
  textLabel: { fontSize: 15, fontWeight: '600' },
});
