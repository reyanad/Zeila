/** Stat tile: label, value, and an optional delta vs the previous period (arrow + sign, never color alone). */
export function StatTile({ label, value, delta, note }: { label: string; value: string; delta?: { change: number | null; period: string; upIsGood?: boolean }; note?: string }) {
  const change = delta?.change ?? null;
  const good = change === null || change === 0 ? null : (change > 0) === (delta?.upIsGood ?? true);
  return (
    <div className="viz-root flex flex-col gap-1 rounded-lg border border-border p-4" style={{ background: "var(--viz-surface)" }}>
      <span className="text-xs" style={{ color: "var(--viz-ink-2)" }}>
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--viz-ink)" }}>
        {value}
      </span>
      {delta ? (
        <span className="text-xs tabular-nums" style={{ color: good === null ? "var(--viz-ink-2)" : good ? "var(--viz-up)" : "var(--viz-down)" }}>
          {change === null ? `No data for the ${delta.period}` : change === 0 ? `Same as the ${delta.period}` : `${change > 0 ? "▲ +" : "▼ −"}${Math.abs(change)}% vs the ${delta.period}`}
        </span>
      ) : null}
      {note ? (
        <span className="text-xs" style={{ color: "var(--viz-ink-2)" }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
