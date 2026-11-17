"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { markReadAction } from "@/lib/actions/messaging";

/** Keeps an open thread current: read receipts, typing indicator, and polling when there is no gateway. */
export function ThreadLive({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { polling, connected } = useRealtime();
  const [typing, setTyping] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void markReadAction(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (!polling && connected) return;
    const interval = setInterval(() => {
      router.refresh();
      void markReadAction(conversationId);
    }, 8_000);
    return () => clearInterval(interval);
  }, [polling, connected, router, conversationId]);

  useRealtimeEvent("message", (event) => {
    if (event.conversationId !== conversationId) return;
    setTyping(null);
    void markReadAction(conversationId);
  });

  useRealtimeEvent("typing", (event) => {
    if (event.conversationId !== conversationId) return;
    setTyping(typeof event.name === "string" && event.name ? event.name : "Someone");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTyping(null), 4_000);
  });

  return (
    <p aria-live="polite" className="h-5 text-xs text-muted-foreground">
      {typing ? `${typing} is typing…` : ""}
    </p>
  );
}
