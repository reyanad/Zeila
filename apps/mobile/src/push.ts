import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Ask for permission and get this device's Expo push token. Returns null on
 * simulators, without a project id, or when the user declines.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Orders and messages", importance: Notifications.AndroidImportance.HIGH });
  }
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("[push] EXPO_PUBLIC_EAS_PROJECT_ID is not set; push notifications are disabled.");
    return null;
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}
