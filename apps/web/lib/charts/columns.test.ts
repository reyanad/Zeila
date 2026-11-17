import { describe, expect, it } from "vitest";
import { axisLabel, layoutColumns, niceTicks, xLabelAnchor, xLabelIndexes } from "./columns";

describe("chart axis", () => {
  it("picks clean ticks", () => {
    expect(niceTicks(9_400)).toEqual([0, 2_500, 5_000, 7_500, 10_000]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("labels in full under 10,000 and compact above", () => {
    expect(axisLabel(2_500, [0, 2_500, 5_000])).toBe("2,500");
    expect(axisLabel(20_000, [0, 10_000, 20_000])).toBe("20K");
    expect(axisLabel(0, [0, 10_000])).toBe("0");
    expect(axisLabel(1_500_000, [0, 1_000_000, 2_000_000])).toBe("1.5M");
  });
  it("spreads x labels and keeps edge labels inside the plot", () => {
    expect(xLabelIndexes(30, 7)).toEqual([0, 5, 10, 15, 19, 24, 29]);
    expect(xLabelIndexes(3, 7)).toEqual([0, 1, 2]);
    expect(xLabelAnchor(0, 30, { x: 10, width: 8 }).anchor).toBe("start");
    expect(xLabelAnchor(29, 30, { x: 10, width: 8 }).anchor).toBe("end");
  });
});

describe("column layout", () => {
  const values = Array.from({ length: 30 }, (_, index) => (index % 4) * 1_000);
  const layout = layoutColumns({ values, width: 720, height: 220 });
  it("caps columns at 24px, leaves air and a 2px gap", () => {
    for (const [index, bar] of layout.bars.entries()) {
      expect(bar.width).toBeLessThanOrEqual(24);
      expect(bar.width).toBeLessThan(bar.bandWidth);
      const previous = layout.bars[index - 1];
      if (previous) expect(bar.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(2);
    }
  });
  it("grows every column from the baseline and draws nothing for zero", () => {
    for (const bar of layout.bars) expect(bar.y + bar.height).toBeCloseTo(layout.baseline);
    expect(layout.bars[0]?.path).toBe("");
  });
});
