import type { ExpoConfig } from "expo/config";

/**
 * EXPO_PUBLIC_API_URL: the web app's public URL (the app talks to /api/mobile/*).
 * EXPO_PUBLIC_EAS_PROJECT_ID: needed for push notifications on real devices.
 */
const config: ExpoConfig = {
  name: "Zeila",
  slug: "zeila",
  scheme: "zeila",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.zeila.app", supportsTablet: true },
  android: { package: "com.zeila.app" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { color: "#2a78d6" }],
  ],
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? undefined },
  },
};

export default config;
