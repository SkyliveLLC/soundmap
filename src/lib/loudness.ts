import type { FillLayerSpecification } from '@maplibre/maplibre-react-native';

export type LoudnessBand = { label: string; color: string };

// Upper bounds are exclusive: 45.0 dBA is already "Quiet".
const QUIETER_BANDS = [
  { below: 45, label: 'Very quiet', color: '#1A9850' },
  { below: 55, label: 'Quiet', color: '#66BD63' },
  { below: 65, label: 'Moderate', color: '#E3A21A' },
  { below: 75, label: 'Loud', color: '#F46D43' },
] as const;
const LOUDEST_BAND = { label: 'Very loud', color: '#C62828' };

/** The single dBA scale used for every color and label on the map. */
export function loudnessBand(laeq: number): LoudnessBand {
  return QUIETER_BANDS.find((band) => laeq < band.below) ?? LOUDEST_BAND;
}

type ColorExpression = Extract<NonNullable<FillLayerSpecification['paint']>['fill-color'], unknown[]>;

/**
 * MapLibre color for a feature's `laeq` property, on the same scale as `loudnessBand`.
 * A `step` output applies from its stop upward, matching the exclusive `below` bounds.
 */
export const LOUDNESS_COLOR: ColorExpression = [
  'step',
  ['get', 'laeq'],
  QUIETER_BANDS[0].color,
  ...[...QUIETER_BANDS.slice(1), LOUDEST_BAND].flatMap((band, i) => [QUIETER_BANDS[i].below, band.color]),
];
