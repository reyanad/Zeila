import "server-only";

/** Platform settings live in @marketplace/core so the worker reads the same values. */
export { getSetting, PLATFORM_SETTINGS, setSetting, type SettingName, type SettingValue } from "@marketplace/core";
