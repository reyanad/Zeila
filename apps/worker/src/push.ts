import { prisma } from "@marketplace/database";

/**
 * Expo push delivery. Tickets reporting `DeviceNotRegistered` remove the token
 * (the app was uninstalled or notifications were turned off).
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  title: string;
  body: string | null;
  data: Record<string, string>;
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export async function pushToUser(userId: string, message: PushMessage, accessToken: string | undefined): Promise<number> {
  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return 0;
  const payload = tokens.map((row) => ({
    to: row.token,
    title: message.title.slice(0, 100),
    body: message.body?.slice(0, 180) ?? undefined,
    data: message.data,
    sound: "default",
    priority: "high",
    channelId: "default",
  }));
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429 || response.status >= 500) throw new Error(`Expo push ${response.status}`);
  if (!response.ok) {
    console.error(`[push] Expo rejected the request (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return 0;
  }
  const body = (await response.json()) as { data?: ExpoTicket[] };
  const tickets = body.data ?? [];
  let delivered = 0;
  const stale: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status === "ok") delivered += 1;
    else if (ticket.details?.error === "DeviceNotRegistered") stale.push(payload[index]?.to ?? "");
  });
  if (stale.length > 0) await prisma.pushToken.deleteMany({ where: { token: { in: stale.filter(Boolean) } } });
  return delivered;
}
