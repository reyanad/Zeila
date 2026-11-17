"use client";

import { useEffect, useState } from "react";

function left(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((endsAt - now) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Live "ends in" timer; renders the end time on the server and ticks in the browser. */
export function Countdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={endsAt} className={className} suppressHydrationWarning>
      {now === null ? new Date(endsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : now >= end ? "ended" : left(end, now)}
    </time>
  );
}
