# In-browser rendering pipeline

This is the rendering half of a workbench's `index.html`. It turns server-rendered Markdown fragments into rich content in the browser, with no build step and no npm. The code highlights fenced blocks, draws Mermaid diagrams, and renders GFM tables. The reference implementation is `workbench/templates/index.html`, the eval viewer. `pr-workbench/templates/index.html` runs the same engine in a leaner form. Read one of them alongside this file. Every excerpt below is copied from the working code.

The engine is four CDN libraries composed in a fixed order. **marked** turns Markdown into HTML with GFM on by default. **marked-highlight** bridges to **highlight.js** for fenced code. **mermaid** turns `` ```mermaid `` fences into SVG. **DOMPurify** sanitizes the result before it touches the DOM. The order is load-bearing. Get it wrong and you get silent failures: unhighlighted code, diagrams that never render, or sanitizer-stripped output. Get it right once and copy it.

## Contents

- Why these exact packages
- Setup: configure the engine once, at load
- The Mermaid pass-through dance
- Progressive disclosure: chips, modal, sheet
- Chart.js: create once, then `.update()`
- Checklist when you build the rendering layer

## Why these exact packages

The CDN catalog with verified SRI hashes lives in `references/cdn-deps.md`. Two of those choices exist purely to make this pipeline work, so they belong here too.

The highlight.js *browser build* is a different package. Use `@highlightjs/cdn-assets@11.11.1/highlight.min.js`, which sets `window.hljs`. The obvious-looking `highlight.js/lib/common.min.js` is a CommonJS module with no global, and it throws `require is not defined` in the browser. This cost real debugging. Do not "fix" the import to the shorter path.

marked-highlight needs the non-minified `lib/index.umd.js`. jsDelivr generates the `.min.js` on the fly, so its SRI hash is unstable, and the file itself carries a "do NOT use SRI with dynamically generated files" warning. The unminified UMD is a few KB larger and has a stable hash.

Mermaid pulls its own dependency graph but ships as one self-contained UMD bundle on `globalThis.mermaid`, so it needs no extra loads. DOMPurify is the last line of defense. marked does not sanitize, so the output goes through `DOMPurify.sanitize` before it ever lands in `innerHTML`.

## Setup: configure the engine once, at load

Run this once after the scripts load, before any rendering. There are three steps. Initialize mermaid in deferred mode so it never auto-runs. Register the highlight bridge. Register a custom renderer that passes Mermaid fences through untouched.

```javascript
// ---- markdown engine: marked (GFM) + highlight.js + mermaid + DOMPurify
mermaid.initialize({
  startOnLoad: false, theme: 'dark', securityLevel: 'strict',
  themeVariables: { fontFamily: 'JetBrains Mono, monospace', fontSize: '12px',
                    primaryColor: '#191c25', primaryBorderColor: '#38bdf8',
                    lineColor: '#5a6072', primaryTextColor: '#e7e9f0' },
});
marked.use(markedHighlight.markedHighlight({
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    if (lang === 'mermaid') return code;          // leave mermaid source alone
    const l = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language: l }).value;
  },
}));
marked.use({ renderer: {
  code(token) {
    if (token.lang === 'mermaid') {
      return `<pre class="mermaid">${token.text
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
    }
    return false;                                  // false = marked's default for everything else
  },
}});
```

Two moves are non-obvious. First, `startOnLoad: false`. Mermaid's default is to scan the whole document on `DOMContentLoaded` and render every `.mermaid` it finds. That races your Markdown pipeline and double-renders SSE-swapped fragments. Turn it off and call `mermaid.run({ nodes })` yourself, after the HTML is in the DOM and sanitized. Second, `securityLevel: 'strict'`. Mermaid can embed click handlers and inline HTML from diagram source. Strict mode disables that. The diagram source here is server-authored, but the workbench is a demo people inspect, so keep the surface small.

## The Mermaid pass-through dance

This is the part that trips people up. Mermaid fences must survive two transformations untouched, then render last. Trace one `` ```mermaid `` block through the pipeline.

First, the highlight callback returns the raw code (`if (lang === 'mermaid') return code;`). Let highlight.js tokenize it and the diagram source turns into colored `<span>`s that Mermaid can no longer parse.

Second, the custom `code` renderer re-emits it as `<pre class="mermaid">…</pre>`, HTML-escaping `& < >` so the source is valid inside the `<pre>`. Returning `false` for every other language hands control back to marked's stock code renderer, which step one has already highlighted.

Third, DOMPurify must keep `<pre>` and the `class` attribute. This is the line people miss. The default DOMPurify config strips the `class`, so Mermaid never finds the node:

```javascript
node.innerHTML = DOMPurify.sanitize(marked.parse((src || '').trim()),
  { ADD_TAGS: ['pre'], ADD_ATTR: ['class'] });
```

Fourth, only now, after the sanitized HTML is in the DOM, run Mermaid on the nodes that have not rendered yet. Tag each one so a re-render does not touch it twice:

```javascript
const diagrams = node.querySelectorAll('pre.mermaid:not([data-mm])');
diagrams.forEach(d => { d.id = 'mm-' + (mmid++); d.dataset.mm = '1'; });
if (diagrams.length) await mermaid.run({ nodes: diagrams }).catch(() => {});
```

The `:not([data-mm])` guard plus the `data-mm='1'` stamp make re-rendering idempotent. The `.catch(() => {})` swallows a malformed-diagram parse error so one bad fence does not abort the whole render.

**The core renderer.** Everything above lives inside one function. `embed` is the one knob. When `true`, it collapses wide artifacts to chips for narrow panels. When `false`, it renders everything inline for the wide sheet. Progressive disclosure has its own section below. Here is the whole function:

```javascript
async function renderInto(node, src, embed) {
  node.innerHTML = DOMPurify.sanitize(marked.parse((src || '').trim()),
    { ADD_TAGS: ['pre'], ADD_ATTR: ['class'] });
  const diagrams = node.querySelectorAll('pre.mermaid:not([data-mm])');
  diagrams.forEach(d => { d.id = 'mm-' + (mmid++); d.dataset.mm = '1'; });
  if (diagrams.length) await mermaid.run({ nodes: diagrams }).catch(() => {});
  if (!embed) return;
  // tables -> chip
  node.querySelectorAll('table').forEach(t => {
    const rows = Math.max(0, t.rows.length - 1), cols = t.rows[0]?.cells.length || 0;
    t.replaceWith(tableChip(t.cloneNode(true), rows, cols));
  });
  // diagrams -> thumbnail chip
  node.querySelectorAll('pre.mermaid').forEach(d => d.replaceWith(diagramChip(d)));
}
```

**Re-render on every SSE swap.** The pipeline above only runs on content already in the DOM. SSE delivers new server-rendered fragments throughout the session, where each named event re-fetches one partial (see `references/architecture.md`). So the rendering pass has to re-run on every htmx swap, scoped to the swapped subtree:

```javascript
document.body.addEventListener('htmx:afterSwap', (e) => {
  renderMarkdown(e.target);
  if (e.target.id === 'run-summary') renderChart();
});
```

`renderMarkdown` walks the freshly-swapped root and renders any `.md` block not yet processed. It caches the raw source so the sheet can re-render it wide later:

```javascript
async function renderMarkdown(root) {
  const els = (root || document).querySelectorAll('.md:not([data-md])');
  for (const el of els) {
    const src = el.textContent;     // server emits raw markdown as the element's text
    mdSrc.set(el, src);             // stash for the right-sheet re-render
    el.dataset.md = '1';            // mark processed so the next swap skips it
    await renderInto(el, src, true);
  }
}
```

The contract with the backend is simple. A partial template emits `<div class="md">…raw markdown…</div>`. The server does no Markdown rendering. It ships the source as text content, and the browser renders it. The `:not([data-md])` and `data-md='1'` pair mirrors the Mermaid idempotence guard, so a swap that re-renders a panel will not double-process Markdown already converted.

Call `renderMarkdown()` and `renderChart()` once at the bottom of the script for the initial `load`-triggered fetch. Then let `htmx:afterSwap` carry every subsequent update.

## Progressive disclosure: chips, modal, sheet

Workbench panels are narrow. The right column is about 372px. A wide GFM table or a Mermaid diagram rendered inline blows out the column. The fix is progressive disclosure. In narrow contexts, wide artifacts collapse to a compact **embed chip**. Clicking the chip opens the full artifact in a **centered modal**. An event or note's full text opens in a **right sheet** rendered at full width.

The two overlays do two jobs. The modal (`#modal`, centered) shows one visual artifact, a table or a diagram, at its natural size. The diagram chip even carries a live SVG thumbnail, so the panel hints at what is inside. The sheet (`#sheet`, slides in from the right) does full-text disclosure. It re-renders the *same* Markdown source with `embed=false`, so the table and diagram appear inline at full width instead of as chips.

The chip builders stash the full node and emit a button carrying its id:

```javascript
function tableChip(full, rows, cols) {
  const id = 'e' + (embedSeq++); embeds.set(id, full);
  const b = document.createElement('button');
  b.className = 'embed-chip'; b.dataset.embed = id; b.dataset.title = `table · ${rows}×${cols}`;
  b.innerHTML = `<span class="ec-ic">▦</span><span>table</span>` +
                `<span class="ec-dim">${rows}×${cols}</span><span class="ec-go">open ⤢</span>`;
  return b;
}
```

A single delegated click listener routes chips to the modal, and routes the `.expand` button and event rows to the sheet:

```javascript
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.embed-chip');
  if (chip) { const n = embeds.get(chip.dataset.embed);
              if (n) openModal(chip.dataset.title, n.cloneNode(true)); return; }
  const exp = e.target.closest('.expand');
  if (exp) { const md = exp.closest('.cnote, .hnote')?.querySelector('.md');
             if (md) openSheet(exp.dataset.title || 'note', mdSrc.get(md) ?? md.textContent); return; }
  const row = e.target.closest('.ev');
  if (row) { const md = row.querySelector('.md');
             // …open the sheet with the event's source…
             return; }
  if (e.target.closest('[data-close]')) closeOverlays();
});
```

The sheet re-renders from the cached source, full width, no chips:

```javascript
async function openSheet(title, src) {
  const s = document.getElementById('sheet');
  s.querySelector('.ov-title').textContent = title;
  const body = s.querySelector('.ov-body');
  const holder = document.createElement('div'); holder.className = 'md';
  body.replaceChildren(holder);
  await renderInto(holder, src, false);   // full width, no chips
  s.classList.add('open');
}
```

This pattern is reusable across every workbench type. Any dense surface, whether eval notes, PR diffs, or trace spans, gets the same chip-to-modal-or-sheet treatment. Caching the raw Markdown in `mdSrc` is what lets the sheet re-render wide. Without it you would have to re-fetch or reverse the chip transformation.

**The CSS that keeps artifacts in the panel.** Progressive disclosure handles the intentional overflow. The accidental kind comes from CSS grid, and it cost real debugging. Grid items default to `min-width: auto` and refuse to shrink below their content. A wide table or a long code line then escapes the panel. The fix: every column wrapper and every `.md` block carries `min-width: 0` plus `overflow-wrap: anywhere`. This was the recent-events overflow bug. The panel looked fine until a long token appeared. Pills and tags are the exception. They use `white-space: nowrap` inside a scrollable container, not `overflow-wrap`. On a short pill, `overflow-wrap` stacks the letters vertically when the column squeezes.

```css
.md { font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
.col-right { min-width: 0; }
.md pre { overflow-x: auto; }                 /* code scrolls, doesn't push */
.pill { white-space: nowrap; }                /* never stack letters */
```

## Chart.js: create once, then `.update()`

Live charts are the one place where you do not re-render from scratch. You cannot call `new Chart()` twice on the same canvas. It throws "Canvas is already in use." Create the chart once, hold the instance, and on each SSE-driven refresh mutate its data and call `.update()`, which animates the transition for free:

```javascript
let historyChart, splitChart;

async function renderChart() {
  const { runs } = await (await fetch('/data/run-history')).json();
  const labels = runs.map(r => r.label);
  const series = k => runs.map(r => r['n_' + k]);
  // …build datasets…

  if (!historyChart) {
    historyChart = new Chart(document.getElementById('chart-history'), {
      type: 'line', data: { labels, datasets: [ds('pass'), ds('fail'), ds('review')] },
      options: { responsive: true, maintainAspectRatio: false, /* …tooltips, stacked y… */ },
    });
  } else {
    historyChart.data.labels = labels;
    historyChart.data.datasets.forEach(d => { d.data = series(d.label); });
    historyChart.update();                    // animates to the new data
  }
  // …same create-once / update pattern for the doughnut splitChart…
}
```

`renderChart()` fires on the `run-summary` SSE swap (see the `htmx:afterSwap` handler above) and once at load. Chart.js is one self-contained UMD bundle. There is no d3, and tooltips, legend, and animation come from config rather than extra code. If you reach for Observable Plot instead, note that it externalizes d3 and reads `window.d3`, so you must load d3 first. Chart.js avoids that entirely.

Set Chart.js defaults once so every chart matches the workbench theme without per-chart config:

```javascript
Chart.defaults.color = '#888fa3';
Chart.defaults.font.family = 'JetBrains Mono, monospace';
Chart.defaults.font.size = 10;
```

For a canvas inside a resizable panel, call `chart.resize()` when the container width changes, as the eval viewer does on splitter drag-end, so the chart reflows.

## Checklist when you build the rendering layer

- [ ] Engine configured once at load: `mermaid.initialize({ startOnLoad: false })`, `markedHighlight` bridge, custom `code` renderer passing `mermaid` through.
- [ ] highlight callback returns raw code for `lang === 'mermaid'`, never highlighting diagram source.
- [ ] `DOMPurify.sanitize(..., { ADD_TAGS: ['pre'], ADD_ATTR: ['class'] })`, or Mermaid nodes vanish.
- [ ] `mermaid.run({ nodes })` runs after sanitize, guarded by `:not([data-mm])` and `data-mm='1'`.
- [ ] `htmx:afterSwap` re-runs `renderMarkdown(e.target)` so SSE fragments render.
- [ ] `.md:not([data-md])` walk caches raw source in `mdSrc` and stamps `data-md='1'`.
- [ ] Narrow panels: tables and diagrams collapse to chips and a modal; full text opens a right sheet re-rendered with `embed=false`.
- [ ] `min-width: 0` plus `overflow-wrap: anywhere` on grid items and `.md`; `white-space: nowrap` on pills.
- [ ] Charts created once, refreshed via `.update()`, never `new Chart()` on a live canvas.
- [ ] Verify in a real browser (headless Chrome, `domcontentloaded`). The browser catches SRI mismatches, missing globals, and layout overflow that curl cannot.
