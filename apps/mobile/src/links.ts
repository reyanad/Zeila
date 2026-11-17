import * as WebBrowser from "expo-web-browser";
import { API_URL } from "./config";

/** Open a page of the web app (checkout, returns, workspaces) in an in-app browser. */
export async function openWeb(pathOrUrl: string): Promise<void> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_URL}${pathOrUrl}`;
  await WebBrowser.openBrowserAsync(url);
}

/** Map a web path from a notification to an app screen, when the app has one. */
export function appRouteForPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const message = /^\/messages\/([A-Za-z0-9_-]+)$/.exec(path);
  if (message) return `/conversation/${message[1]}`;
  const order = /^\/orders\/([A-Za-z0-9_-]+)(?:\?.*)?$/.exec(path);
  if (order) return `/order/${order[1]}`;
  if (path === "/notifications") return "/alerts";
  if (path === "/messages") return "/messages";
  return null;
}
