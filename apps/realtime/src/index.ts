import "dotenv/config";
import { createServer } from "node:http";
import { Redis } from "ioredis";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "@marketplace/database";
import { isRealtimeEvent, publishToUsers, USER_CHANNEL_PREFIX, verifyRealtimeTicket } from "@marketplace/realtime";

/**
 * Socket.io gateway. Browsers connect with a short-lived ticket signed by the
 * web app; each socket joins its user's room. Events published to Redis by
 * any server process (`rt:user:<id>`) are forwarded to that room, so several
 * gateway instances can run behind a load balancer.
 */

const env = z
  .object({
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must match the web app's"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
    REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  })
  .parse(process.env);

interface SocketData {
  userId: string;
  name: string | null;
  conversations: Set<string>;
  lastTyping: number;
}

const allowedOrigin = new URL(env.NEXT_PUBLIC_APP_URL).origin;

const http = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  response.writeHead(404).end();
});

const io = new Server<Record<string, never>, Record<string, (payload: unknown) => void>, Record<string, never>, SocketData>(http, {
  cors: { origin: allowedOrigin, credentials: false },
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 16_000,
});

io.use(async (socket, next) => {
  const ticket = typeof socket.handshake.auth?.ticket === "string" ? socket.handshake.auth.ticket : "";
  const userId = verifyRealtimeTicket(env.AUTH_SECRET, ticket);
  if (!userId) return next(new Error("unauthorized"));
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, isSuspended: true } }).catch(() => null);
  if (!user || user.isSuspended) return next(new Error("unauthorized"));
  socket.data = { userId, name: user.name, conversations: new Set(), lastTyping: 0 };
  return next();
});

async function isParticipant(socket: Socket<Record<string, never>, Record<string, (payload: unknown) => void>, Record<string, never>, SocketData>, conversationId: string): Promise<boolean> {
  if (socket.data.conversations.has(conversationId)) return true;
  const row = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: socket.data.userId } }, select: { id: true } });
  if (row) socket.data.conversations.add(conversationId);
  return row !== null;
}

io.on("connection", (socket) => {
  void socket.join(`user:${socket.data.userId}`);

  socket.on("typing", async (payload: unknown) => {
    const conversationId = typeof (payload as { conversationId?: unknown })?.conversationId === "string" ? (payload as { conversationId: string }).conversationId : null;
    const now = Date.now();
    if (!conversationId || now - socket.data.lastTyping < 2_000) return;
    socket.data.lastTyping = now;
    if (!(await isParticipant(socket, conversationId))) return;
    const others = await prisma.conversationParticipant.findMany({ where: { conversationId, userId: { not: socket.data.userId } }, select: { userId: true } });
    await publishToUsers(
      others.map((row) => row.userId),
      { type: "typing", conversationId, userId: socket.data.userId, name: socket.data.name },
    );
  });
});

const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
subscriber.on("error", (error: Error) => console.error(`[realtime] Redis error: ${error.message}`));
void subscriber.psubscribe(`${USER_CHANNEL_PREFIX}*`);
subscriber.on("pmessage", (_pattern: string, channel: string, raw: string) => {
  const userId = channel.slice(USER_CHANNEL_PREFIX.length);
  try {
    const event: unknown = JSON.parse(raw);
    if (!userId || !isRealtimeEvent(event)) return;
    io.to(`user:${userId}`).emit(event.type, event);
  } catch {
    // Ignore malformed payloads.
  }
});

http.listen(env.REALTIME_PORT, () => console.log(`[realtime] listening on :${env.REALTIME_PORT}, accepting ${allowedOrigin}`));

const shutdown = (signal: string) => {
  console.log(`[realtime] ${signal} received`);
  io.close();
  subscriber.disconnect();
  void prisma.$disconnect().finally(() => process.exit(0));
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
