/**
 * ECharts registration + the option builder for the source × status bar.
 *
 * ECharts registers piecewise rather than via the barrel: the barrel pulls
 * every chart type, component, and both renderers into the bundle (~750KB raw
 * / ~209KB gzip more than this list). The registration list is the charts the
 * page actually draws — a chart type missing from it silently renders empty.
 * This workbench draws exactly one chart, so only BarChart is registered.
 *
 * Option builders are PURE functions of the region rows: region JSON →
 * builder → new option object → <Chart option={...}> replaces wholesale
 * (notMerge). No chart-side state, no imperative update calls.
 */
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export { echarts };
export type { EChartsOption };

// ---------------------------------------------------------------------------
// Graphite palette. Canvas cannot read CSS custom properties, so the chart
// palette exists as JS literals that MIRROR the active Graphite theme — two
// copies is the floor. Keep this block and the theme import in main.tsx in the
// same edit; nothing enforces the pairing but proximity of intent.
//
// Every value below is transcribed verbatim from the Graphite source of truth:
//   frontier-field-note/packages/theme/src/echartsTheme.ts  GRAPHITE_SERIES
//   frontier-field-note/packages/theme/src/graphite.ts      THEMES / MONO_STACK
//   frontier-field-note/packages/theme/src/bridge.css       the status ramp
// The light-mode pairs are the ones here because index.html and main.tsx pin
// mode="light"; the dark pairs are named in the comments so a mode flip is a
// two-line change rather than a re-derivation.
// ---------------------------------------------------------------------------
export const INK = "#0b0f14"; // --ink         (dark: #eef3f8)
export const MUTED_TEXT = "#586471"; // --ink-low     (dark: #8593a0) axis labels
export const SPLIT_LINE = "#c7cfd7"; // --line        (dark: #303b47) grid hairlines
export const SURFACE = "#fcfdfe"; // --bg-1        (dark: #1a212a) tooltip surface
export const LINE_STRONG = "#a9b4bf"; // --line-strong (dark: #46545f) axis pointer

/**
 * GRAPHITE_SERIES.light — the five-step categorical data palette, in order:
 * teal, navy, plum, ochre, brick. The sixth entry is --ink-low: Graphite rations
 * colour, so a sixth series degrades to grey rather than repeating a hue or
 * inventing one. This chart colours by STATUS, so SERIES is only the fallback
 * for a status the map below does not name.
 * Dark: ["#2fb6a4", "#7aa6e0", "#b482cc", "#d6a23f", "#e0635a", "#8593a0"]
 */
export const SERIES = [
  "#0a6961", // teal  — --accent
  "#274d7a", // navy  — --accent-2
  "#6a3f76", // plum
  "#9a5b16", // ochre
  "#a3341f", // brick
  "#586471", // --ink-low (overflow — extras recede, they do not shout)
];

/**
 * One Graphite status hue per triage status, so a status keeps its hue across
 * every bar. The seven triage states map one-to-one onto bridge.css's seven-hue
 * status ramp, which is what that ramp was cut for — a work item that needs a
 * human, a decision that has been made, a thing already closed.
 * `new` and `ignore` are the two greys and must not collide — untriaged still
 * needs the human, dismissed never will — so `new` takes the lighter
 * --line-strong rung and `ignore` the darker --status-closed one. They are the
 * only pair in this map that shares a hue family.
 * Dark: new #46545f, respond #ff3df0, delegate #7aa6e0, defer #d6a23f,
 * done #2fb6a4, ignore #8593a0, handled #b482cc.
 */
export const STATUS_COLORS: Record<string, string> = {
  new: "#a9b4bf", // --line-strong — untriaged, the palest thing in the stack
  respond: "#8f2f86", // --status-needs-human magenta — the human owes a reply
  delegate: "#274d7a", // --status-open navy — handed off, now someone else's queue
  defer: "#7a5512", // --status-in-progress amber — parked, still live
  done: "#0a6961", // --status-done teal — closed by the human
  ignore: "#586471", // --status-closed grey — dismissed
  handled: "#6a3f76", // --status-review plum — the agent found it already dealt with
};

// Draw order for the stack: untriaged at the bottom, agent-closed on top, so a
// bar reads bottom-up as "still needs me → I decided → already dealt with".
export const STATUS_ORDER = [
  "new",
  "respond",
  "delegate",
  "defer",
  "done",
  "ignore",
  "handled",
];

// Graphite's MONO_STACK verbatim. Every chart label is mono at 12px, the floor
// for legible on-canvas text and Graphite's --font-size-xs: data reads in the
// structural face, never the body sans. Canvas text escapes the DOM font census,
// so this constant is the only thing keeping it above the floor.
const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const LABEL_SIZE = 12;

const CHART_TEXT = {
  color: INK,
  fontFamily: MONO_STACK,
  fontSize: LABEL_SIZE,
};

/** Axis labels sit on --ink-low, one rung quieter than the data. */
const AXIS_LABEL = { color: MUTED_TEXT, fontFamily: MONO_STACK, fontSize: LABEL_SIZE };

/**
 * Legend, Graphite-style: roundRect swatches sized to the label, inactive
 * entries fade to the hairline colour rather than disappearing.
 */
const LEGEND = {
  textStyle: { color: "#3b4753", fontFamily: MONO_STACK, fontSize: LABEL_SIZE }, // --ink-mute
  inactiveColor: SPLIT_LINE,
  icon: "roundRect",
  itemWidth: LABEL_SIZE,
  itemHeight: LABEL_SIZE,
} as const;

/**
 * Tooltip on the raised surface with a --line border, Graphite's --shadow-lg,
 * and the 4px --radius. `extraCssText` carries the shadow and radius because
 * ECharts exposes an option for neither. The axis pointer shadow is Graphite's
 * own grid-line wash, so hovering a bar tints the column rather than boxing it.
 */
const TOOLTIP = {
  backgroundColor: SURFACE,
  borderColor: SPLIT_LINE,
  borderWidth: 1,
  padding: [8, 11],
  textStyle: { color: INK, fontFamily: MONO_STACK, fontSize: 12 },
  extraCssText: "box-shadow:0 6px 22px rgba(8,14,22,0.12);border-radius:4px;",
  axisPointer: {
    lineStyle: { color: LINE_STRONG },
    crossStyle: { color: LINE_STRONG },
    shadowStyle: { color: "rgba(120,134,150,0.10)" },
  },
} as const;

/**
 * Split lines are DASHED hairlines in --line — they mark the reading grid without
 * competing with the data. Ticks are off: a tick and a hairline say the same
 * thing twice.
 */
const SPLIT_LINE_STYLE = { show: true, lineStyle: { color: SPLIT_LINE, type: "dashed" } } as const;
const AXIS_LINE = { lineStyle: { color: SPLIT_LINE } } as const;
const AXIS_TICK = { show: false } as const;

// ---------------------------------------------------------------------------
// Builders. Chart titles are HTML headings OUTSIDE the canvas — never the
// ECharts `title` option. Empty state is handled ABOVE the chart (render an
// EmptyState instead of the <Chart>), never inside the option.
// ---------------------------------------------------------------------------

/**
 * Absolute-count stacked bar: one bar per bucket (a work surface), one stack
 * segment per status.
 *
 * Counts rather than 100% share on purpose: the question this panel answers is
 * "how much is piled up on each surface", and normalizing would make a surface
 * with two items look as heavy as one with twenty.
 */
export function stackedCountOption(
  buckets: string[],
  seriesByName: Record<string, number[]>,
): EChartsOption {
  const names = Object.keys(seriesByName);
  return {
    // transparent lets the Graphite card surface show through; a painted chart
    // background would be a fourth surface tone.
    backgroundColor: "transparent",
    textStyle: CHART_TEXT,
    tooltip: { ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { ...LEGEND, top: 0, type: "scroll" },
    // ECharts 6.1.0 deprecates `grid.containLabel`
    // (types/src/coord/cartesian/GridModel.d.ts:22) and logs a console warning
    // for it. These two keys are the equivalent documented on line 35: shrink
    // the plot rect so axis labels stay inside the grid box.
    grid: {
      left: 8,
      right: 12,
      top: 44,
      bottom: 4,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: {
      type: "category",
      data: buckets,
      axisLabel: { ...AXIS_LABEL, interval: 0 },
      axisLine: AXIS_LINE,
      axisTick: AXIS_TICK,
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: AXIS_LABEL,
      // A value axis needs no baseline: the dashed split lines already carry the
      // grid, and Graphite spends a hairline only where it separates something.
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      splitLine: SPLIT_LINE_STYLE,
    },
    series: names.map((name, i) => ({
      name,
      type: "bar",
      stack: "count",
      barWidth: "52%",
      itemStyle: { color: STATUS_COLORS[name] ?? SERIES[i % SERIES.length] },
      emphasis: { focus: "series" },
      data: seriesByName[name],
    })),
  };
}
