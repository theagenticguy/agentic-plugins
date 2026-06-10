# Workbench Builder Orchestrator

The orchestrator runs inside a forked subagent so the main conversation stays clean of check-in noise, tool chatter, and scaffolding. It routes the user's ask through five phases: Route, Scaffold backend, Build UI, Wire the loop, and Verify. It produces a running app on `127.0.0.1`. The deliverable is not a document. It is a live workbench you can open in a browser while Claude works the terminal. Progress is `wc -l` on the files being built, plus a final headless-browser assertion.

The whole build is reversible and local. There is no deploy, no auth, and no shared state outside one SQLite file in the working directory. Proceed without approval gates when the ask is clear. The pipeline mirrors the verified implementations under `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/` (eval viewer) and `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/` (PR review room). Read those when a phase needs a concrete pattern.

Terms. `{{ slug }}` is a kebab-case name for the workbench, such as `pr-review-room` or `incident-timeline`, trimmed to about 40 chars. `{{ slug }}/` is the working directory. Every subagent prompt carries the write-protocol block verbatim from `references/write-protocol.md`.

## Contents

- Inputs
- Phase tracking
- Phase 0 — Route
- Phase 1 — Scaffold backend
- Phase 2 — Build UI
- Phase 3 — Wire the loop
- Phase 4 — Verify
- Phase 5 — Deliver
- Inline mode (no subagents)

## Inputs

- `{{ source }}` is the user's ask parsed from `$ARGUMENTS`: what kind of workbench, what state it tracks, and what the human does versus what the terminal does.
- `references/write-protocol.md` is the verbatim block pasted into every subagent prompt.
- `references/cdn-deps.md` is the verified CDN dependency table with SRI hashes and the rendering-pipeline gotchas. Load it before Phase 2.
- `references/recipes.md` is the workbench-type catalog: eval viewer, PR review room, agent trace replay, refactor cockpit, data-cleanup, prompt/skill lab, ADR board, incident timeline, migration planner. Each is a data model plus a layout over the same stack. Load it in Phase 0.
- `templates/app.py` is the Flask plus raw `sqlite3` plus SSE fan-out skeleton, the Phase 1 starting point.
- `templates/index.html` is the page skeleton: CDN tags with verified SRI, design tokens, htmx-ext-sse wiring, the render engine, and the modal and sheet overlays. It is the Phase 2 starting point.
- `templates/terminal-helper.py` is the PEP 723 `httpx` script skeleton for the terminal half of the loop, the Phase 3 starting point.
- `templates/worklog-skeleton.md` is the per-phase work-log skeleton with the embedded write-protocol.

## Phase tracking

Before Phase 0, create five todo items: Route, Scaffold backend, Build UI, Wire the loop, Verify. Flip each to `in_progress` on entry and `completed` on exit. When a phase runs as a backgrounded subagent, also `TaskCreate` one item for that subagent and flip it when its work log shows `Status: COMPLETE`.

## Phase 0 — Route

This is the heart of the build. Everything downstream is a consequence of one decision: what is the shared state, and who writes to it? The data model is the design. Pick it wrong and the UI is decoration over the wrong table.

Route in one pass.

1. **What KIND of workbench?** Match the ask against `references/recipes.md`. Each recipe is a named data model plus layout: eval viewer, PR review room, agent trace replay, refactor cockpit, data-cleanup workbench, prompt/skill lab, architecture decision board, incident timeline builder, migration planner. If the ask matches a recipe, lift its schema as the starting point. If it is a blend, name the closest recipe and note the deltas.

2. **What is the shared state?** Name the core tables and their relationships. The PR review room's value is the `pr_files` join that yields cross-PR file collisions (`pr-workbench/app.py` `collisions()`). There, the data model is itself the unique capability. The eval viewer's value is `evals` carrying both `human_note` and `claude_note` side by side (`workbench/app.py` SCHEMA). Write the schema down before any code.

3. **Who writes each table: human, terminal, or both?** This decides whether you build a read-only dashboard or a two-way workbench. A genuine workbench has at least one table the human writes from the browser, and at least one path the terminal writes from `httpx`. If you cannot name both, the ask is a dashboard. Say so, and confirm the user wants the loop.

4. **What are the live regions?** Each independently refreshing UI region maps to one named SSE event and one `GET /partials/<region>` route. List them. The PR room uses `overview`, `fleet`, `collisions`, `queue`, plus a per-PR `thread-<id>`.

Announce the plan inline in one short paragraph: workbench type, the tables, who writes what, and the live regions. Then move to Phase 1 without gating. The build is files on disk and a localhost process. Nothing is published, so there is nothing to approve.

Use `AskUserQuestion` exactly once, and only if the workbench type or the data model is genuinely ambiguous. An example is "build me something to review my agent's work," where it is unclear whether that is a trace replay (a timeline of tool calls) or an eval viewer (pass/fail cases). Batch up to three questions, take the answers, and proceed. Do not gate on cosmetic choices like colors, port, or copy. Make a defensible call and note it inline.

## Phase 1 — Scaffold backend

**Goal:** a running `app.py` with the SQLite schema, db helpers, SSE fan-out and `publish()`, seeded interconnected data, `GET /partials/<region>` routes, and the terminal-side ingest and respond endpoints. By the end of this phase, `uv run app.py` boots and the partial routes return HTML.

**Load:** `templates/app.py`, the matched recipe section of `references/recipes.md` for the schema, and the three reference implementations (`workbench/app.py`, `pr-workbench/app.py`, `doc-review/app.py`) for the patterns below.

**Concrete steps.**

1. `mkdir -p {{ slug }}/templates/partials {{ slug }}/scripts` and copy `templates/app.py` to `{{ slug }}/app.py`.
2. **Schema.** Write the `SCHEMA` string from the Phase 0 data model. Use raw `sqlite3`, no ORM. Use `ON DELETE CASCADE` for child tables and `PRAGMA foreign_keys = ON` in `db()` (see `pr-workbench/app.py` `pr_files` and `concerns`). Include the human-to-agent channel table when the loop needs queued asks. That is the `requests` table in `pr-workbench/app.py`, where `status` cycles `queued`, `working`, `answered`.
3. **DB helpers.** Write `db()` with a `g`-scoped connection and `Row` factory, a `teardown_appcontext` close, `now()`, and `init_db()` that runs `executescript(SCHEMA)` then seeds only if the table is empty, so reruns do not duplicate.
4. **SSE fan-out.** Copy the `_subscribers` set, lock, and `publish(*targets)` pattern verbatim. It is the spine of the whole design. `publish()` puts each target name onto every subscriber queue. The `/events` stream emits `event: <target>\ndata: stale\n\n`. The event is an invalidation signal, never data.
5. **Seed believable, interconnected data.** Flat seed data makes the workbench look dead. The PR room seeds five PRs that deliberately collide on hot files like `app/models.py` and `api/routes.py`, so the collision rail has something to show on first load (`pr-workbench/app.py` `_seed()`). The eval viewer seeds one case with a rich GFM note (fenced code, a mermaid flowchart, and a table) so the render pipeline is exercised on load (`workbench/app.py` `init_db()`). Seed at least one row that demonstrates every render capability the UI will have.
6. **Partial routes.** Write one `GET /partials/<region>` per live region. Each renders a Jinja partial from a single query, so the htmx swap and the full-page render share one source of truth (`render_board`, `render_summary`, `render_event_log` in `workbench/app.py`).
7. **Mutation endpoints.** Human actions are htmx POSTs that update SQLite, `publish()` the affected regions, and return the swapped fragment. See `set_status` and `set_note` in `workbench/app.py`. Both return a single re-rendered row and publish `eval-board`, `run-summary`, `event-log`. Terminal actions are JSON endpoints that update SQLite, `publish()`, and return `{"ok": True}`, such as `/claude/eval-result` and `/pr/ingest`.
8. **The `/events` stream.** Copy it verbatim: a per-connection `queue.Queue(maxsize=64)`, a `hello` frame on connect, `q.get(timeout=15)` emitting the named event, and a `: keep-alive\n\n` comment frame on timeout to hold the connection open. Set the response `mimetype="text/event-stream"` with `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
9. **The run line.** Use `app.run(host="127.0.0.1", port=<pick a free one>, debug=True, threaded=True)`. `threaded=True` is non-negotiable, because the long-lived SSE stream would otherwise block every other request. `debug=True` gives hot reload while the UI is reshaped in Phase 2. Pick a port that does not collide with the reference apps (5050 eval, 5051 PR room).

**Subagent prompt shape.**

Scaffolding is mechanical once the data model is fixed, so run it foreground as a single agent unless the schema is large. When delegating:

```text
You are scaffolding the Flask backend for a {{ workbench_type }} workbench.

<scope>
Data model (from Phase 0): {{ tables + who-writes-what + live regions }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/app.py (copied from templates/app.py)
Your work log: {{ absolute_path }}/work-log-backend.md
</scope>

<responsibilities>
Fill app.py: SCHEMA, db helpers, publish() fan-out, init_db() with believable
interconnected seed data, one GET /partials/<region> route per live region,
human htmx-POST mutation endpoints (return fragment + publish), terminal-side
JSON endpoints (return {"ok": True} + publish), the /events SSE stream, and the
threaded 127.0.0.1 run line. Edit in place; keep the inline comments that explain
the SSE-as-invalidation contract.
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/recipes.md — your recipe's schema.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/app.py — eval-viewer reference.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/app.py — PR-room reference (incl. requests table for the human->agent loop).
</reference_material>

<write_protocol>
{{ paste ${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- `uv run app.py` boots with no traceback; every /partials/<region> returns HTML.
- Seed data is interconnected and exercises every render capability the UI will need.
- Every mutation endpoint publishes the regions it changed.
- /events emits named events and a keep-alive comment frame.
- threaded=True on the run line.
- Flip Status to COMPLETE when the app boots and all partials respond.
</quality_bar>
```

**Check-in:** verify by booting the app and curling each partial route. Do not trust curl for the SSE stream end to end. That is Phase 4's headless-browser job.

## Phase 2 — Build UI

**Goal:** `index.html` plus the per-region Jinja partials, with CDN tags carrying verified SRI, design tokens and panels, the htmx-ext-sse wiring, the render engine, and the modal and sheet overlays. By the end, opening the page in a browser shows live regions that populate on `load` and re-fetch on their named SSE event.

**Load:** `templates/index.html`, `references/cdn-deps.md` for the SRI table and gotchas (read every gotcha before writing a single `<script>` tag), and `pr-workbench/templates/index.html` as the worked reference.

**Concrete steps.**

1. **CDN tags with verified SRI.** Copy the `<script>` and `<link>` block from `templates/index.html`: htmx, htmx-ext-sse, marked, DOMPurify, the highlight.js browser build (`@highlightjs/cdn-assets`, NOT `highlight.js/lib`), the highlight.js theme CSS, the non-min marked-highlight (`lib/index.umd.js`), and mermaid. Add Chart.js only if the workbench has live charts. Add d3 only if you choose Observable Plot over Chart.js, and prefer Chart.js, which is one self-contained bundle with no d3. Every integrity hash comes from `references/cdn-deps.md`. Do not re-hash by guessing. The browser hashes uncompressed bytes, so a wrong hash silently blocks the script.
2. **Inline SVG favicon.** Ship `<link rel="icon" href="data:image/svg+xml,...">` (see `pr-workbench/templates/index.html` line 7). A 404 favicon is noise in a demo people inspect.
3. **Design tokens and panels.** Define CSS custom properties for the palette and lay out the panels with CSS grid. Give each workbench a distinct accent so two open at once are not confused (eval viewer cyan, PR room violet).
4. **Grid overflow guards.** Grid items default to `min-width: auto` and refuse to shrink below content, so wide tables and mermaid diagrams escape their panel. Add `min-width: 0` and `overflow-wrap: anywhere` to any region that renders markdown (the `.md` rule in `pr-workbench/templates/index.html`). For pill and tag rows, use `white-space: nowrap` inside a scrollable container. `overflow-wrap` stacks letters vertically when squeezed.
5. **htmx-ext-sse wiring.** `<body hx-ext="sse" sse-connect="/events">` opens one EventSource. Each live region carries `hx-get="/partials/<region>" hx-trigger="load, sse:<region>"`. The `load` fills it once, and the named SSE event re-fetches exactly that region (`pr-workbench/templates/index.html` lines 272–290). There is no per-region polling and no client state model.
6. **The render engine.** Copy the marked, marked-highlight, highlight.js, mermaid, and DOMPurify pipeline verbatim (`pr-workbench/templates/index.html` lines 299–319). The load-bearing details: the highlight callback returns mermaid fence text untouched, a custom renderer re-emits `` ```mermaid `` fences as `<pre class="mermaid">`, `DOMPurify.sanitize(..., {ADD_TAGS:['pre'], ADD_ATTR:['class']})` keeps those through sanitization, and `mermaid.run({nodes})` runs after the HTML lands. Set `mermaid.initialize({startOnLoad: false, ...})`.
7. **Re-render after every swap.** Wire `document.body.addEventListener('htmx:afterSwap', e => renderMd(e.target))` so SSE-swapped fragments get the render pass. Without this, regions that refresh via SSE show raw markdown.
8. **Overlays for dense surfaces.** Use progressive disclosure: wide artifacts collapse to compact chips inline, a chip click opens a centered modal, and full detail opens a right-hand sheet. The PR room's detail sheet is the reusable pattern (`#sheet-ov` and `#sheet`, with `openPR()` fetching `/partials/pr/<id>` then `renderMd` plus `htmx.process`). `htmx.process(sheet)` is required so any `hx-*` attributes in the loaded fragment get wired.
9. **Live indicator.** Wire `htmx:sseOpen` and `htmx:sseError` to a visible LED so the human can see the stream is connected (`pr-workbench/templates/index.html` lines 340–342).
10. **Per-region partials.** Write one Jinja partial per region under `templates/partials/`, each rendering exactly what its `/partials/<region>` route serves.
11. **Chart.js lifecycle (if charts).** Create the `Chart` instance once. On an SSE refresh, call `chart.update()` with new data. You cannot call `new Chart()` twice on one canvas.

**Subagent prompt shape.**

```text
You are building the browser UI for a {{ workbench_type }} workbench.

<scope>
Live regions (from Phase 0): {{ region list, each maps to /partials/<region> + sse:<region> }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/templates/index.html (copied from templates/index.html)
Partials directory: {{ absolute_path }}/templates/partials/
Your work log: {{ absolute_path }}/work-log-ui.md
</scope>

<responsibilities>
Fill index.html and write one partial per live region. Use the verified SRI tags
from cdn-deps.md exactly. Wire <body hx-ext="sse" sse-connect="/events"> and
give each region hx-trigger="load, sse:<region>". Copy the render engine verbatim.
Re-run renderMd on htmx:afterSwap. Add the modal+sheet overlays for dense artifacts.
Guard every markdown region with min-width:0 + overflow-wrap:anywhere.
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/cdn-deps.md — SRI table + render-pipeline gotchas. Read every gotcha first.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/templates/index.html — worked reference for the engine, SSE wiring, and the sheet overlay.
</reference_material>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Every CDN tag carries the exact integrity hash from cdn-deps.md.
- Each live region fills on load and re-fetches on its named SSE event.
- Markdown regions render fenced code, mermaid, and tables without escaping the panel.
- The detail overlay fetches its partial, renders markdown, and calls htmx.process.
- Flip Status to COMPLETE when the page loads and regions populate.
</quality_bar>
```

## Phase 3 — Wire the loop

**Goal:** the terminal helper scripts (PEP 723 `httpx`), and proof that the human-to-agent channel is genuinely two-way rather than a read-only dashboard. By the end, a terminal command writes state that the browser reflects live. For workbenches with a request queue, the terminal can also pull what the human asked and post answers back.

**Load:** `templates/terminal-helper.py`, and the reference scripts (`pr-workbench/scripts/review_loop.py`, `pr-workbench/scripts/analyze_pr.py`, `workbench/scripts/record_eval_result.py`, `workbench/scripts/post_claude_note.py`).

**Concrete steps.**

1. **Terminal helpers are PEP 723 scripts** run with `uv run scripts/<name>.py`. The header is `# /// script` then `dependencies = ["httpx"]`. Set `BASE = "http://127.0.0.1:<port>"`. Each helper POSTs JSON to a terminal-side endpoint and prints a one-line confirmation (`pr-workbench/scripts/review_loop.py`).
2. **Ingest and record helpers** push analyzed state in from the terminal. The PR room's `analyze_pr.py` POSTs a whole PR (title, summary, files, concerns) to `/pr/ingest`. The eval viewer's `record_eval_result.py` POSTs `{eval_id, actual, status}` to `/claude/eval-result`. Each triggers a `publish()` server-side, so the browser updates with no reload.
3. **The two-way channel** is what makes it a workbench. The human acts in the browser: htmx POST, then SQLite, then a fragment plus `publish`. The terminal acts: `httpx`, then SQLite, then `publish`. Both share one SQLite file. For asks that need the agent to answer the human, build the pull-and-respond pair. `GET /claude/queue` returns `queued` requests and flips them to `working`, so the human sees the spinner move. `POST /claude/respond` posts the markdown answer and flips to `answered` (`pr-workbench/app.py` `claude_queue` and `claude_respond`; `review_loop.py` drives both). The human side is the `/pr/<id>/ask` form that inserts a `queued` request.
4. **Confirm it is not a dashboard.** Trace one full round trip on paper. The human clicks in the browser, a row changes and SSE fires, the terminal reads the change (`/claude/feedback` in the eval viewer reads back what the human marked), the terminal writes a response, SSE fires, and the browser shows it. If any leg is missing, the loop is not closed.

**Subagent prompt shape.**

```text
You are writing the terminal-side helpers that close the human<->agent loop for a
{{ workbench_type }} workbench.

<scope>
Terminal endpoints (from Phase 1): {{ list — ingest/record + queue/respond if present }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/scripts/<name>.py (from templates/terminal-helper.py)
Your work log: {{ absolute_path }}/work-log-loop.md
</scope>

<responsibilities>
Write PEP 723 httpx helpers (uv run scripts/<name>.py): one to push analyzed state
in, and — if the workbench has a request queue — one that pulls /claude/queue,
does the work, and POSTs answers to /claude/respond. Each prints a one-line
confirmation. Verify a terminal POST changes a browser-visible region (the server
publishes on write).
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/scripts/review_loop.py — pull/respond loop.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/scripts/analyze_pr.py — ingest helper.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/scripts/record_eval_result.py — record helper.
</reference_material>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Each helper runs with `uv run` and exits 0 with a one-line confirmation.
- A terminal POST changes a browser-visible region via SSE (no reload).
- The human->agent channel is genuinely two-way: at least one path the human
  writes from the browser and one the terminal answers.
- Flip Status to COMPLETE when the round trip works end to end.
</quality_bar>
```

## Phase 4 — Verify

**Goal:** prove the workbench works the way the design claims, with a real headless browser. curl cannot catch SRI mismatches, missing JS globals, or layout overflow. The browser can, and those bugs are exactly the ones that cost real debugging this session. This phase is not optional.

**Load:** nothing new. This phase drives the running app.

**The assertion.**

1. **Use a real headless browser** (Chrome via Playwright). Navigate with `domcontentloaded`, never `networkidle`. The open SSE stream keeps the network perpetually active, so `networkidle` never fires and the test times out at 30 seconds.
2. **Assert SSE-driven update with no reload.** Open the page and wait for a live region to populate. Then, from a separate process, fire a terminal-side POST (`uv run scripts/<helper>.py` or a direct `httpx` call). Without reloading the page, assert the affected region's DOM changed. This is the single most important assertion. It proves the SSE-as-invalidation contract end to end: server `publish()`, named event, htmx re-fetch, swap, re-render.
3. **Assert zero console errors.** Collect `console` and `pageerror` events. A non-empty list means a broken SRI hash (script blocked), a missing global (`hljs` or `mermaid` not defined), or a render exception. Any console error is a Phase 4 failure. Fix it, do not note it.
4. **Spot-check render and layout.** Confirm a seeded markdown region rendered, with fenced code highlighted and a mermaid SVG present, and that no wide artifact overflowed its panel (compare `scrollWidth` to `clientWidth` on markdown regions).

A throwaway PEP 723 Playwright script in `/tmp/` is the right tool. Use `# /// script` with `dependencies = ["playwright"]`, run with `uv run`, then `uv run playwright install chromium` once. Keep the assertions in the script's exit code so a failure is a non-zero exit, not a console note.

**Check-in cadence.**

Phases 1 through 3 run fast, as single foreground agents or one backgrounded agent each. Check in after each phase by booting and curling. When a phase is backgrounded, use escalating check-ins (about 30 seconds, then 2 minutes, then 5 minutes, then every 5 minutes after) and run one `wc -l` across the files in flight:

```bash
wc -l {{ slug }}/app.py {{ slug }}/templates/index.html {{ slug }}/templates/partials/*.html {{ slug }}/scripts/*.py {{ slug }}/work-log-*.md
```

Report compactly per check-in: file, line count, what section is done, and what is in progress.

**Stuck detection.**

A file with an identical line count across two consecutive check-ins is stuck. Recover by launching a fresh `Agent` with the current file state and a "skip completed sections, finish the rest" prompt, and let the original backgrounded agent finish or time out on its own.

A different stuck signature is unique to this skill. The app boots and partials curl fine, but the browser shows nothing live. That is always one of the catalog gotchas: a wrong SRI hash, the CommonJS highlight.js build, mermaid running before sanitize, or `networkidle` in the test. Re-read `references/cdn-deps.md` rather than guessing.

## Phase 5 — Deliver

Present inline:

```markdown
## Workbench ready: {{ slug }}

**Run it:**

- `uv run {{ slug }}/app.py` → http://127.0.0.1:{{ port }}
- Terminal half: `uv run {{ slug }}/scripts/<helper>.py`

**Files:**

- `{{ slug }}/app.py` — Flask backend (schema, SSE fan-out, partials, terminal endpoints)
- `{{ slug }}/templates/index.html` — the page (CDN+SRI, render engine, overlays)
- `{{ slug }}/templates/partials/*.html` — per-region fragments
- `{{ slug }}/scripts/*.py` — terminal helpers (PEP 723 httpx)

**Data model:** {{ one line — the core tables and the collision/join that gives the unique value }}
**The loop:** {{ one line — what the human writes in the browser, what the terminal answers }}
**Verified:** headless Chrome — terminal POST updated {{ region }} live with no reload, zero console errors.
```

## Inline mode (no subagents)

For a small workbench, run all five phases inline in the forked context. Examples are a single-table eval viewer, a status board with one live region, or "add a collisions rail to the workbench I already have." There are no subagents and no separate work logs. The rhythm is still write-protocol: edit `app.py`, boot, edit `index.html`, open the browser, edit, re-check. Phase 4's headless assertion still applies. A workbench you did not watch update live in a browser is not verified.

Use the full pipeline, with backgrounded subagents per phase, when the schema is large, when there are many live regions, or when the user wants several workbenches at once.
