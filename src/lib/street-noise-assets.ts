import { Asset } from 'expo-asset';

import { parseStreetNoise, type StreetNoise } from './street-noise.ts';

// App-only: `require` here goes through Metro, which street-noise.ts must stay free of for node:test.
const levels: unknown = require('../../assets/street-noise/levels.json');
// Metro turns an asset require into its numeric registry id. The lint rule's asset list predates
// the 'geojson' entry metro.config.js adds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cellsAsset: number = require('../../assets/street-noise/cells.geojson');

/** Bundled DOT street noise levels, validated once at startup. */
export const STREET_NOISE: StreetNoise = parseStreetNoise(levels);

/**
 * URL of the bundled hexagon polygons, handed straight to a GeoJSONSource so MapLibre loads them natively.
 * Not downloaded first: the raw `uri` works in dev (Metro URL) and in release builds (embedded file).
 */
export const STREET_NOISE_GEOJSON_URI: string = Asset.fromModule(cellsAsset).uri;
