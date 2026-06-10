# Workbench build log — {{ workbench-type }}

**Status:** IN PROGRESS
**Workbench type:** {{ eval-viewer | pr-review-room | agent-trace-replay | refactor-cockpit | data-cleanup | prompt-skill-lab | adr-board | incident-timeline | migration-planner | custom }}
**Slug:** {{ slug }}
**Working directory:** `{{ slug }}/`
**Artifacts you produce:** `{{ slug }}/app.py`, `{{ slug }}/templates/index.html`, `{{ slug }}/templates/partials/*.html`, `{{ slug }}/scripts/*.py`

<write_protocol>
Your output file is the single source of truth for your work. Edit it after every meaningful step, before starting the next one. Partial progress written to disk survives timeouts, SendMessage interrupts, and orchestrator context pressure; state held in working memory does not.

The rhythm is: one unit of thought -> edit the file with the outcome -> next unit. One decision at a time.

Work through your sections in numbered order. For each section:

1. Think through the decision or draft. Read adjacent files, the real workbench source, or run the app when the answer is not in your head.
2. Edit the file under that section — the choice you are making, the evidence behind it, the tradeoff accepted. Cite sources inline.
3. If the section needs more depth, do another unit of thought and edit again.
4. Move to the next section only after the current one has real content.

Name the tradeoff on every non-obvious call. "Chose Chart.js over Observable Plot because it ships tooltips/legends in config and drops the d3 dependency" beats "used Chart.js." The critic reads these attributions.

When every section has real content, change the `Status:` line at the top of the file from `IN PROGRESS` to `COMPLETE`.
</write_protocol>

The reference workbenches are the working, verified implementations — read them before you invent anything:

- Eval viewer: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/` (`app.py`, `templates/index.html`, `templates/partials/*`, `scripts/*`).
- PR review room with the two-way human↔agent loop: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/` (`app.py`, `templates/*`, `scripts/review_loop.py`).

The CDN dependency catalog with verified SRI hashes, the gotchas list, and the recipe catalog live in `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/orchestrator.md`. Read it once at the start — it is the source of truth for every hash and every trap below.

---

## Contents

- Route — what KIND of workbench, and what is the shared state
- Scaffold backend — `app.py`
- Build UI — `templates/index.html` + `templates/partials/*`
- Wire the loop — terminal helper scripts + genuine two-way channel
- Verify — headless browser, live SSE, zero console errors
- Work log
  - {{ timestamp-or-step }}: {{ what was done }}
- Validation
  - Self-checks
- Summary

## 1. Route — what KIND of workbench, and what is the shared state

This is the heart of the build: **the data model is the design.** Everything downstream (panels, SSE regions, loop endpoints) falls out of the schema you commit here. Get this wrong and Phase 2–4 thrash.

What to capture:

- **Workbench type and the one job it does.** Which recipe from the catalog (eval viewer · PR review room · agent trace replay · refactor cockpit · data-cleanup · prompt/skill lab · ADR board · incident timeline · migration planner), or a custom variant. Name the one decision a human makes in the browser that the terminal cannot make alone.
- **The SQLite schema.** Tables, columns, the enums (e.g. eval `status` is `pass | fail | needs-review` — `workbench/app.py:69`; PR-room `requests.kind` is `ask | investigate | draft-comment | merge-check | summarize` — `pr-workbench/app.py:89`). Name the interconnections — what foreign-key or join makes the data feel real rather than a flat list (PR room joins `prs` ↔ `pr_files` ↔ `concerns` to detect file collisions across PRs).
- **The live regions.** Which named SSE events the UI subscribes to (eval viewer: `eval-board`, `run-summary`, `event-log`, `run-history` — `workbench/app.py:271-353`). Each region is one partial + one named event. List them now; they become the `GET /partials/<region>` routes in Phase 2.
- **The two-way channel.** What does the human ask the agent, and how does the agent answer? This is the line between a workbench and a read-only dashboard. Name the table and the endpoints (PR room: `requests` table + `/claude/queue` pull + `/claude/respond` — `pr-workbench/app.py:86`, `scripts/review_loop.py`). If the type is genuinely one-directional, say so and justify it.

Tradeoff to name: why THIS data model over a flatter or richer one. The schema is cheap to change now and expensive to change after the UI binds to it.

## 2. Scaffold backend — `app.py`

Build the boring-on-purpose backend: Flask + raw `sqlite3` (no ORM) + Jinja partials, 127.0.0.1 only, no auth, no build step. Mirror `workbench/app.py` structure.

What to capture:

- **Schema + `init_db()` with seeded, interconnected, realistic data.** Seed only when the table is empty so reruns don't duplicate (`workbench/app.py:131`). Seed at least one rich GFM note with a fenced code block, a `mermaid` fence, and a table so the render pipeline is exercised on first load (`workbench/app.py:159-176`). Capture the seed shape you chose and why it tells a believable story.
- **SSE fan-out + `publish(*targets)`.** The set-of-subscriber-queues pattern with a lock (`workbench/app.py:42-63`); `publish` puts a NAMED target onto every queue. Record that you kept the event as an invalidation signal, never data transport.
- **`GET /partials/<region>` routes + render helpers.** One query per partial so the htmx swap and the full-page render share one source of truth (`workbench/app.py:194-245`). List the routes you wired.
- **Human action endpoints (htmx POST).** Each writes SQLite, returns the swapped fragment, AND calls `publish(...)` for every region it invalidated (`workbench/app.py:261-292`). Note which regions each action touches.
- **Terminal-side endpoints.** JSON in / JSON out (the terminal doesn't want HTML), each publishes SSE so the browser updates live while Claude works (`workbench/app.py:300-365`).
- **`app.run(host="127.0.0.1", port=..., debug=True, threaded=True)`** — `threaded=True` so the long-lived SSE stream doesn't block other requests; `debug=True` for hot reload while you reshape the UI mid-session (`workbench/app.py:396-397`). Record the port you chose (avoid collisions with a running reference workbench).

Tradeoff to name: any place you departed from the reference — extra table, different publish granularity, a coalesced endpoint.

## 3. Build UI — `templates/index.html` + `templates/partials/*`

Wire the CDN tags with verified SRI, the design tokens and panels, the htmx SSE extension, the markdown/mermaid/highlight engine, the overlays, and the per-region partials.

What to capture:

- **CDN tags with verified SRI hashes**, copied from the catalog in `orchestrator.md`. Record which libraries you actually included (htmx + htmx-ext-sse always; marked + marked-highlight + highlight.js + DOMPurify for rendering; mermaid for diagrams; Chart.js only if you need live charts). Note the favicon inline SVG to silence the 404.
- **Single EventSource on `<body>`:** `hx-ext="sse" sse-connect="/events"`. Each live region carries `hx-trigger="sse:<region>"` + `hx-get="/partials/<region>"` so one named event re-fetches exactly that one partial. Confirm you used the named-event pattern, not a global refresh.
- **The render pipeline** (composes capabilities, still no build step): marked (GFM) + marked-highlight → highlight.js for fenced code; leave ```mermaid fences untouched in the highlight callback and re-emit as `<pre class="mermaid">`; DOMPurify.sanitize with `{ADD_TAGS:['pre'], ADD_ATTR:['class']}`; then `mermaid.run({nodes})` AFTER the HTML lands. Re-run the whole pipeline on `htmx:afterSwap` so SSE-swapped fragments render. Record that you wired the afterSwap hook — without it, live updates render as raw markdown.
- **Layout + progressive disclosure.** Design tokens, panels, and the chip → modal / sheet pattern for dense surfaces (wide tables and diagrams collapse to compact chips that open a centered modal; full text opens a right sheet). Note the grid guards you applied: `min-width:0` + `overflow-wrap:anywhere` on grid items, and `white-space:nowrap` + a scrollable container for pill rows.
- **Per-region partials** echoing the named-event `hx-trigger` pattern, plus Chart.js lifecycle if used: create the chart once, then `chart.update()` on the SSE event — you cannot `new Chart()` twice on one canvas.

Tradeoff to name: every library you left OUT. "Dropped d3 + Observable Plot for Chart.js — one self-contained bundle, tooltips/legends/animation in config." "Skipped Chart.js entirely — this workbench has no time-series."

## 4. Wire the loop — terminal helper scripts + genuine two-way channel

Make it a workbench, not a dashboard. The human acts in the browser; the terminal/Claude acts via httpx; both share one SQLite file and see the same state live.

What to capture:

- **PEP 723 inline-dep helper scripts** run with `uv run script.py` (`# /// script` … `dependencies = ["httpx"]` — `pr-workbench/scripts/review_loop.py:1-4`). Record each script and the endpoint it drives.
- **The human→agent channel closes the loop.** A `requests` table the human writes to from the browser, a `/claude/queue` the terminal pulls, and a `/claude/respond` (or `/claude/note`, `/claude/eval-result`) the terminal posts back — the human steers, the agent answers, both watch it land live (`pr-workbench/app.py:86`, `scripts/review_loop.py:20-34`). Confirm the channel is genuinely bidirectional. If you find it is read-only, that is a defect to fix here, not to defer.
- **The agent→human read-back.** An endpoint like `/claude/feedback` that lets the terminal read what the human marked, so the agent's next action is informed by human input (`workbench/app.py:357-365`).
- **Realistic helper behavior.** The demo answers in `review_loop.py:37-57` are illustrative; note where a real session would synthesize the response from the actual diff/trace/data instead.

Tradeoff to name: how rich the terminal helper is. A thin curl-equivalent versus a script that pulls the queue and loops — and why that fits this workbench.

## 5. Verify — headless browser, live SSE, zero console errors

The browser catches what curl cannot: SRI mismatches, missing JS globals, layout overflow. Verification is not optional and a non-zero result is a blocker, not a footnote.

What to capture:

- **Headless run via Playwright (Chrome), navigating with `domcontentloaded`, never `networkidle`** — the open SSE stream keeps the network perpetually active, so `networkidle` never fires and times out at 30s. Record the exact wait strategy you used.
- **The live-update assertion (the load-bearing test).** Open the browser, fire a terminal-side POST (the helper script or a curl), and assert the already-open page updated via SSE with **no reload**. This proves the named-event → partial-refetch path end to end. Record what you POSTed and which region changed.
- **Zero console errors.** Capture the console listener output. Common failures and their causes, all from the gotchas list: integrity mismatch → you hashed compressed bytes (re-hash with `Accept-Encoding: identity`); "require is not defined" → you used the CommonJS highlight.js build instead of `@highlightjs/cdn-assets`; unstable hash on marked-highlight → you used the `.min.js` instead of the non-min `lib/index.umd.js`; "d3 is not defined" → Observable Plot loaded before d3 (prefer Chart.js).
- **Layout check.** Confirm wide tables/diagrams stay inside their panel (the `min-width:0` grid fix) and pills scroll rather than stacking vertically. Note the viewport(s) you checked.
- **Result.** PASS only when: a terminal POST updates an open browser with no reload, AND the console is clean, AND nothing overflows. If any check fails, fix it and re-run — do not flip Status to COMPLETE on a failing verify.

Tradeoff to name: any assertion you scoped down and why (e.g. checked one region's live update rather than all four because they share the same SSE path).

---

## Work log

{{ the agent fills this per the write protocol — one entry per meaningful action }}

### {{ timestamp-or-step }}: {{ what was done }}

{{ what changed, which file/section was edited, which reference source was consulted, any tradeoff named }}

---

## Validation

### Self-checks

- [ ] Data model committed in §1 and the UI/loop bind to it without rework
- [ ] `app.py` runs on 127.0.0.1, threaded, with seeded interconnected data
- [ ] Every CDN tag carries a verified SRI hash from the catalog
- [ ] Single EventSource on `<body>`; each region uses the named-event `hx-trigger` pattern
- [ ] Render pipeline re-runs on `htmx:afterSwap`
- [ ] Two-way channel is genuinely bidirectional (not a read-only dashboard)
- [ ] Headless verify uses `domcontentloaded`; a terminal POST updates the open browser via SSE with no reload
- [ ] Zero console errors; no layout overflow
- [ ] Tradeoffs named on every non-obvious call
- [ ] `Status:` flipped to `COMPLETE`

---

## Summary

{{ one paragraph — what this build produced, where the files live, the workbench type and its data model in one line, and any decision worth flagging for the orchestrator or the next builder. Example: "Built a PR review room at `pr-room/`; schema joins prs ↔ pr_files ↔ concerns to detect file collisions and suggest a merge order — the unique multi-PR value. Chose Chart.js over Observable Plot for the live concern-count chart to drop the d3 dependency. Verified: a `review_loop.py` POST updated the open board's merge-order panel via SSE with no reload, console clean." }}
