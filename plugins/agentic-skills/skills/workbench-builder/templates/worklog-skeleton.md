# Workbench build log — {{ workbench-type }}

**Status:** IN PROGRESS
**Workbench type:** {{ eval-viewer | doc-review | pr-review-room | agent-trace-replay | refactor-cockpit | data-cleanup | prompt-skill-lab | adr-board | incident-timeline | migration-planner | custom }}
**Slug:** {{ slug }}
**Working directory:** `{{ slug }}/`
**Artifacts you produce:** `{{ slug }}/server.ts`, `{{ slug }}/src/App.tsx`, `{{ slug }}/src/components/*.tsx`, `{{ slug }}/scripts/*.ts`

<write_protocol>
Your output file is the single source of truth for your work. Edit it after every meaningful step, before starting the next one. Partial progress written to disk survives timeouts, SendMessage interrupts, and orchestrator context pressure; state held in working memory does not.

The rhythm is: one unit of thought -> edit the file with the outcome -> next unit. One decision at a time.

Work through your sections in numbered order. For each section:

1. Think through the decision or draft. Read adjacent files, the real workbench source, or run the app when the answer is not in your head.
2. Edit the file under that section — the choice you are making, the evidence behind it, the tradeoff accepted. Cite sources inline.
3. If the section needs more depth, do another unit of thought and edit again.
4. Move to the next section only after the current one has real content.

Name the tradeoff on every non-obvious call. "Split the note on mermaid fences and interleaved Markdown/Mermaid components because Astryx Markdown renders fences as code, not diagrams" beats "rendered the note." The critic reads these attributions.

When every section has real content, change the `Status:` line at the top of the file from `IN PROGRESS` to `COMPLETE`.
</write_protocol>

The reference workbenches are the working, browser-verified implementations — read them before you invent anything:

- Eval viewer: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/` (`server.ts`, `src/`, `scripts/*.ts`).
- Doc review / redline with char-perfect selection anchoring: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/` (`server.ts`, `src/components/Document.tsx`, `scripts/review.ts`).

The pinned dependency set and Astryx grounding commands live in `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/references/dependencies.md`; the recipe catalog in `references/recipes.md`; the SSE/loop contract in `references/architecture.md`. Read them once at the start.

---

## Contents

- Route — what KIND of workbench, and what is the shared state
- Scaffold backend — `server.ts`
- Build UI — `src/`
- Wire the loop — terminal helper scripts + genuine two-way channel
- Verify — headless browser, live SSE, zero console errors
- Work log
  - {{ timestamp-or-step }}: {{ what was done }}
- Validation
  - Self-checks
- Summary

## 1. Route — what KIND of workbench, and what is the shared state

This is the heart of the build: **the data model is the design.** Everything downstream (regions, components, loop endpoints) falls out of the schema you commit here. Get this wrong and Phases 2–4 thrash.

What to capture:

- **Workbench type and the one job it does.** Which recipe from the catalog, or a custom variant. Name the one decision a human makes in the browser that the terminal cannot make alone.
- **The SQLite schema.** Tables, columns, the enums (e.g. eval `outcome` is `pending | pass | fail` and `status` is `unreviewed | approved | flagged` — `eval-viewer/server.ts`). Name the interconnections — what foreign key or join makes the data feel real rather than a flat list.
- **The live regions.** Which named SSE events the UI subscribes to (eval viewer: `board`, `summary`, `run-history`, `queue`, `event-log`). Each region is one `regions`-record query + one `useRegion` subscription. List them now.
- **The two-way channel.** What does the human ask the agent, and how does the agent answer? This is the line between a workbench and a read-only dashboard. Name the table and the endpoints (`requests` + `/claude/queue` + `/claude/respond`; read-back via `/claude/feedback` or a filtered region). If the type is genuinely one-directional, say so and justify it.

Tradeoff to name: why THIS data model over a flatter or richer one. The schema is cheap to change now and expensive after the UI binds to it.

## 2. Scaffold backend — `server.ts`

Build the backend: Bun.serve + bun:sqlite, 127.0.0.1 only, no auth, no bundler config. Mirror `eval-viewer/server.ts` structure.

What to capture:

- **Schema + seed with interconnected, realistic data.** Seed only when the table is empty so `--hot` restarts don't duplicate. Seed at least one row that exercises every render capability the UI will have (a note with a mermaid fence, rows that make both charts draw). Capture the seed shape you chose and why it tells a believable story.
- **SSE fan-out + `publish(...regions)`.** The subscriber-set pattern kept verbatim from `templates/server.ts`; `/events` calls `server.timeout(req, 0)`. Record that events stay invalidation signals, never data transport.
- **Region queries.** One `regions`-record entry per live region behind the single `/api/regions/:name` route — one query, every caller. List them.
- **Mutation endpoints.** JSON in, `{ok: true}` out, `publish()` naming every region the write affected. Browser and terminal share these routes. Note which regions each action touches.
- **The serve block.** `Bun.serve({ hostname: "127.0.0.1", port: ..., routes: { "/": homepage, ... } })`. Record the port (avoid 5050 eval-viewer, 5057 doc-review).

Tradeoff to name: any place you departed from the reference — extra table, different publish granularity, a coalesced endpoint.

## 3. Build UI — `src/`

Compose the page from Astryx components: `main.tsx` (CSS imports + theme), one component per live region, `App.tsx` layout.

What to capture:

- **Grounding.** Every Astryx component's props confirmed via `bunx astryx component <Name>` before writing JSX — record which components you used and anything surprising in their APIs (`Collapsible` takes `trigger`; `TextArea`'s handler is `changeAction`). Never write an Astryx prop from memory.
- **Theme.** Which theme you picked and why (distinct per workbench; `dependencies.md` lists the seven).
- **Regions.** One component per region, each `useRegion<T>("<name>")`, tolerating the initial `null`, with `data-testid` on its root. Confirm the three-strings-match rule: publish name = SSE event = hook arg.
- **Rendering.** Astryx `Markdown` for GFM; the `<Mermaid>` wrapper for diagrams (mounted only while its disclosure is open); ECharts through the `Chart` wrapper with pure option builders and every drawn chart type registered. Chart palette literals aligned with the theme (the pairing rule in `rendering.md`).
- **Layout.** Astryx stacks/Grid for symmetric structure, plain CSS grid for fr-ratio splits, `minWidth: 0` on every rich-content column.

Tradeoff to name: every library you left OUT. "Dropped echarts and mermaid — this workbench renders no charts or diagrams" (see `doc-review/package.json`).

## 4. Wire the loop — terminal helper scripts + genuine two-way channel

Make it a workbench, not a dashboard. The human acts in the browser; the terminal acts via `fetch`; both share one SQLite file and see the same state live.

What to capture:

- **Zero-dependency bun scripts** run with `bun run scripts/<name>.ts` — global `fetch`, `BASE = "http://127.0.0.1:<port>"`, one-line confirmation per action (`eval-viewer/scripts/record-result.ts`). Record each script and the endpoint it drives.
- **The human→agent channel closes the loop.** A `requests` table the human writes from the browser, `/claude/queue` the terminal pulls (pulling is claiming — `queued → working`), `/claude/respond` posted back. Confirm the channel is genuinely bidirectional. If you find it is read-only, that is a defect to fix here, not defer.
- **The agent→human read-back.** An endpoint like `/claude/feedback` (or a filtered region like `annotations?status=open`) that lets the terminal read what the human marked, so the agent's next action is informed by human input.
- **Realistic helper behavior.** Demo answers in the loop scripts are illustrative; note where a real session synthesizes the response from the actual diff/trace/data instead.

Tradeoff to name: how rich the terminal helper is — a thin one-shot versus a polling loop — and why that fits this workbench.

## 5. Verify — headless browser, live SSE, zero console errors

The browser catches what curl cannot: a guessed Astryx prop, a missing chart registration, layout overflow. Verification is not optional and a non-zero result is a blocker, not a footnote.

What to capture:

- **Headless run via Playwright (Chrome), navigating with `domcontentloaded`, never `networkidle`** — the SSE stream AND Bun's HMR websocket keep the network perpetually active. Then wait on a region's `data-testid` selector (React content arrives after hydration + the first fetch; the first TSX transpile can take seconds). Record the exact wait strategy.
- **The live-update assertion (the load-bearing test).** With the page open, fire a terminal-side `bun run scripts/<helper>.ts` from a separate process and assert the already-open page updated via SSE with **no reload**. Record what you POSTed and which region changed.
- **Zero console errors.** Capture the console listener output. Common failures: a silently empty chart → the chart type is missing from `echarts.use([...])`; a component rendering nothing / prop errors → an Astryx prop was guessed, not grounded; a frozen region → the three-strings-match rule is violated.
- **Layout check.** `scrollWidth <= clientWidth` on rich-content region roots; a mermaid SVG present inside an OPEN disclosure.
- **Result.** PASS only when: a terminal POST updates an open browser with no reload, AND the console is clean, AND nothing overflows. If any check fails, fix it and re-run — do not flip Status to COMPLETE on a failing verify.

Tradeoff to name: any assertion you scoped down and why.

---

## Work log

{{ the agent fills this per the write protocol — one entry per meaningful action }}

### {{ timestamp-or-step }}: {{ what was done }}

{{ what changed, which file/section was edited, which reference source was consulted, any tradeoff named }}

---

## Validation

### Self-checks

- [ ] Data model committed in §1 and the UI/loop bind to it without rework
- [ ] `bun --hot server.ts` boots on 127.0.0.1 with seeded interconnected data; every region curls clean
- [ ] Every Astryx prop confirmed against the installed manifest
- [ ] One module-level EventSource; every region follows the three-strings-match rule
- [ ] Region components tolerate the initial `null`; `data-testid` on every region root
- [ ] Two-way channel is genuinely bidirectional (not a read-only dashboard)
- [ ] Headless verify uses `domcontentloaded` + testid waits; a terminal POST updates the open browser via SSE with no reload
- [ ] Zero console errors; no layout overflow
- [ ] Tradeoffs named on every non-obvious call
- [ ] `Status:` flipped to `COMPLETE`

---

## Summary

{{ one paragraph — what this build produced, where the files live, the workbench type and its data model in one line, and any decision worth flagging for the orchestrator or the next builder. Example: "Built a PR review room at `pr-room/`; schema joins prs ↔ pr_files ↔ concerns to detect file collisions and suggest a merge order — the unique multi-PR value. Dropped mermaid; the room draws no diagrams. Verified: a `bun run scripts/analyze-pr.ts` POST updated the open board's collisions rail via SSE with no reload, console clean." }}
