"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";

export type RealtimeEventType = "message" | "typing" | "read" | "notification";
type Listener = (event: Record<string, unknown>) => void;

interface RealtimeContextValue {
  connected: boolean;
  /** True when no gateway is configured; pages poll instead. */
  polling: boolean;
  subscribe: (type: RealtimeEventType, listener: Listener) => () => void;
  sendTyping: (conversationId: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  polling: true,
  subscribe: () => () => undefined,
  sendTyping: () => undefined,
});

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Subscribe to a realtime event for the lifetime of the component. */
export function useRealtimeEvent(type: RealtimeEventType, listener: Listener): void {
  const { subscribe } = useRealtime();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => subscribe(type, (event) => latest.current(event)), [subscribe, type]);
}

/**
 * One Socket.io connection per tab for signed-in users. New messages and
 * notifications refresh the server-rendered page (badges, threads); typing
 * and read receipts go to subscribed components.
 */
export function RealtimeProvider({ url, children }: { url: string | null; children: ReactNode }) {
  const router = useRouter();
  const listeners = useRef(new Map<RealtimeEventType, Set<Listener>>());
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  }, [router]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void import("socket.io-client").then(({ io }) => {
      if (cancelled) return;
      const socket = io(url, {
        transports: ["websocket", "polling"],
        auth: (callback) => {
          fetch("/api/realtime/ticket", { cache: "no-store" })
            .then((response) => (response.ok ? (response.json() as Promise<{ ticket?: string }>) : { ticket: "" }))
            .then((body) => callback({ ticket: body.ticket ?? "" }))
            .catch(() => callback({ ticket: "" }));
        },
      });
      socketRef.current = socket;
      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));
      for (const type of ["message", "typing", "read", "notification"] as const) {
        socket.on(type, (event: Record<string, unknown>) => {
          listeners.current.get(type)?.forEach((listener) => listener(event));
          if (type === "message" || type === "notification") scheduleRefresh();
        });
      }
    });
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [url, scheduleRefresh]);

  const subscribe = useCallback((type: RealtimeEventType, listener: Listener) => {
    const set = listeners.current.get(type) ?? new Set<Listener>();
    set.add(listener);
    listeners.current.set(type, set);
    return () => {
      set.delete(listener);
    };
  }, []);

  const sendTyping = useCallback((conversationId: string) => {
    socketRef.current?.emit("typing", { conversationId });
  }, []);

  const value = useMemo(() => ({ connected, polling: !url, subscribe, sendTyping }), [connected, url, subscribe, sendTyping]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
