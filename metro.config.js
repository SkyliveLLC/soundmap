const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Street noise polygons ship as a file asset so MapLibre parses them natively, off the JS thread.
config.resolver.assetExts.push('geojson');

module.exports = config;
