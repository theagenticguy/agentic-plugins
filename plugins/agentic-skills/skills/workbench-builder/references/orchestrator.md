# Workbench Builder Orchestrator

The orchestrator runs inside a forked subagent so the main conversation stays clean of check-in noise, tool chatter, and scaffolding. It routes the user's ask through five phases: Route, Scaffold backend, Build UI, Wire the loop, and Verify. It produces a running app on `127.0.0.1`. The deliverable is not a document — it is a live workbench you can open in a browser while Claude works the terminal. Progress is `wc -l` on the files being built, plus a final headless-browser assertion.

The whole build is reversible and local. There is no deploy, no auth, and no shared state outside one SQLite file in the working directory. Proceed without approval gates when the ask is clear. The pipeline mirrors the verified implementations under `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/` and `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/`. Read those when a phase needs a concrete pattern.

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
- `references/dependencies.md` is the pinned dependency set and the Astryx grounding commands. Load it before Phases 1 and 2.
- `references/recipes.md` is the workbench-type catalog. Load it in Phase 0.
- `templates/` is the Phase 1–3 starting point: `server.ts`, `index.html`, `package.json`, `src/` (App, useRegion, charts, components), `terminal-helper.ts`, `worklog-skeleton.md`.

## Phase tracking

Before Phase 0, create five todo items: Route, Scaffold backend, Build UI, Wire the loop, Verify. Flip each to `in_progress` on entry and `completed` on exit. When a phase runs as a backgrounded subagent, also `TaskCreate` one item for that subagent and flip it when its work log shows `Status: COMPLETE`.

## Phase 0 — Route

This is the heart of the build. Everything downstream is a consequence of one decision: what is the shared state, and who writes to it? The data model is the design. Pick it wrong and the UI is decoration over the wrong table.

Route in one pass.

1. **What KIND of workbench?** Match the ask against `references/recipes.md`. If the ask matches a recipe, lift its schema as the starting point. If it is a blend, name the closest recipe and note the deltas.
2. **What is the shared state?** Name the core tables and their relationships. The PR room's value is the `pr_files` join that yields cross-PR collisions; the eval viewer's is `evals` carrying human and agent columns side by side. Write the schema down before any code.
3. **Who writes each table: human, terminal, or both?** A genuine workbench has at least one table the human writes from the browser and at least one path the terminal writes via `fetch`. If you cannot name both, the ask is a dashboard. Say so, and confirm the user wants the loop.
4. **What are the live regions?** Each independently refreshing UI region maps to one named SSE event, one entry in the server's `regions` record, and one `useRegion` subscription. List them. The eval viewer uses `board`, `summary`, `run-history`, `queue`, `event-log`.

Announce the plan inline in one short paragraph: workbench type, the tables, who writes what, and the live regions. Then move to Phase 1 without gating. Use `AskUserQuestion` exactly once, and only if the workbench type or the data model is genuinely ambiguous ("review my agent's work" — trace replay or eval viewer?). Do not gate on cosmetic choices like theme, port, or copy. Make a defensible call and note it inline.

## Phase 1 — Scaffold backend

**Goal:** a booting `server.ts` whose `/api/regions/*` routes return JSON. By the end of this phase, `bun --hot {{ slug }}/server.ts` runs and every region curls clean.

**Load:** `templates/server.ts`, `templates/package.json`, the matched recipe section of `references/recipes.md`, and `eval-viewer/server.ts` as the worked reference.

**Concrete steps.**

1. `mkdir -p {{ slug }}/src/components {{ slug }}/scripts`; copy `templates/package.json` (rename it), `templates/index.html`, and `templates/server.ts` into `{{ slug }}/`; run `bun install` once. Trim `package.json` to what the recipe uses — no charts → drop `echarts`, no diagrams → drop `mermaid` (see `doc-review/package.json`).
2. **Schema.** Write the `db.exec` schema string from the Phase 0 data model. Raw SQL, no ORM. `ON DELETE CASCADE` on child tables; the three PRAGMAs (`journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`) come first. Keep the `requests` table whenever the loop needs queued asks.
3. **SSE fan-out.** Keep the `subscribers` set, `publish(...regions)`, and `sseResponse()` from the template verbatim — it is the spine of the design. The `/events` route must call `server.timeout(req, 0)`.
4. **Seed believable, interconnected data.** Flat seed data makes the workbench look dead. Seed at least one row that exercises every render capability the UI will have (the eval viewer seeds a note with a fenced mermaid block and two runs so both charts draw on first boot). Guard with a count check.
5. **Region queries.** One entry in the `regions` record per live region, served by the single `/api/regions/:name` route.
6. **Mutation endpoints.** JSON in, `{ok: true}` out, `publish()` naming every region the write affected. Browser and terminal share these routes — there is no separate HTML path.
7. **The run line.** `Bun.serve({ hostname: "127.0.0.1", port: <free port>, routes: {...} })` with `"/": homepage` from the `index.html` import. Pick a port that avoids the references (5050 eval viewer, 5057 doc-review).

**Subagent prompt shape.** Scaffolding is mechanical once the data model is fixed, so run it foreground as a single agent unless the schema is large. When delegating:

```text
You are scaffolding the Bun backend for a {{ workbench_type }} workbench.

<scope>
Data model (from Phase 0): {{ tables + who-writes-what + live regions }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/server.ts (copied from templates/server.ts)
Your work log: {{ absolute_path }}/work-log-backend.md
</scope>

<responsibilities>
Fill server.ts: schema, seed (believable, interconnected, render-path-exercising),
publish() fan-out kept verbatim, one regions-record entry per live region,
JSON mutation endpoints that publish what they change, the /claude queue/respond
pair when the loop needs it, and the 127.0.0.1 Bun.serve block. Keep the inline
comments that explain the SSE-as-invalidation contract.
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/recipes.md — your recipe's schema.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/architecture.md — the contract.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/server.ts — worked reference.
</reference_material>

<write_protocol>
{{ paste ${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- `bun --hot server.ts` boots with no error; every /api/regions/<name> returns JSON via curl.
- Seed data exercises every render capability the UI will need.
- Every mutation endpoint publishes the regions it changed.
- /events calls server.timeout(req, 0) and emits hello + keep-alive frames.
- Flip Status to COMPLETE when the app boots and all regions respond.
</quality_bar>
```

**Check-in:** boot the app and curl each region route. Do not trust curl for the SSE round trip — that is Phase 4's headless-browser job.

## Phase 2 — Build UI

**Goal:** `src/main.tsx`, `src/App.tsx`, and one component per live region, composed from Astryx components. By the end, opening the page shows regions that populate on mount and re-fetch on their named SSE events.

**Load:** `templates/src/` (all of it), `references/dependencies.md` (the grounding commands), `references/rendering.md`, and `eval-viewer/src/` as the worked reference.

**Ground before you write.** Astryx component APIs are queried, never recalled. Before any JSX that uses a component, run `bunx astryx component <Name> --detail brief` (or `--json`) for its real import path and props — the CLI reads the installed manifest, so it is offline-safe and version-exact. `bunx astryx search "<need>"` finds candidates. Props that look obvious are not: `Collapsible` takes `trigger`, `Button` takes `label`, `TextArea`'s handler is `changeAction`. Every prop in the reference implementations was confirmed this way.

**Concrete steps.**

1. **`main.tsx`:** the four CSS imports (reset, astryx, `./theme/graphite-fonts.css`, `./theme/graphite.css`) then `createRoot` inside `<Theme theme={graphiteTheme} mode="light">`. Copy `templates/graphite-theme/`'s built artifacts into `src/theme/`. Every workbench runs Graphite; distinctness comes from ONE `--wb-header-accent` override in `index.html` (`dependencies.md` has the selector and the assigned accents) so two open side-by-side are never confused.
2. **`useRegion.ts`:** copy verbatim from templates. One module-level `EventSource`; every region component subscribes by name.
3. **One component per region** under `src/components/`, each opening with `const data = useRegion<T>("<region>")` and tolerating the initial `null`. Give each region root a `data-testid` — Phase 4 waits on these.
4. **Compose in `App.tsx`.** Astryx layout primitives (`VStack`, `HStack`, numeric `Grid`) for symmetric structure; plain CSS grid for fr-ratio splits. Put `minWidth: 0` on every column that renders rich content.
5. **Charts:** copy `charts.ts` + `components/Chart.tsx` from templates; keep option builders pure functions of region rows; register every chart type drawn. The palette literals are already Graphite — re-key `STATUS_COLORS` to the status names this workbench's rows actually carry, or every slice paints `SERIES[0]` (the pairing rule in `rendering.md`).
6. **Markdown and diagrams:** Astryx `Markdown` for GFM; the `<Mermaid>` wrapper for diagrams; mount self-measuring content only while its disclosure is open.
7. **The live LED:** `useSseStatus()` driving a `StatusDot` in the header, so the human can see the stream is connected.

**Subagent prompt shape.**

```text
You are building the React UI for a {{ workbench_type }} workbench.

<scope>
Live regions (from Phase 0): {{ region list — each maps to useRegion("<name>") + /api/regions/<name> }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/src/ (copied from templates/src/)
Your work log: {{ absolute_path }}/work-log-ui.md
</scope>

<responsibilities>
Write main.tsx (CSS imports + the Graphite Theme provider), one component per live region (useRegion,
data-testid on the root, tolerate null), and App.tsx composition. Ground EVERY
Astryx component's props via `bunx astryx component <Name>` before using it —
never from memory. Charts are pure option builders through the Chart wrapper.
minWidth:0 on rich-content columns. Mount mermaid/charts only into visible boxes.
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/dependencies.md — grounding commands + the Graphite theme (wiring, rebuild, per-workbench accent).
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/rendering.md — markdown/mermaid/ECharts patterns.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/src/ — worked reference.
</reference_material>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Every Astryx prop used exists in the installed manifest (bunx astryx component <Name>).
- Each live region fills on mount and re-fetches on its named SSE event.
- Rich content (markdown, mermaid, charts) renders without escaping its panel.
- data-testid on every region root.
- Flip Status to COMPLETE when the page loads and regions populate.
</quality_bar>
```

## Phase 3 — Wire the loop

**Goal:** the terminal helper scripts, and proof the human→agent channel is genuinely two-way. By the end, a terminal command changes state the browser reflects live, and (when the recipe has a queue) the terminal pulls what the human asked and posts answers back.

**Load:** `templates/terminal-helper.ts`, and the reference scripts (`eval-viewer/scripts/record-result.ts`, `eval-viewer/scripts/review-loop.ts`, `doc-review/scripts/review.ts`).

**Concrete steps.**

1. **Helpers are plain TypeScript** run with `bun run scripts/<name>.ts` — global `fetch`, zero dependencies, `BASE = "http://127.0.0.1:<port>"`, one-line confirmation per action, throw on non-2xx.
2. **Ingest/record helpers** push analyzed state in; each triggers a server-side `publish()`, so the browser updates with no reload.
3. **The queue loop** pulls `GET /claude/queue` (which flips `queued → working` — pulling is claiming, the human sees the badge move), does the work, POSTs `/claude/respond`. Read back the human's decisions via the recipe's feedback path (`/claude/feedback`, or a filtered region like `annotations?status=open`).
4. **Confirm it is not a dashboard.** Trace one full round trip on paper: human clicks → row changes + SSE fires → terminal reads the change → terminal writes a response → SSE fires → browser shows it. Any missing leg means the loop is not closed.

**Subagent prompt shape.**

```text
You are writing the terminal-side helpers that close the human<->agent loop for a
{{ workbench_type }} workbench.

<scope>
Terminal endpoints (from Phase 1): {{ list — ingest/record + queue/respond if present }}
Working directory: {{ absolute_path }}/
Starting skeleton: {{ absolute_path }}/scripts/<name>.ts (from templates/terminal-helper.ts)
Your work log: {{ absolute_path }}/work-log-loop.md
</scope>

<responsibilities>
Write zero-dependency bun scripts (global fetch): one to push analyzed state in,
and — if the workbench has a request queue — one that pulls /claude/queue, does
the work, and POSTs /claude/respond. One-line confirmation each. Verify a
terminal POST changes a browser-visible region (the server publishes on write).
</responsibilities>

<reference_material>
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/scripts/review-loop.ts — pull/respond loop.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/scripts/record-result.ts — record helper.
${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/scripts/review.ts — list/resolve CLI shape.
</reference_material>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Each helper runs with `bun run` and exits 0 with a one-line confirmation.
- A terminal POST changes a browser-visible region via SSE (no reload).
- The human->agent channel is genuinely two-way.
- Flip Status to COMPLETE when the round trip works end to end.
</quality_bar>
```

## Phase 4 — Verify

**Goal:** prove the workbench works the way the design claims, with a real headless browser. curl cannot catch a missing chart registration, a wrong Astryx prop, or layout overflow. The browser can. This phase is not optional.

**The assertion.** A throwaway PEP 723 Playwright script in `/tmp/` is the right tool (`# /// script` + `dependencies = ["playwright"]`, run with `uv run`; `uv run playwright install chromium` once). Keep the assertions in the exit code.

1. **Navigate with `domcontentloaded`, never `networkidle`.** Two long-lived connections keep the network permanently active — the SSE stream AND Bun's HMR websocket — so `networkidle` never fires.
2. **`domcontentloaded` is not enough for content.** React content arrives after hydration and the first `useRegion` fetch. After navigating, `page.wait_for_selector('[data-testid="<region>"]', timeout=20000)`. Bun transpiles TSX on the first request, so give the first load a generous timeout; subsequent loads are instant.
3. **Assert the SSE round trip with no reload.** With the page open, run a terminal helper from a separate process (`bun run scripts/<helper>.ts`) and assert the affected region's DOM changed without a reload. This is the single most important assertion — it proves publish → named event → refetch → re-render end to end.
4. **Assert zero console errors.** Collect `console` (error level) and `pageerror` events; assert both empty. If a negative test intentionally provokes an error response, filter that expected entry explicitly.
5. **Spot-check render and layout.** Seeded markdown rendered; a mermaid SVG present (inside an OPEN disclosure — expand it first); charts drew a canvas; no wide artifact overflows (`scrollWidth <= clientWidth` on region roots).
6. **Recipe-specific assertions.** doc-review: select a span crossing an HTML entity, save, assert the painted `<mark>` equals the selection; assert a drifted anchor gets a 409.

**Check-in cadence.** Phases 1–3 run fast, as single foreground agents or one backgrounded agent each. Check in after each phase by booting and curling. When a phase is backgrounded, use escalating check-ins (about 30s, then 2m, then 5m, then every 5m) and one `wc -l` across the files in flight:

```bash
wc -l {{ slug }}/server.ts {{ slug }}/src/*.tsx {{ slug }}/src/components/*.tsx {{ slug }}/scripts/*.ts {{ slug }}/work-log-*.md
```

**Stuck detection.** A file with an identical line count across two consecutive check-ins is stuck: launch a fresh `Agent` with the current file state and a "skip completed sections, finish the rest" prompt, and let the original finish or time out on its own.

Two stuck signatures are specific to this stack. (a) The page loads but a region never populates: check the three-strings-match rule (`publish` name = SSE event = `useRegion` arg) and that the region components tolerate `null`. (b) A component renders nothing or throws prop errors: the Astryx prop was guessed, not grounded — re-run `bunx astryx component <Name>` and fix the JSX.

## Phase 5 — Deliver

Present inline:

```markdown
## Workbench ready: {{ slug }}

**Run it:**

- `bun --hot {{ slug }}/server.ts` → http://127.0.0.1:{{ port }}
- Terminal half: `bun run {{ slug }}/scripts/<helper>.ts`

**Files:**

- `{{ slug }}/server.ts` — Bun backend (schema, SSE fan-out, regions, terminal endpoints)
- `{{ slug }}/src/` — React UI on Astryx (App, useRegion, one component per region)
- `{{ slug }}/scripts/*.ts` — terminal helpers (zero-dependency bun scripts)

**Data model:** {{ one line — the core tables and the join/split that gives the unique value }}
**The loop:** {{ one line — what the human writes in the browser, what the terminal answers }}
**Verified:** headless Chrome — terminal POST updated {{ region }} live with no reload, zero console errors.
```

## Inline mode (no subagents)

For a small workbench, run all five phases inline in the forked context: a single-table board, one or two live regions, or "add a collisions rail to the workbench I already have." No subagents, no separate work logs. The rhythm is still write-protocol: edit `server.ts`, boot, edit `src/`, open the browser (`--hot` repaints as you save), re-check. Phase 4's headless assertion still applies — a workbench you did not watch update live in a browser is not verified.

Use the full pipeline, with backgrounded subagents per phase, when the schema is large, when there are many live regions, or when the user wants several workbenches at once.
