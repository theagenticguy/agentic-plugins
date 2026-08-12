# Rendering — markdown, diagrams, charts, and disclosure in React

The rendering layer of a workbench is React components composed from three sources: Astryx's own content components (`Markdown`, `CodeBlock`), a thin `<Mermaid>` wrapper over the mermaid npm package, and an ECharts wrapper + pure option builders. Everything renders as element trees or into refs — there is no `innerHTML` pipeline and no sanitizer to configure.

Reference implementations: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/src/` (all of it) and the generalized copies in `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/templates/src/`.

## Contents

- Markdown: use Astryx's component
- Mermaid: a ref-rendered wrapper
- ECharts: registration, wrapper, builders
- The palette pairing rule
- Progressive disclosure
- Layout overflow guards
- Checklist

## Markdown: use Astryx's component

`@astryxdesign/core/Markdown` renders GFM — headings, lists, tables, fenced code with highlighting, citations, even a streaming mode — as Astryx-styled React elements:

```tsx
import { Markdown } from "@astryxdesign/core/Markdown";

<Markdown headingLevelStart={3} density="compact">{someGfmString}</Markdown>
```

- `headingLevelStart` shifts `#` down to fit the page hierarchy — set it so markdown headings land under your section's real heading level.
- `contentWidth` (default 680) keeps prose at a readable measure; tables and code expand to the container.
- Use it for agent-generated content and notes. For hand-authored layout, use `Text`/`Heading` directly.
- Standalone code (not inside markdown) gets `CodeBlock` — line numbers, copy button, language label, `highlightLines`.

Because the output is an element tree, SSE-driven re-renders just work: new region JSON → new props → React reconciles. There is no "re-run the pipeline after swap" step to forget.

## Mermaid: a ref-rendered wrapper

Mermaid stays an npm import wrapped once (`templates/src/components/Mermaid.tsx`):

```tsx
// `theme: "base"` is the only mermaid theme that honours themeVariables; the
// named themes ("neutral", "dark", …) ignore them. The values are Graphite
// literals, same pairing rule as the chart palette below.
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    background: "#fcfdfe",       // --bg-1
    primaryColor: "#dadfe5",     // --bg-2, node fill
    primaryBorderColor: "#a9b4bf", // --line-strong
    primaryTextColor: "#0b0f14", // --ink
    lineColor: "#586471",        // --ink-low
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px",            // --text-sm
  },
});

export function Mermaid({ source }: { readonly source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    let alive = true;
    mermaid.render(`mm-${id}`, source)
      .then(({ svg }) => { if (alive && ref.current) ref.current.innerHTML = svg; })
      .catch((e) => { if (alive && ref.current) ref.current.textContent = `mermaid: ${e}`; });
    return () => { alive = false; };
  }, [source, id]);
  return <div ref={ref} style={{ minWidth: 0, overflowX: "auto" }} />;
}
```

Load-bearing details:

- `startOnLoad: false` — rendering is explicit, per component.
- The render id must be unique per instance (`useId()`), or concurrent renders clobber each other.
- **Mermaid measures itself, so it must mount into a visible box.** Rendering inside a closed Collapsible/Dialog yields a 0×0 SVG that Playwright reports as hidden. Mount conditionally — render the disclosure body only while open (`Detail` in `eval-viewer/src/components/EvalBoard.tsx`).

To render mermaid fences that arrive *inside* markdown, split the string on `` ```mermaid `` fences and interleave `<Markdown>` and `<Mermaid>` segments — `NoteBody` in `eval-viewer/src/components/EvalBoard.tsx` is the worked example.

## ECharts: registration, wrapper, builders

Three pieces, all in the templates.

**1. Piecewise registration** (`templates/src/charts.ts`). ECharts registers per chart type; the `echarts` barrel pulls every chart, component, and both renderers into the bundle (~750KB raw / ~209KB gzip more than a typical list):

```ts
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, PieChart, GridComponent,
             TooltipComponent, LegendComponent, CanvasRenderer]);
```

The registration list is the charts the page actually draws — **a chart type missing from the list silently renders empty.** Add `HeatmapChart` + `VisualMapComponent` when a recipe needs a heatmap. The `EChartsOption` *type* imports from the `"echarts"` barrel (type-only, erased at build).

**2. The wrapper** (`templates/src/components/Chart.tsx`) — init once, `setOption` on change, resize with the box:

```tsx
export function Chart({ option, height = 260 }: { option: EChartsOption; height?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current!);
    return () => { observer.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
```

`notMerge: true` replaces the whole option, so a fresh object identity per render IS the update mechanism — no imperative `.update()` lifecycle, no chart-side state.

**3. Pure option builders** (`templates/src/charts.ts`): `(rows) => EChartsOption` functions. Region JSON → builder → new option → wholesale replace. Shipped builders: `donutOption` (center total, per-slice counts in the legend via `formatter` so slice labels stay off), `stackedShareOption` (100%-stacked bars), `barOption` (single series, values printed on the bars). Wire-up is one line:

```tsx
const s = useRegion<Summary>("summary");
<Chart option={donutOption({ pass: s.pass, fail: s.fail })} height={200} />
```

Conventions: chart titles are HTML headings OUTSIDE the canvas, never the ECharts `title` option. Empty state renders ABOVE the chart (an `EmptyState` instead of the `<Chart>`), never inside the option. ECharts callback params are typed as a union too wide to destructure — cast through `as unknown as { data: [...] }` when a formatter needs the datum.

## The palette pairing rule

Canvas cannot read CSS custom properties, so chart colors cannot come from the Astryx theme at runtime. The palette exists twice by design: once as theme CSS, once as JS literals in `charts.ts`. **Two copies is the floor.** Keep the `charts.ts` palette block and the theme import in `main.tsx` in the same edit — nothing enforces the pairing but proximity.

The literals are TRANSCRIBED from Graphite, not eyeballed. Each name maps to a Graphite token, and the comment beside it says which:

| `charts.ts`     | Graphite source                             | Light / dark          |
| --------------- | ------------------------------------------- | --------------------- |
| `INK`           | `--ink`                                     | `#0b0f14` / `#eef3f8` |
| `MUTED_TEXT`    | `--ink-low` (axis labels)                   | `#586471` / `#8593a0` |
| `SPLIT_LINE`    | `--line` (grid hairlines)                   | `#c7cfd7` / `#303b47` |
| `SURFACE`       | `--bg-1` (tooltip surface)                  | `#fcfdfe` / `#1a212a` |
| `LINE_STRONG`   | `--line-strong` (axis pointer)              | `#a9b4bf` / `#46545f` |
| `SERIES`        | `GRAPHITE_SERIES` + `--ink-low` at overflow | see below             |
| `STATUS_COLORS` | the `bridge.css` status ramp                | per status            |
| `CHART_TEXT`    | `MONO_STACK` at a literal 12px              | mode-invariant        |

`SERIES` is `GRAPHITE_SERIES` verbatim — teal `#0a6961`, navy `#274d7a`, plum `#6a3f76`, ochre `#9a5b16`, brick `#a3341f` — with `--ink-low` `#586471` as the overflow entry, so a sixth series recedes to grey instead of repeating a loud hue or inventing one. Graphite rations colour; the chart palette inherits that discipline.

Four adapter conventions travel with the palette, ported from Graphite's own ECharts adapter (`frontier-field-note/packages/theme/src/echartsTheme.ts`):

1. **`backgroundColor: "transparent"`** — the Graphite card surface shows through. A painted chart background would be a fourth surface tone.
2. **Split lines are DASHED hairlines in `--line`**, and `axisTick` is off: a tick and a hairline say the same thing twice. A value axis also drops its baseline, because the split lines already carry the grid.
3. **Tooltip on `--bg-1` with a `--line` border**, plus Graphite's `--shadow-lg` and 4px `--radius` through `extraCssText` — ECharts exposes an option for neither.
4. **Legend swatches are `roundRect` sized to the label**, matching the 12px mono text, with `inactiveColor` on the hairline so a toggled-off series fades rather than disappears. Chart labels render into canvas where no CSS floor reaches them — 12px is the theme ramp's minimum, held by hand in `charts.ts`.

A `STATUS_COLORS` key that no caller passes falls through to `SERIES[0]`, painting every slice one colour — so the keys and the call sites move together. eval-viewer keys on the outcome names the rows carry (`pending`/`pass`/`fail`) plus the run-history series names (`passed`/`failed`); triage-workbench maps its seven triage states onto the seven-hue status ramp.

## Progressive disclosure

Dense surfaces collapse behind Astryx disclosure components — all plain React state, no DOM stashing:

- **Inline expand:** `Collapsible` (`trigger` prop, controlled via `isOpen`/`onOpenChange`). The eval viewer's per-row `detail` is the worked example.
- **Modal:** `Dialog` (`isOpen`, `onOpenChange`, `purpose="form"` to stop backdrop-close on forms).
- **Custom popover:** position: fixed + a Card, driven by state — doc-review's selection compose popover (`doc-review/src/components/Document.tsx`).

One rule spans all of them: **content that measures itself (mermaid, ECharts) mounts only while the disclosure is open.** Render the body conditionally (`{isOpen && <...>}`), not merely hidden — a chart initialized in a 0-height box draws nothing.

## Layout overflow guards

Grid/flex items default to `min-width: auto` and refuse to shrink below content, so wide tables, code, and diagrams escape their panel. On every column that renders rich content, set `min-width: 0` on the wrapping div (see the grid split in `eval-viewer/src/App.tsx`). The `<Mermaid>` wrapper carries its own `minWidth: 0` + `overflowX: auto`. Astryx `Markdown` constrains prose via `contentWidth` but lets tables expand — the column guard is what keeps them inside the panel.

## Checklist

- Every Astryx component's props confirmed via `bunx astryx component <Name>` (see `dependencies.md`).
- Every chart type drawn is in the `echarts.use([...])` list.
- Option builders are pure functions of region rows; the `<Chart>` wrapper is the only stateful chart code.
- Chart palette literals are transcribed from Graphite, with the source token named per line; palette and theme import live in the same commit.
- Mermaid/charts mount only into visible boxes.
- `min-width: 0` on rich-content grid columns.
- Seeds exercise every render path on first boot (see the seed doctrine in `architecture.md`).
