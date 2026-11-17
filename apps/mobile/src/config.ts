/** The web app's public URL; the app uses its /api/mobile endpoints and opens web pages for checkout. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
