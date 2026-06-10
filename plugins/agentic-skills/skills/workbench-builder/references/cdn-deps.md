# CDN Dependency Catalog

The verified CDN set for a workbench, plus the gotchas that each cost real debugging time. Load this in **Phase 2 (Build UI)** when you write the `<script>` and `<link>` tags into `index.html`. Load it again in **Phase 4 (Verify)** when the headless browser blocks a script and you need to confirm a hash or a package name.

The catalog below is the working set wired into the eval viewer at `workbench/templates/index.html` (lines 9–45). Copy the tags from there, or reproduce them from this table. Every hash is verified in-browser (May 2026). A one-character drift silently blocks the script under SRI, so do not recompute or substitute a hash casually.

**How SRI is hashed.** Do this, or the browser blocks you. Subresource Integrity hashes the *uncompressed* bytes, the bytes the browser sees after decompression. By default jsDelivr serves `curl` a gzip or brotli body. A naive `curl | openssl` therefore hashes the compressed stream and produces a hash the browser will never match. Force identity encoding:

```bash
curl -sL -H "Accept-Encoding: identity" "<url>" | openssl dgst -sha384 -binary | openssl base64 -A
```

Prefix the result with `sha384-` in the `integrity=` attribute. Always pair it with `crossorigin="anonymous"` so the browser sends a CORS request the CDN can answer.

**The verified set (jsDelivr, sha384, May 2026).**

| Library                        | CDN path (`https://cdn.jsdelivr.net/npm/…`)        | integrity (`sha384-`)                                              |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| htmx                           | `htmx.org@2.0.10/dist/htmx.min.js`                 | `H5SrcfygHmAuTDZphMHqBJLc3FhssKjG7w/CeCpFReSfwBWDTKpkzPP8c+cLsK+V` |
| htmx SSE ext                   | `htmx-ext-sse@2.2.4`                               | `A986SAtodyH8eg8x8irJnYUk7i9inVQqYigD6qZ9evobksGNIXfeFvDwLSHcp31N` |
| Chart.js                       | `chart.js@4.5.1/dist/chart.umd.min.js`             | `jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ` |
| marked                         | `marked@18.0.4/lib/marked.umd.min.js`              | `QIom/Ao3tGhg4C4VY5VTDrHMTPzgsih5cGuY30rd/xp6hWQ+xIGIZ4kxhaQQY+PB` |
| DOMPurify                      | `dompurify@3.4.7/dist/purify.min.js`               | `C5g1ZoYBpnvKyArNZI21kaBEk3egHOYfHj/cUOHmyJ7CSDMyNMyM+STqfkBt8m2Y` |
| highlight.js browser build     | `@highlightjs/cdn-assets@11.11.1/highlight.min.js` | `RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU` |
| highlight.js theme             | `highlight.js@11.11.1/styles/github-dark.min.css`  | `wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH` |
| marked-highlight, NOT minified | `marked-highlight@2.2.4/lib/index.umd.js`          | `BjBE0bY2PIGsLgdqaC1+iwO397c7jxwJdNszWabXYxrbMXBTS9QCPxXJElH8xOE/` |
| mermaid                        | `mermaid@11.15.0/dist/mermaid.min.js`              | `yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF` |
| d3, only if Observable Plot    | `d3@7.9.0/dist/d3.min.js`                          | `CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i` |

Load order matters. The three markdown libraries must all load before the engine wires them together. d3, if used, must load before any library that reads `window.d3`. See `workbench/templates/index.html` lines 352–399 for the engine.

## Gotchas

Boring means no toolchain, not no capability. Each capability is one verified `<script>` tag. There is no npm, no bundler, no build step. Yet the page renders GFM markdown, syntax-highlighted code, Mermaid diagrams, live charts, and a sanitized DOM, all from CDN tags. The price is that the browser resolves every dependency, not a bundler. Failures show up at runtime in the console. Each one below cost real debugging this session. Read them before you wire the tags.

**SRI is hashed over uncompressed bytes.** jsDelivr serves `curl` a compressed body. The browser hashes the decompressed file. Hash the compressed stream and the integrity check fails: a console error, and the script never runs. The trap is that `curl` downloads the file fine, so the failure is invisible until the browser surfaces it. Always hash with `Accept-Encoding: identity`.

**The highlight.js browser build is a different package.** `highlight.js/lib/common.min.js` is a CommonJS module. It ends in `module.exports` and sets no global, so a browser throws `require is not defined` and `hljs` stays undefined. Use `@highlightjs/cdn-assets@11.11.1/highlight.min.js` instead. That build sets `window.hljs`. The marked-highlight callback calls `hljs.highlight(...)` directly (index.html line 364), so `hljs` has to be a real global.

**marked-highlight wants the non-minified file.** jsDelivr generates the `.min.js` for marked-highlight on the fly, so its bytes and its hash are not stable. A hash that matches today can break on a cache refresh. The file even carries a "do NOT use SRI with dynamically generated files" warning. The committed `lib/index.umd.js` is static, so its hash holds. This is the one tag in the set that is deliberately not minified.

**Observable Plot externalizes d3, so prefer Chart.js.** Plot's UMD build reads `window.d3` rather than bundling its own copy. It hard-fails unless d3 loads first, which is why the table marks the d3 row "only if Observable Plot." The simpler path is Chart.js, and it is the one the eval viewer takes. Chart.js is one self-contained UMD bundle with no d3 dependency, and tooltips, legends, and animation come free in config (index.html lines 473–517). Reach for d3 plus Plot only when you need a chart Chart.js cannot express.

**Chart.js: create once, then `.update()`.** You cannot call `new Chart()` twice on the same `<canvas>`. The second call throws, because the canvas already belongs to a chart instance. Create each chart once and hold the reference. On new data, assign `chart.data...` and call `chart.update()`, which animates the transition. The eval viewer guards this with `if (!historyChart) { … new Chart … } else { … historyChart.update(); }` (index.html lines 488–517) and re-runs `renderChart()` on the SSE-driven `htmx:afterSwap` so charts stay live without a reload.

**Headless tests wait on `domcontentloaded`, never `networkidle`.** A workbench holds one long-lived SSE stream open (index.html line 290). That open EventSource keeps the network perpetually active, so Playwright's `networkidle` condition never fires and the test hangs to its 30-second timeout. Wait on `domcontentloaded`. This is the single most common way a Phase 4 run stalls.

**CSS grid overflow needs `min-width: 0`.** Grid and flex items default to `min-width: auto`, which refuses to shrink the item below its content's intrinsic width. A wide table or Mermaid diagram then escapes its panel and blows out the column. This was the recent-events overflow bug. Fix it on every live region that can hold wide content: `min-width: 0` plus `overflow-wrap: anywhere`. The eval viewer applies this to `.col-right`, `.chart-cell`, `.md`, and the table cells (index.html lines 97, 137, 173, 230).

**Pills want `white-space: nowrap` in a scrollable container.** For short status tags, `overflow-wrap: anywhere` is the wrong tool. When the container squeezes, it wraps mid-word and stacks the letters into an unreadable vertical column. Use `white-space: nowrap` on the pill and let a parent scroll. The `.pill` class does exactly this (index.html line 151). It is the inverse of the grid rule above: prose and wide artifacts wrap, pills do not.

**The favicon 404 is harmless but noisy.** Without a favicon the browser requests `/favicon.ico` and logs a 404. It breaks nothing. But in a demo people inspect with the console open, it reads as a defect. Ship an inline SVG data-URI favicon for zero network request and zero 404: `<link rel="icon" href="data:image/svg+xml,…">` (index.html line 7).
