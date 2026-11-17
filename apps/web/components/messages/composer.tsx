"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { MESSAGE_MAX_LENGTH } from "@marketplace/shared-types";
import { Button, Textarea } from "@marketplace/ui";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { sendMessageAction } from "@/lib/actions/messaging";

export function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { sendTyping } = useRealtime();
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const lastTyping = useRef(0);

  const send = () => {
    if (!body.trim() || pending) return;
    startTransition(async () => {
      setNotice(null);
      const result = await sendMessageAction(conversationId, body);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
        return;
      }
      setBody("");
      if (result.data?.flagged) {
        setNotice({ tone: "warning", text: "Contact details were hidden. Keep payments on the platform so escrow protects you both." });
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <Textarea
        id="composer"
        rows={3}
        maxLength={MESSAGE_MAX_LENGTH}
        placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
        value={body}
        onChange={(event) => {
          setBody(event.currentTarget.value);
          const now = Date.now();
          if (now - lastTyping.current > 2_500) {
            lastTyping.current = now;
            sendTyping(conversationId);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <p role={notice?.tone === "error" ? "alert" : "status"} className={notice?.tone === "error" ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
          {notice?.text ?? "Never pay outside the platform: payments here are held in escrow until you receive what you ordered."}
        </p>
        <Button onClick={send} disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
