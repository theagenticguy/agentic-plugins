# Workbench Recipes

A workbench is one stack — Bun.serve + bun:sqlite + React 19 + Astryx + SSE invalidation — pointed at one data model. Every recipe below is the *same* runtime (`bun --hot server.ts` on `127.0.0.1`, the `publish()` fan-out, `useRegion` on the client, the JSON mutation path). What changes from recipe to recipe is the schema, the layout, and what the terminal half ingests.

**The data model is the design.** Phase 0 of the build (`references/orchestrator.md`) spends its time here, not on CSS. Once you know the tables, the columns, and the foreign keys, the regions, the `publish()` targets, and the terminal endpoints fall out almost mechanically — each table a human or the agent mutates becomes a `publish()` target and a `regions` entry. Pick the recipe whose data model is closest to your problem, then bend the columns to fit.

Each recipe gives four things:

- **Intent** — the one-line job.
- **Data model** — the SQLite tables and key columns. This is the load-bearing part.
- **Layout** — the panel shape in the browser.
- **Terminal ingests** — what the agent-side scripts POST in (and read back, when the loop is two-way).

The five leading recipes are *built and browser-verified* — read their source. The rest are sketches at the same altitude: enough to scaffold from, not yet hardened in a browser.

## Contents

- Eval viewer — BUILT
- Document review / redline — BUILT
- PR review room — BUILT
- Grid / spreadsheet triage — BUILT
- Multi-surface triage — BUILT
- Agent trace replay
- Refactor cockpit
- Prompt / skill lab
- Architecture decision board
- Incident timeline builder
- Migration planner
- Picking and bending a recipe

## 1. Eval viewer — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/` (`server.ts`, `src/`, `scripts/record-result.ts`, `scripts/review-loop.ts`). Port 5050, Graphite (`mode="light"`, header accent `#0a6961` teal — the theme default).

**Intent.** Scan a set of eval cases, mark each approved / flagged by hand, read notes from both the human and the agent, and watch the pass-rate trend move as the terminal re-runs the suite.

**Data model** (`eval-viewer/server.ts`). Four tables:

- `evals(id, name, prompt, expected, actual, claude_note, outcome, status, human_note, created_at)` — one row per case. **Split ownership on one row is what makes the loop concrete:** `actual`/`claude_note`/`outcome` are the terminal's columns; `status`/`human_note` are the browser's. Each side writes its own fields; both see the merged row.
- `runs(id, label, passed, failed, duration_s, created_at)` — a snapshot per suite run; feeds the stacked chart. The terminal appends via `/claude/run`; the browser never writes here.
- `events(id, kind, detail, eval_id, created_at)` — append-only activity log, the shared narration of who did what.
- `requests(...)` — the standard human→agent channel (`queued → working → answered`).

**Layout.** A board of eval cards (outcome badge + collapsible detail with prompt/expected/actual, the agent's note — which renders markdown and mermaid — and a verdict bar), an outcomes donut, a run-history stacked bar, the ask queue, the activity log. `eval-viewer/src/App.tsx` is the composition; each region is one component subscribed with `useRegion`.

**Terminal ingests.** `record-result.ts <name> <pass|fail>` upserts a case via `/claude/eval-result`; `record-result.ts --run <label> <passed> <failed>` snapshots a run via `/claude/run`. The closing-the-loop read is `GET /claude/feedback` — the terminal pulls back which cases the human approved or flagged, so the agent can react to verdicts. `review-loop.ts` drives the queue/respond pair.

## 2. Document review / redline — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/` (`server.ts`, `src/`, `scripts/review.ts`, `sample-doc.html`). Port 5057, Graphite (`mode="light"`, header accent `#274d7a` navy). Point at a real file with `REVIEW_DOC=/path/to/doc.html bun --hot server.ts`; with no arg it serves the bundled sample.

**Intent.** Review a document the way you would in Google Docs. Select a span of text; leave a comment, or a redline proposing a replacement. The agent reads the notes from the terminal, applies them to the source, and resolves each one — the card flips and the highlight clears, live.

**Data model** (`doc-review/server.ts`). One table carries the whole loop:

`annotations(id, block_id, start, end, quote, kind, body, status, reply, created_at, resolved_at)` — `kind` is `comment | redline`, `status` walks `open → resolved | wontfix`, `reply` is the agent's answer. The browser writes the note; the terminal writes the resolution. Split ownership, specialized for prose.

The document is not a table: the server parses it once at boot into ordered blocks (h1/h2/h3/p/li/blockquote/td/th/caption), **normalizing each block's text** — entities decoded, whitespace collapsed (`parseBlocks`/`normalize` in `server.ts`).

**Char-perfect anchoring.** A painted `<mark>` must cover exactly the characters the human selected. React makes this tractable: `BlockView` (`src/components/Document.tsx`) renders **exactly the server's stored string** as alternating text/mark segments, so the browser's `textContent` equals the stored text by construction — no template whitespace to trim, no entity mismatch. The selection handler walks the block's text nodes (TreeWalker) to convert the DOM range into character offsets into that same string. The server then **rejects drifted anchors with a 409**: an annotation is stored only if `block.text.slice(start, end) === quote`. Verify the way Phase 4 does: select a span crossing an entity (an em-dash), save, assert the painted `<mark>` equals the selection.

**Layout.** Two columns — the document reads as a page on the left with annotations painted as colored `<mark>`s (amber comments, rose redlines); the annotation rail sits on the right, cards showing quote, note, status badge, and the agent's reply. Selecting text opens a fixed-position compose popover (Comment/Redline toggle + textarea).

**Terminal ingests.** `scripts/review.ts` — `list [status]`, `show <id>`, `resolve <id> "reply"`, `wontfix <id> "reply"`, `reopen <id>`, `json`. The work queue is the filtered region `GET /api/regions/annotations?status=open`. A session loops: the human leaves a batch, says "drain the review," the agent edits the source and resolves each note, and the page turns green card by card.

**Bending it.** The shape fits anything that is "anchor a human note to a span of a fixed artifact, then have the agent resolve it" — spec reviews, transcript labeling, log callouts. If the artifact is line-oriented (code, logs), anchor on `(block_id, line)` instead of char offsets and the normalization problem disappears entirely.

## 3. PR review room — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/` (`server.ts`, `src/`, `scripts/analyze-pr.ts`, `scripts/review-loop.ts`). Port 5051, Graphite (`mode="dark"`, header accent `#2fb6a4` dark-mode teal) — the catalog's dark surface.

**Intent.** Not a diff viewer — a *synthesis* surface for a multi-PR change-set: every open PR at a glance, which ones collide on the same files (the merge-order risk), per-PR drill-in, and a review-task queue the agent answers back into the room.

**Data model.** Four tables, real foreign keys with `ON DELETE CASCADE`:

- `prs(id, number, title, author, branch, summary, state, risk, additions, deletions, updated_at)` — `summary` is markdown; `state` is `open | draft | approved | changes`; `risk` drives board sort.
- `pr_files(id, pr_id→prs, path, additions, deletions, kind)` — one row per file touched per PR. **This table makes the room more than a list:** `path` repeats across PRs, so a `GROUP BY path` surfaces collisions.
- `concerns(id, pr_id→prs, severity, title, body, path, resolved)` — findings; `severity` is `blocker | warn | nit`.
- `requests(...)` — the standard channel; `kind` extends to `ask | investigate | draft-comment | merge-check | summarize`.

**The unique value — the collisions query:**

```sql
SELECT f.path,
       COUNT(DISTINCT f.pr_id) AS n,
       SUM(f.additions + f.deletions) AS churn,
       GROUP_CONCAT(p.number || '|' || p.risk || '|' || p.state, ';') AS prs
FROM pr_files f JOIN prs p ON p.id = f.pr_id
GROUP BY f.path
HAVING n > 1
ORDER BY n DESC, churn DESC
```

`HAVING n > 1` returns exactly the files more than one PR touches — a fact about the *set*, not any one PR, and the reason to look at five PRs in one room instead of five tabs. The per-PR detail runs the complementary self-join (`pr_files f1 JOIN pr_files f2 ON f1.path = f2.path AND f2.pr_id != f1.pr_id`) for "who else touches my files."

**Layout.** An overview strip (PR count, adds/dels, open blockers, collision count — ONE aggregate query whose collision subquery reuses the `HAVING n > 1` shape, so the strip and the rail can never disagree), a fleet board sorted risk-then-churn (Card per PR: state and risk badges, file count, concern severity counts), a collisions rail (hot files → PR chips), a per-PR `Dialog` detail (summary via Astryx `Markdown`, pure-CSS churn bars — a self-measuring chart inside an initially-closed Dialog is the 0×0 trap, so churn renders as width-percentage divs — concerns, overlap, ask thread), the global queue.

**Per-PR detail is a parameterized region** (`pr-<id>`), not a plain GET: re-ingesting a PR whose dialog is open must repaint the open dialog, and `publish(`pr-${id}`)` + `useRegion(`pr-${id}`)` gets that for free — including reconnect healing. The cost is a prefix-match branch in the region route (`pr-workbench/server.ts`).

**Badge semantics** (from the Astryx manifest's own best-practice note): concern `severity` uses the semantic scale (`blocker→error`, `warn→warning`, `nit→neutral`) because it demands attention; PR `state` uses categorical color variants (`open→blue`, `draft→neutral`, `approved→green`, `changes→orange`) so state and severity never read as the same axis.

**Terminal ingests.** `analyze-pr.ts` POSTs a whole analyzed PR (title, summary, files, concerns) to `/pr/ingest` — the agent reads a real diff, classifies, posts the structure; the server upserts by number (the `ON DELETE CASCADE` FKs make re-ingest replace files/concerns with zero orphans) and recomputes collisions. The agent's read-back is `GET /claude/collisions`, so the terminal can order its next review pass by merge risk. The queue/respond loop is standard.

## 4. Grid / spreadsheet triage — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/grid-workbench/` (`server.ts`, `src/`, `scripts/patch-cell.ts`, `scripts/ingest-rows.ts`, `scripts/review-loop.ts`). Port 5062, Graphite (`mode="light"`, header accent `#7a5512` amber).

**Intent.** A spreadsheet-type experience over one SQLite table: click a cell to edit it inline, set a per-row keep/fix/drop decision, watch column stats update live — while the agent ingests rows and patches cells from the terminal, every edit landing in a shared audit log.

**Data model** (`grid-workbench/server.ts`). Three tables:

- `rows(id, name, category, amount, date, notes, decision, updated_at)` — the dataset under triage; `decision` is `pending | keep | fix | drop`. Seeded with planted dirt (a bad date, an outlier amount, an empty category) so triage feels real on first boot.
- `cells_log(id, row_id, column, old_value, new_value, actor, created_at)` — the audit trail; `actor` is `human | agent`. **Both actors write through one `writeCell()` funnel** that does the UPDATE and the log INSERT in a single transaction, so the audit is structurally unbypassable rather than conventionally maintained.
- `requests(...)` — the standard channel.

**The unique value — actor-attributed cell edits.** The human watches the agent patch cells live and vice versa; the edit log is the shared narration. Column stats (count, empties, distinct, min/max) are SQL region queries, never client math. One security-shaped detail: the editable-column set is an allowlist because a column name cannot be parameter-bound into an UPDATE — that check is a control, not hygiene.

**Layout.** Astryx `Table` in data-driven mode is the grid (column widths via the `proportional()`/`pixel()` helpers — raw numbers are a type error), `renderCell` composing an `EditableCell` (click → TextInput → commit on Enter/blur, Escape cancels) and a per-row decision control; a column-stats rail; the edit log; the queue. Table sits in a `Card padding={0}` — the Table scroll-wrapper's negative-margin bleed overflows a padded Card by exactly the padding.

**Terminal ingests.** `patch-cell.ts <row> <column> <value>` → `/claude/patch-cell` (actor `agent`); `ingest-rows.ts` bulk-loads; the read-back is `GET /claude/decisions` so the agent acts only on human-approved rows. `review-loop.ts` drives queue/respond.

**Bending it.** Any "N uniform records, each needing a human verdict and occasional value fixes" fits: data cleanup, moderation queues, config audits, CSV reconciliation. Point the schema at your columns and keep `cells_log` verbatim — the actor attribution is the workbench.

## 5. Multi-surface triage — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/triage-workbench/` (`server.ts`, `src/`, `scripts/ingest.ts`, `scripts/mark-handled.ts`, `scripts/triage-loop.ts`). Port 5065, Graphite (`mode="light"`, header accent `#6a3f76` plum).

**Intent.** One prioritized queue across email, Slack, calendar, and Asana. The agent ingests normalized items from the terminal (in a real session, from MCP tools); the human triages each (respond / delegate / defer / done / ignore); the agent reads decisions back and — the signature move — **marks items handled when it detects the human already dealt with them**, so the surface only ever shows what still needs attention.

**Data model** (`triage-workbench/server.ts`).

- `items(id, source, source_ref, kind, title, body, sender, due_at, priority, status, human_note, agent_note, ingested_at, handled_at)` — `source` is `email | slack | calendar | asana`; `status` walks `new → respond|delegate|defer|done|ignore → handled`. One `CLOSED` predicate constant defines "left the queue" once, shared by the `inbox` and `today` regions.
- `events` + `requests` — the standard pair.

**The unique value — reply-detection semantics + a parameterized region.** `POST /claude/mark-handled` accepts `id` *or* `source_ref` (the agent holds the upstream ref, not the local row id) and flips the item out of the inbox live. `source-summary` deliberately does NOT exclude closed statuses — handled volume stays visible in the chart after the inbox drops it, which makes the move legible instead of looking like data loss. The inbox is the catalog's worked example of a **parameterized region**: `useRegion("inbox", {source})` → `/api/regions/inbox?source=slack`, while the SSE event stays plain `inbox` so one `publish("inbox")` invalidates every filtered view (each page refetches with its own params — the right trade on loopback versus tracking per-subscriber filter state server-side).

**Layout.** A `SegmentedControl` source filter (All | Email | Slack | Calendar | Asana) over item Cards — source as a categorical Badge color (email blue / slack purple / calendar teal / asana orange), triage status as a semantic Badge, priority as a `StatusDot`; the five triage buttons stay visible per card (a one-decision-per-item surface should not bury its verbs behind a disclosure — only the optional note collapses); a source × status ECharts stacked bar; a today rail keyed on `due_at`; event log; queue.

**Terminal ingests.** `ingest.ts` bulk-POSTs normalized items to `/claude/ingest`; `mark-handled.ts` flips handled items; `triage-loop.ts` drives queue/respond and prints `GET /claude/decisions`. In a live session the ingest payload comes from real MCP reads (Outlook, Slack, calendar, Asana) — the workbench is the surface, not the connector.

## The rest — sketches at the same altitude

Each is the same stack with a different schema. Treat the columns as a starting point and harden them in Phase 4.

### 6. Agent trace replay

**Intent.** Step through a recorded agent run — prompt, tool calls, results, output per turn — annotate where it went wrong, and let the terminal re-run a single turn with a tweak.

**Data model.** `traces(id, label, model, created_at, status)`; `steps(id, trace_id→traces, idx, role, kind, content, tokens, latency_ms, flagged, human_note)` with `kind` in `prompt | tool_call | tool_result | output`; `events`.

**Layout.** Trace picker, vertical step timeline (Collapsible per step), a latency/token bar chart, activity log.

**Terminal ingests.** `POST /claude/trace` loads a run (steps as JSON); `POST /claude/rerun-step` pushes a re-executed turn beside the original; `GET /claude/flags` reads back the human's flagged steps.

### 7. Refactor cockpit

**Intent.** Drive a large mechanical refactor across many files: see every call site, mark each reviewed/approved, watch progress as the terminal edits.

**Data model.** `sites(id, file, line, before, after, status, human_note)` with `status` in `pending | applied | reviewed | skipped` (`before`/`after` render via `CodeBlock`); `files(id, path, n_sites, n_done)` rollup; `events`.

**Layout.** File-progress board (per-file done/total bars), call-site list filterable by status (before→after side by side), overall progress donut.

**Terminal ingests.** `POST /claude/site` registers/updates a call site as the agent edits (`pending → applied`); the human flips `applied → reviewed`; `GET /claude/pending` returns the human's skips so the agent doesn't re-touch them.

### 8. Prompt / skill lab

**Intent.** Iterate on a prompt or skill: keep every version, run each against a fixed sample set, compare outputs side by side, rate by hand.

**Data model.** `versions(id, label, body, parent_id, created_at)` (lineage via `parent_id`); `samples(id, input, gold)`; `outputs(id, version_id→versions, sample_id→samples, text, rating, human_note, created_at)` with `rating` in `good | meh | bad`; `events`.

**Layout.** Version lineage rail, output matrix (version columns × sample rows, rated inline via `SegmentedControl`), per-version score donut.

**Terminal ingests.** `POST /claude/version` registers a revision; `POST /claude/output` pushes a (version, sample) output; `GET /claude/ratings` returns the human's scores so the terminal knows which version is winning.

### 9. Architecture decision board

**Intent.** Work a set of open architecture decisions toward resolution: options, tradeoffs, status; the human picks, the terminal supplies the analysis.

**Data model.** `decisions(id, title, context, status, chosen_option_id, created_at)` with `status` in `open | discussing | decided | superseded`; `options(id, decision_id→decisions, title, body, pros, cons)` (markdown); `comments(id, decision_id→decisions, source, body, created_at)`; `events`.

**Layout.** Decision board (cards by status), per-decision `Dialog` (context + option cards + comment thread), decided-count summary.

**Terminal ingests.** `POST /claude/option` adds an analyzed option; `POST /claude/comment` adds analysis to a thread; the human's pick sets `chosen_option_id` and flips `status`; `GET /claude/open-decisions` returns what still needs analysis.

### 10. Incident timeline builder

**Intent.** Assemble a postmortem timeline from scattered signals; the human curates the narrative while the terminal feeds raw signals in.

**Data model.** `incidents(id, title, severity, started_at, resolved_at, status)`; `timeline(id, incident_id→incidents, at, source, kind, summary, detail, included, human_note)` with `kind` in `alert | deploy | action | observation | root-cause` and `included` marking the official story; `events`.

**Layout.** Incident header, chronological timeline (Badge chips by `kind`, toggle `included`), root-cause `Dialog`, contributing-factors summary.

**Terminal ingests.** `POST /claude/signal` pushes a raw signal; `POST /claude/root-cause` posts a drafted analysis; `GET /claude/curated` returns the human's `included` set so the terminal renders the final postmortem from exactly the kept events.

### 11. Migration planner

**Intent.** Plan and sequence a multi-step migration: dependencies and status per step; the human approves the order, the terminal reports as it executes.

**Data model.** `steps(id, title, body, status, risk, est_effort, human_note)` with `status` in `blocked | ready | in-progress | done`; `deps(step_id→steps, depends_on→steps)` — a topological sort over this gives the safe order, and a step is `ready` only when every dependency is `done`; `events`.

**Layout.** Dependency graph (`<Mermaid>` rendered from `deps`), ready-queue board, per-step detail, progress donut.

**Terminal ingests.** `POST /claude/step` registers/updates a step and its deps; `POST /claude/step-status` reports execution progress and unblocks downstream server-side; `GET /claude/approved-order` returns the human's confirmed sequence.

## Picking and bending a recipe

- **Match on the relationship, not the domain.** A "list of independent items each with a human verdict and a terminal result" is recipe 1's shape whether the items are eval cases, lint findings, or moderation entries. A "set of things that collide on a shared dimension" is recipe 3's shape whether the dimension is files, time slots, or owners — the `GROUP BY ... HAVING n > 1` query transfers directly. "Anchor a note to a span of a fixed artifact" is recipe 2's shape for any reviewable text.
- **Every mutated table is an SSE target.** When you add a column a human or the agent writes, ask: which `publish()` target does this change invalidate, and which region re-renders it? If the answer is "none," it is not part of the live surface.
- **Keep the two-way loop.** What separates a workbench from a generated dashboard is the human→agent channel (`requests` + queue/respond, or a read-back like `/claude/feedback`). If the terminal only writes and the human only reads, you built a dashboard — add the channel.
- **`events` is free narration.** Every recipe carries the same append-only `events` table. It costs almost nothing and makes "who did what, when" legible across both surfaces — keep it.
