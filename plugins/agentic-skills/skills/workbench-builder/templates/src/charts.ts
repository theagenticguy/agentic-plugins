/**
 * ECharts registration + option-builder templates.
 *
 * ECharts registers piecewise rather than via the barrel: the barrel pulls
 * every chart type, component, and both renderers into the bundle (~750KB raw
 * / ~209KB gzip more than this list). The registration list is the charts the
 * page actually draws — a new chart type needs its module added here, or it
 * silently renders empty.
 *
 * Option builders are PURE functions of the region rows: region JSON →
 * builder → new option object → <Chart option={...}> replaces wholesale
 * (notMerge). No chart-side state, no imperative update calls.
 */
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
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
 * inventing one.
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
 * Status hues from bridge.css's ramp, mapped onto this workbench's states.
 * A status keeps its hue everywhere it appears, so the donut and any badge read
 * as one language.
 * Dark: open #8593a0 (--status-closed), accepted #2fb6a4, rejected #e0635a.
 */
export const STATUS_COLORS: Record<string, string> = {
  open: "#586471", // --status-closed grey — untriaged, recedes
  accepted: "#0a6961", // --status-done teal
  rejected: "#9a3b33", // --status-blocked brick
};

// Graphite's MONO_STACK verbatim. Every chart label is mono at 11px
// (= Graphite --text-2xs), the convention the Graphite ECharts adapter sets:
// data reads in the structural face, never the body sans.
const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const CHART_TEXT = {
  color: INK,
  fontFamily: MONO_STACK,
  fontSize: 11,
};

/** Axis labels sit on --ink-low, one rung quieter than the data. */
const AXIS_LABEL = { color: MUTED_TEXT, fontFamily: MONO_STACK, fontSize: 11 };

/**
 * Legend, Graphite-style: roundRect swatches at 11x11 (matching the 11px label),
 * inactive entries fade to the hairline colour rather than disappearing.
 */
const LEGEND = {
  textStyle: { color: "#3b4753", fontFamily: MONO_STACK, fontSize: 11 }, // --ink-mute
  inactiveColor: SPLIT_LINE,
  icon: "roundRect",
  itemWidth: 11,
  itemHeight: 11,
} as const;

/**
 * Tooltip on the raised surface with a --line border, Graphite's --shadow-lg,
 * and the 4px --radius. `extraCssText` carries the shadow and radius because
 * ECharts exposes an option for neither.
 */
const TOOLTIP = {
  backgroundColor: SURFACE,
  borderColor: SPLIT_LINE,
  borderWidth: 1,
  padding: [8, 11],
  textStyle: { color: INK, fontFamily: MONO_STACK, fontSize: 12 },
  extraCssText: "box-shadow:0 6px 22px rgba(8,14,22,0.12);border-radius:4px;",
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
// `backgroundColor: transparent` lets the Graphite card surface show through; a
// painted chart background would be a fourth surface tone.
// ---------------------------------------------------------------------------

/** Donut with a big total in the center; per-slice counts live in the legend
 *  (via formatter) so slice labels stay off and nothing truncates. */
export function donutOption(counts: Record<string, number>): EChartsOption {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    backgroundColor: "transparent",
    textStyle: CHART_TEXT,
    tooltip: TOOLTIP,
    legend: {
      ...LEGEND,
      top: 4,
      formatter: (name: string) => `${name}: ${counts[name] ?? 0}`,
    },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        center: ["50%", "58%"],
        label: {
          show: true,
          position: "center",
          ...CHART_TEXT,
          fontSize: 22,
          formatter: () => `${total}`,
        },
        labelLine: { show: false },
        // A 1px --bg-1 gap between slices applies Graphite's hairline logic to the
        // canvas: adjacent hues are separated by the surface, not by a stroke.
        itemStyle: { borderColor: SURFACE, borderWidth: 1 },
        data: Object.entries(counts).map(([name, value]) => ({
          name,
          value,
          itemStyle: { color: STATUS_COLORS[name] ?? SERIES[0] },
        })),
      },
    ],
  };
}

/** 100%-stacked bar: share of each category per x bucket. */
export function stackedShareOption(
  buckets: string[],
  seriesByName: Record<string, number[]>,
): EChartsOption {
  const names = Object.keys(seriesByName);
  return {
    backgroundColor: "transparent",
    textStyle: CHART_TEXT,
    tooltip: {
      ...TOOLTIP,
      valueFormatter: (v) => `${typeof v === "number" ? v.toFixed(1) : v}%`,
    },
    legend: { ...LEGEND, top: 4 },
    // ECharts 6.1.0 deprecates `grid.containLabel`
    // (types/src/coord/cartesian/GridModel.d.ts:22) and logs a console warning
    // for it. These two keys are the equivalent documented on line 35: shrink
    // the plot rect so axis labels stay inside the grid box.
    grid: {
      left: 8,
      right: 16,
      top: 40,
      bottom: 8,
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
      max: 100,
      axisLabel: { ...AXIS_LABEL, formatter: "{value}%" },
      // A value axis needs no baseline: the dashed split lines already carry the
      // grid, and Graphite spends a hairline only where it separates something.
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      splitLine: SPLIT_LINE_STYLE,
    },
    series: names.map((name, i) => ({
      name,
      type: "bar",
      stack: "share",
      itemStyle: { color: SERIES[i % SERIES.length] },
      data: seriesByName[name],
    })),
  };
}

/** Single-series bar with the value printed on top of each bar. */
export function barOption(
  labels: string[],
  values: number[],
  unit = "",
): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: CHART_TEXT,
    tooltip: { ...TOOLTIP, valueFormatter: (v) => `${v}${unit}` },
    // ECharts 6.1.0 deprecates `grid.containLabel`
    // (types/src/coord/cartesian/GridModel.d.ts:22) and logs a console warning
    // for it. These two keys are the equivalent documented on line 35: shrink
    // the plot rect so axis labels stay inside the grid box.
    grid: {
      left: 8,
      right: 16,
      top: 24,
      bottom: 8,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { ...AXIS_LABEL, interval: 0 },
      axisLine: AXIS_LINE,
      axisTick: AXIS_TICK,
    },
    yAxis: {
      type: "value",
      axisLabel: AXIS_LABEL,
      axisLine: { show: false },
      axisTick: AXIS_TICK,
      splitLine: SPLIT_LINE_STYLE,
    },
    series: [
      {
        type: "bar",
        barWidth: "55%",
        itemStyle: { color: SERIES[0] },
        label: { show: true, position: "top", ...CHART_TEXT, formatter: `{c}${unit}` },
        data: values,
      },
    ],
  };
}
