"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { axisLabel, layoutColumns, xLabelAnchor, xLabelIndexes } from "@/lib/charts/columns";

export interface DailyValue {
  day: string; // YYYY-MM-DD
  value: number;
}

const HEIGHT = 220;

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Single-series daily column chart with a hover/focus tooltip per column.
 * `divisor` turns stored minor units into display units (100 for money).
 */
export function DailyColumns({ title, points, divisor = 1, unit, emptyLabel }: { title: string; points: DailyValue[]; divisor?: number; unit?: string; emptyLabel: string }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const values = useMemo(() => points.map((point) => point.value / divisor), [points, divisor]);
  const layout = useMemo(() => layoutColumns({ values, width, height: HEIGHT }), [values, width]);
  const labels = useMemo(() => xLabelIndexes(points.length, width < 480 ? 4 : 7), [points.length, width]);
  const tickValues = layout.ticks.map((tick) => tick.value);
  const format = (value: number) => `${unit ? `${unit} ` : ""}${value.toLocaleString("en-US", { maximumFractionDigits: divisor > 1 ? 2 : 0, minimumFractionDigits: divisor > 1 ? 2 : 0 })}`;
  const total = values.reduce((sum, value) => sum + value, 0);
  const hovered = active !== null ? layout.bars[active] : null;
  const hoveredPoint = active !== null ? points[active] : null;

  return (
    <figure className="viz-root flex flex-col gap-2 rounded-lg border border-border p-4" style={{ background: "var(--viz-surface)" }}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--viz-ink)" }}>
          {title}
        </span>
        <span className="text-xs" style={{ color: "var(--viz-ink-2)" }}>
          Total {format(total)}
        </span>
      </figcaption>
      <div ref={wrapper} className="relative" onPointerLeave={() => setActive(null)}>
        {total === 0 ? (
          <p className="flex items-center justify-center text-sm" style={{ height: HEIGHT, color: "var(--viz-ink-2)" }}>
            {emptyLabel}
          </p>
        ) : (
          <svg width={width} height={HEIGHT} role="img" aria-label={`${title}: total ${format(total)} over ${points.length} days`} className="block overflow-visible">
            {layout.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={layout.plotLeft} x2={layout.plotRight} y1={tick.y} y2={tick.y} stroke={tick.value === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={layout.plotLeft - 8} y={tick.y} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)">
                  {axisLabel(tick.value, tickValues)}
                </text>
              </g>
            ))}
            {layout.bars.map((bar) => (
              <path key={bar.index} d={bar.path} fill="var(--viz-series-1)" opacity={active === null || active === bar.index ? 1 : 0.55} />
            ))}
            {labels.map((index) => {
              const bar = layout.bars[index];
              const point = points[index];
              if (!bar || !point) return null;
              const place = xLabelAnchor(index, points.length, bar);
              return (
                <text key={point.day} x={place.x} y={layout.baseline + 16} textAnchor={place.anchor} fontSize={11} fill="var(--viz-muted)">
                  {dayLabel(point.day)}
                </text>
              );
            })}
            {layout.bars.map((bar) => {
              const point = points[bar.index];
              return (
                <rect
                  key={`hit-${bar.index}`}
                  x={bar.bandX}
                  y={layout.plotTop}
                  width={bar.bandWidth}
                  height={layout.baseline - layout.plotTop}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={point ? `${dayLabel(point.day)}: ${format(values[bar.index] ?? 0)}` : undefined}
                  onPointerEnter={() => setActive(bar.index)}
                  onFocus={() => setActive(bar.index)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                />
              );
            })}
          </svg>
        )}
        {hovered && hoveredPoint && total > 0 ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: Math.min(Math.max(hovered.x + hovered.width / 2, 60), width - 60),
              top: Math.max(hovered.y - 8, 28),
              background: "var(--viz-surface)",
            }}
          >
            <span className="block font-semibold tabular-nums" style={{ color: "var(--viz-ink)" }}>
              {format(values[hovered.index] ?? 0)}
            </span>
            <span className="block" style={{ color: "var(--viz-ink-2)" }}>
              {dayLabel(hoveredPoint.day)}
            </span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
