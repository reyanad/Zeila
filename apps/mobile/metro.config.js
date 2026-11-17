// Expo's default Metro config understands npm workspaces: shared packages
// (e.g. @marketplace/shared-types) are watched and transpiled from source.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
