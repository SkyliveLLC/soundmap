import { StyleSheet, Text, View } from 'react-native';

import { loudnessBand } from '@/lib/loudness';
import { formatHour, quietestHour, VENUE_KIND_LABEL, type MeasuredVenue } from '@/lib/venues';
import type { Palette } from '@/theme';

// Bars span this range. Quieter or louder hours pin to the ends rather than leaving the chart.
const CHART_FLOOR_DB = 30;
const CHART_CEILING_DB = 90;
const CHART_HEIGHT = 64;
const AXIS_HOURS = [0, 6, 12, 18];

/** A venue's overall level and its loudness by hour of day. Rendered inside the map's bottom card. */
export function VenueDetail({ venue, colors }: { venue: MeasuredVenue; colors: Palette }) {
  const band = loudnessBand(venue.laeq);
  // The viewer's hour. Bars hold each venue's local hour, so the two agree while the map covers one city.
  const now = new Date().getHours();
  const current = venue.hours[now];
  const quietest = quietestHour(venue.hours);

  return (
    <View style={styles.detail}>
      <View style={styles.heading}>
        <View style={[styles.swatch, { backgroundColor: band.color }]} />
        <View style={styles.headingText}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
            {venue.name}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {VENUE_KIND_LABEL[venue.kind]} · {Math.round(venue.laeq)} dBA average · {venue.count}{' '}
            {venue.count === 1 ? 'measurement' : 'measurements'}
          </Text>
        </View>
      </View>

      <HourChart venue={venue} now={now} colors={colors} />

      <Text style={[styles.line, { color: colors.ink }]}>
        {current
          ? `Now, ${formatHour(now)}: ${Math.round(current.laeq)} dBA · ${loudnessBand(current.laeq).label}`
          : `Nobody has measured at ${formatHour(now)} yet`}
      </Text>
      {quietest && (
        <Text style={[styles.note, { color: colors.muted }]}>
          Quietest at {formatHour(quietest.hour)} · {Math.round(quietest.laeq)} dBA
        </Text>
      )}
    </View>
  );
}

// One bar per hour, colored on the map's loudness scale. Unmeasured hours are a flat tick on the baseline.
function HourChart({ venue, now, colors }: { venue: MeasuredVenue; now: number; colors: Palette }) {
  const measured = venue.hours.flatMap((level, hour) =>
    level ? [`${formatHour(hour)} ${Math.round(level.laeq)} dBA`] : [],
  );
  return (
    <View accessible accessibilityLabel={`Loudness by hour. ${measured.join(', ')}`}>
      <View style={[styles.bars, { borderBottomColor: colors.track }]}>
        {venue.hours.map((level, hour) => (
          <View key={hour} style={styles.slot}>
            <View
              style={[
                styles.bar,
                level
                  ? { height: barHeight(level.laeq), backgroundColor: loudnessBand(level.laeq).color }
                  : { height: 2, backgroundColor: colors.track },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.row}>
        {venue.hours.map((_, hour) => (
          <View key={hour} style={styles.slot}>
            {hour === now && <View style={[styles.nowDot, { backgroundColor: colors.ink }]} />}
          </View>
        ))}
      </View>
      <View style={styles.row}>
        {venue.hours.map((_, hour) => (
          <View key={hour} style={styles.slot}>
            {AXIS_HOURS.includes(hour) && (
              <Text style={[styles.tick, { color: colors.muted }]} numberOfLines={1}>
                {formatHour(hour).replace(' ', '')}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function barHeight(laeq: number): number {
  const share = (laeq - CHART_FLOOR_DB) / (CHART_CEILING_DB - CHART_FLOOR_DB);
  return Math.max(4, Math.min(1, share) * CHART_HEIGHT);
}

const styles = StyleSheet.create({
  detail: { gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  swatch: { width: 14, height: 44, borderRadius: 7 },
  headingText: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '500' },
  meta: { fontSize: 13 },
  bars: { height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  slot: { flex: 1, alignItems: 'center', overflow: 'visible' },
  bar: { width: '70%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  row: { flexDirection: 'row', height: 14, marginTop: 2 },
  // Labels are wider than a slot, so they overflow it, starting at their hour.
  tick: { position: 'absolute', left: 0, width: 40, fontSize: 11 },
  nowDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  line: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 13, lineHeight: 18 },
});
