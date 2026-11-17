/**
 * Geometry for a single-series column chart (pure, shared by the React chart
 * and its tests). Columns are at most 24px wide with a 2px surface gap,
 * rounded 4px at the data end and square on the baseline; the y axis uses
 * 3–5 clean ticks.
 */

export interface ColumnInput {
  values: readonly number[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
}

export interface ColumnBar {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Hit target: the whole band, full plot height. */
  bandX: number;
  bandWidth: number;
  path: string;
}

export interface ColumnLayout {
  bars: ColumnBar[];
  ticks: Array<{ value: number; y: number }>;
  baseline: number;
  plotTop: number;
  plotLeft: number;
  plotRight: number;
  max: number;
}

export const DEFAULT_MARGIN = { top: 12, right: 8, bottom: 24, left: 52 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** A "nice" step (1, 2, 2.5 or 5 × 10^n) giving about `count` intervals up to `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  if (ticks[ticks.length - 1]! < max) ticks.push(Number((ticks[ticks.length - 1]! + step).toFixed(10)));
  return ticks;
}

/** Axis label: in full under 10,000, compact above (12K, 1.5M). */
export function axisLabel(value: number, ticks: readonly number[]): string {
  if (value === 0) return "0";
  const top = ticks[ticks.length - 1] ?? value;
  if (top < 10_000) return Math.round(value).toLocaleString("en-US");
  if (top < 1_000_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
}

function columnPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const r = Math.min(RADIUS, width / 2, height);
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${bottom}`,
    "Z",
  ].join(" ");
}

export function layoutColumns(input: ColumnInput): ColumnLayout {
  const margin = input.margin ?? DEFAULT_MARGIN;
  const plotLeft = margin.left;
  const plotRight = Math.max(plotLeft + 1, input.width - margin.right);
  const plotTop = margin.top;
  const baseline = Math.max(plotTop + 1, input.height - margin.bottom);
  const dataMax = Math.max(0, ...input.values);
  const tickValues = niceTicks(dataMax);
  const max = tickValues[tickValues.length - 1] ?? 1;
  const plotHeight = baseline - plotTop;
  const band = (plotRight - plotLeft) / Math.max(1, input.values.length);
  // Leave air in every band (bars never fill their slot), and at least the 2px surface gap.
  const barWidth = Math.max(1, Math.min(MAX_BAR, band * 0.7, band - GAP));
  const bars = input.values.map((value, index) => {
    const height = max > 0 ? (Math.max(0, value) / max) * plotHeight : 0;
    const x = plotLeft + index * band + (band - barWidth) / 2;
    const y = baseline - height;
    return { index, x, y, width: barWidth, height, bandX: plotLeft + index * band, bandWidth: band, path: columnPath(x, y, barWidth, height) };
  });
  return { bars, ticks: tickValues.map((value) => ({ value, y: baseline - (value / max) * plotHeight })), baseline, plotTop, plotLeft, plotRight, max };
}

/** Indexes of x labels to print so they never crowd: first, last and evenly spaced between. */
export function xLabelIndexes(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const step = (count - 1) / (maxLabels - 1);
  return [...new Set(Array.from({ length: maxLabels }, (_, index) => Math.round(index * step)))];
}

/** Edge labels align inward so they are never cut off by the plot edge. */
export function xLabelAnchor(index: number, count: number, bar: { x: number; width: number }): { x: number; anchor: "start" | "middle" | "end" } {
  if (count > 1 && index === 0) return { x: bar.x, anchor: "start" };
  if (count > 1 && index === count - 1) return { x: bar.x + bar.width, anchor: "end" };
  return { x: bar.x + bar.width / 2, anchor: "middle" };
}
