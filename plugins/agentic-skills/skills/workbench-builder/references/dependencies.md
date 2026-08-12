# Dependencies — the pinned blessed set

A workbench's entire dependency policy is one committed `package.json` with **exact pins** plus its `bun.lock`. No CDN tags, no floating ranges, no auto-install. `bun install` runs once at scaffold (cold ~5–15s, warm cache ~1–3s); after that `bun --hot server.ts` is the only command. The doctrine is *zero build config* — no bundler, no Vite, no tsconfig ceremony — not zero install.

## Contents

- The blessed set
- Why exact pins
- Astryx grounding: query the manifest, never memory
- Themes: Graphite is canonical
- What not to add

## The blessed set

The canonical `package.json` lives at `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/templates/package.json`. Versions below are the pins verified in-browser for the reference implementations; keep a workbench's pins in sync with the template unless it drops a library.

| Package              | Pin       | Job                | Notes                                                                                                                                                                                                                             |
| -------------------- | --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom` | `19.2.8`  | UI runtime         | React ≥19 is an Astryx peer-dependency floor.                                                                                                                                                                                     |
| `@astryxdesign/core` | `0.3.0`   | Components         | Per-component subpath imports: `import {Button} from '@astryxdesign/core/Button'`. Includes a full `Markdown` component (GFM, tables, code, streaming) and `CodeBlock` — no separate markdown/sanitizer/highlighter stack needed. |
| *(no theme package)* | —         | Design tokens      | Graphite is a custom `defineTheme` theme whose built artifacts are committed into each workbench's `src/theme/`; nothing to install. See Themes below.                                                                            |
| `@astryxdesign/cli`  | `0.3.0`   | Component manifest | Powers `bunx astryx component <Name> --json` — the offline grounding path.                                                                                                                                                        |
| `echarts`            | `6.1.0`   | Charts             | Piecewise-registered via `echarts/core` (see `rendering.md`); the barrel import costs ~750KB raw / ~209KB gzip more.                                                                                                              |
| `mermaid`            | `11.16.1` | Diagrams           | Wrapped in a `<Mermaid>` component (`templates/src/components/Mermaid.tsx`).                                                                                                                                                      |

Drop what a recipe doesn't use: doc-review ships without `echarts` and `mermaid` (`doc-review/package.json`). Bun's per-request bundling means unimported packages cost nothing at runtime, but a trimmed manifest documents intent and speeds the install.

Markdown, sanitization, and syntax highlighting all come from Astryx's `Markdown`/`CodeBlock` components — they build a React element tree, so there is no `innerHTML` path and no sanitizer to configure.

## Why exact pins

`@astryxdesign/core` is beta (0.x): a floating `^0.3.0` can pull a breaking 0.4 mid-session and turn a working workbench into a pile of prop errors. Exact pins plus a committed `bun.lock` make every `bun install` reproduce the verified state. When bumping, bump deliberately: change the pin, `bun install`, re-run the Phase 4 headless verification.

## Astryx grounding: query the manifest, never memory

Astryx component APIs are queried, not recalled. Before writing any JSX that uses a component, confirm its import path and props:

```bash
bunx astryx component <Name> --detail brief    # signature + import in ~6 lines
bunx astryx component <Name> --json            # full typed manifest
bunx astryx component --list                   # everything available
bunx astryx search "<need>"                    # ranked components/hooks/templates
bunx astryx docs layout                        # reference docs (color, layout, icons…)
```

The CLI reads manifests from the installed `node_modules`, so it works offline and always matches the pinned version. Real examples of why this matters: `Collapsible` takes `trigger`, not `label`; `Button` takes `label`, not children; `TextArea`'s change handler is `changeAction(value)`, not `onChange(event)`; `Grid` takes numeric `columns` only (fr-ratio splits need plain CSS grid). Every component prop in the reference implementations was confirmed against the manifest.

All Astryx components accept `data-*` attributes (via `BaseProps`), which is how region roots get their `data-testid` for Phase 4.

## Themes: Graphite is canonical

Every workbench in this catalog runs **one** theme — Graphite, a custom `defineTheme` theme built from the real Graphite design-system tokens. The canonical source and committed build artifacts live at `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/templates/graphite-theme/`:

| File                 | Role                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `graphiteTheme.ts`   | The `defineTheme` source — every token, with the Graphite var it transcribes named inline |
| `graphite.css`       | Built CSS: `@layer reset` + `@layer astryx-theme`, both inside the `graphite` `@scope`    |
| `graphite.js`        | Built theme object (`__built: true`), what `<Theme theme={…}>` takes                      |
| `graphite.d.ts`      | Declarations for the built module                                                         |
| `graphite-fonts.css` | The `@font-face` metric-adjusted local fallback (see Font strategy below)                 |

### Token source of truth

Graphite's tokens live in the `frontier-field-note` repo, which is read-only reference material — never edited from a workbench:

```text
frontier-field-note/packages/theme/src/graphite.ts       THEMES (colour vars), MONO/SANS/SERIF_STACK, SCALE
frontier-field-note/packages/theme/src/echartsTheme.ts   GRAPHITE_SERIES — the 5-step data palette
frontier-field-note/packages/theme/src/bridge.css        the 7-hue status ramp
```

`graphiteTheme.ts` names the absolute path of each in its header comment. Where Astryx needs a slot Graphite does not define (the green and cyan categorical hues; two dark text stops that miss WCAG AA on their own background tint), the file states the OKLCH derivation and the measured contrast ratio inline. Never invent a hex — derive from an anchor and record the arithmetic.

### Rebuild

From `templates/graphite-theme/`:

```bash
bunx astryx theme build graphiteTheme.ts --out graphite.css
```

That emits `graphite.css`, `graphite.js`, and `graphite.d.ts` (plus `graphite.variants.d.ts` if the theme adds custom component prop values). Copy all of them into each workbench's `src/theme/`. `--check` verifies the artifacts are not stale without rewriting them. After a rebuild, re-run the Phase 4 headless verification: the token assertions read painted surfaces, so a broken build fails them.

### Wiring, per workbench

Each workbench keeps its own copy of the built artifacts in `src/theme/` — a workbench is self-contained and disposable, `templates/graphite-theme/` is the canonical original. Import order in `src/main.tsx`:

```tsx
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./theme/graphite-fonts.css";
import "./theme/graphite.css";

import { Theme } from "@astryxdesign/core/theme";
import { graphiteTheme } from "./theme/graphite";

<Theme theme={graphiteTheme} mode="light">…</Theme>;
```

`index.html` carries `data-astryx-theme="graphite"` and a `data-theme` matching the provider's `mode`, plus the `<style>@layer reset, astryx-base, astryx-theme;</style>` order statement. The built CSS declares exactly the layers `reset` and `astryx-theme` — same names the published theme packages use — so that statement is correct verbatim.

Default `mode` is `light`. `pr-workbench` runs `mode="dark"`: Graphite dark is a first-class mode with its own token pairs, verified in-browser.

### The `body` baseline rule every `index.html` needs

Astryx paints its own component surfaces and styles nothing on `body`. Without an explicit rule the canvas behind the cards is UA white and any text outside a themed component renders in Times New Roman, so every `index.html` carries:

```html
<style>
  [data-astryx-theme="graphite"] body {
    background: var(--color-background-body);
    font-family: var(--font-family-body);
    color: var(--color-text-primary);
  }
</style>
```

The selector must stay under `[data-astryx-theme="graphite"]` for the same reason the accent override does — `graphite.css` declares its tokens on `:scope`, so `var(--color-*)` resolves only inside that subtree. `<html>` carries the attribute, which makes `body` a descendant that inherits the tokens.

The same block is the home for any page-level rule a component cannot own. `grid-workbench` puts `.cell-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` here: the click-to-edit cell is a plain `<button>` styled with a React inline style object, and an inline style cannot express a pseudo-class.

### Per-workbench identity: one custom property

Graphite publishes `--wb-header-accent`, which the theme's `h1` rule reads for a 3px header rule. It is the only *token* a workbench overrides:

```html
<style>[data-astryx-theme="graphite"] { --wb-header-accent: #274d7a; }</style>
```

**The selector must be `[data-astryx-theme="graphite"]`, not `:root`.** `<Theme>` renders a `display:contents` wrapper div carrying the same attribute, and `graphite.css` re-declares every token on `:scope` — which matches that wrapper. A `:root` override never reaches the `h1`, because the wrapper shadows it on the way down. This selector matches both `<html>` and the wrapper, and being unlayered it outranks the layered `:scope` declaration on the same element.

| Workbench          | Accent    | Graphite source           |
| ------------------ | --------- | ------------------------- |
| `eval-viewer`      | `#0a6961` | `--accent` teal (default) |
| `doc-review`       | `#274d7a` | `--accent-2` navy         |
| `pr-workbench`     | `#2fb6a4` | dark-mode `--accent` teal |
| `grid-workbench`   | `#7a5512` | `--warn` amber            |
| `triage-workbench` | `#6a3f76` | plum, `--status-review`   |

Each workbench's favicon uses the same hex.

### Font strategy: zero network, metric-matched fallback

Graphite's stacks (`SANS_STACK`, `SERIF_STACK`, `MONO_STACK`) go into `typography.{body,heading,code}`. Astryx does not load fonts — that is the consumer's job — and a workbench must render on a plane, so **no Google Fonts `<link>`, no `@import`, no `@fontsource` package.** A family that is neither installed locally nor network-loaded is skipped silently and the next stack entry wins.

The one metric-adjusted fallback Graphite defines lives in `graphite-fonts.css`: `"IBM Plex Sans fallback"` is a local Arial re-scaled to IBM Plex Sans's metrics (`size-adjust: 98.79%`, `ascent-override: 103.76%`, `descent-override: 27.84%`, capsize 3.7.0 numbers). Without it, the stack's second entry is an undefined family and the webfont swap reflows every line of body copy.

**Why a sibling file rather than part of `graphite.css`:** `astryx theme build` wraps every rule it emits in `@layer … { @scope … }`, and `@font-face` is a top-level at-rule that cannot be scoped. The declarations also have to be visible document-wide, not just inside the themed subtree.

### Shipped `@astryxdesign/theme-*` packages: the quick-start alternative

The published theme packages remain a valid path when a throwaway workbench does not need the design system — install one, import `@astryxdesign/theme-<name>/theme.css` plus the `/built` object, and set `data-astryx-theme="<name>"`. `neutral`, `stone`, `butter`, `chocolate`, `matcha`, `gothic` (dark-only), and `y2k` are all available at the same `0.3.0` pin. Graphite is what the five reference workbenches use, because a workbench that reads like the rest of the design system is one less context switch.

### Cascade and canvas

The stylesheets are cascade-layered (`@layer reset`, `@layer astryx-base`, `@layer astryx-theme`), so unlayered page CSS wins by default — inline `style={{}}` escape hatches for layout (the fr-ratio grid split in `eval-viewer/src/App.tsx`) work without specificity fights.

Chart colors cannot come from the theme at runtime: canvas can't read CSS custom properties. The Graphite chart palettes are JS literals in each `src/charts.ts`, transcribed from `GRAPHITE_SERIES` and the status ramp. See the palette pairing rule in `rendering.md`.

## What not to add

- **`@astryxdesign/charts`** — published only under the `@canary` dist-tag; not stable. ECharts covers the need.
- **A bundler (Vite, etc.)** — Bun's fullstack server already transpiles TSX/CSS on demand; adding a bundler is pure ceremony here.
- **react-markdown / DOMPurify / highlight.js** — Astryx `Markdown` + `CodeBlock` replace all three with no sanitizer configuration surface.
- **An HTTP client for scripts** — terminal helpers use global `fetch`; they have zero dependencies by design.
- **An ORM** — the SQL is the design; `bun:sqlite` is the whole data layer.
