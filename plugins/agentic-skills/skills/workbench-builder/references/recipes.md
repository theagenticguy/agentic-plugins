# Workbench Recipes

A workbench is one stack — Flask + raw `sqlite3` + Jinja partials + htmx-over-SSE — pointed at one data model. Every recipe below is the *same* runtime (`app.run(host="127.0.0.1", ..., debug=True, threaded=True)`, the SSE fan-out, the named-event invalidation pattern, the markdown/mermaid/highlight render pipeline). What changes from recipe to recipe is the schema, the layout, and what the terminal half ingests.

**The data model is the design.** Phase 0 of the build (`references/orchestrator.md`) spends its time here, not on CSS. Once you know the tables, the columns, and the foreign keys, the partials, the SSE targets, and the terminal endpoints fall out almost mechanically — each table that a human or the agent mutates becomes a `publish()` target and a `GET /partials/<region>` route. Pick the recipe whose data model is closest to your problem, then bend the columns to fit.

Each recipe gives four things:

- **Intent** — the one-line job.
- **Data model** — the SQLite tables and the key columns. This is the load-bearing part.
- **Layout** — the panel shape in the browser.
- **Terminal ingests** — what the Claude-side helper scripts POST in (and read back, when the loop is two-way).

The three leading recipes are *built and verified* — read their source. The rest are sketches at the same altitude: enough to scaffold from, not yet hardened in a browser.

---

## Contents

- Eval viewer — BUILT
- PR review room — BUILT
- Document review / redline — BUILT
- The rest — sketches at the same altitude
  - Agent trace replay
  - Refactor cockpit
  - Data-cleanup workbench
  - Prompt / skill lab
  - Architecture decision board
  - Incident timeline builder
  - Migration planner
- Picking and bending a recipe

## 1. Eval viewer — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/` (`app.py`, `templates/index.html`, `templates/partials/*`, `scripts/record_eval_result.py`, `scripts/post_claude_note.py`).

**Intent.** Scan a set of eval cases, mark each pass / fail / needs-review by hand, read notes from both the human and Claude, and watch the pass-rate trend move as the terminal re-runs the suite.

**Data model** (`workbench/app.py` `SCHEMA`). Three tables, no foreign keys — the simplest shape that still demonstrates the two-way loop:

- `evals(id, name, input, expected, actual, status, human_note, claude_note, updated_at)` — one row per case. `status` is the human's verdict (`pass | fail | needs-review`); `actual` and `claude_note` are the terminal's columns, `status` and `human_note` are the browser's. The split-ownership of columns on one row is what makes the loop concrete: each side writes its own fields, both see the merged row.
- `runs(id, label, n_pass, n_fail, n_review, created_at)` — a denormalized snapshot per suite run, seeded with two historical rows so the trend chart has a line on first load. The terminal appends a snapshot via `/claude/run`; the browser never writes here.
- `events(id, source, message, created_at)` — an append-only activity log; `source` is `human | claude | system`. Every mutation on either side calls `log_event(...)`, so the log is the shared narration of who did what.

**Layout.** A board of eval rows (filterable by status), a run-summary tile (pass/fail/review counts), an activity-log column, and a Chart.js stacked-area trend over `runs`. The board re-renders per-row on a status/note change (`partials/eval_row.html`) so a single click swaps one row, not the whole board.

**Terminal ingests.** `record_eval_result.py` → `POST /claude/eval-result` writes `actual` + `status` for a case; `post_claude_note.py` → `POST /claude/note` writes a GFM-rich `claude_note` (the seed note carries a fenced code block, a mermaid flowchart, and a table — it exists to prove the render pipeline on first load). `POST /claude/run` snapshots the current counts into `runs`. The closing-the-loop read is `GET /claude/feedback`: the terminal pulls back which cases the human marked or annotated, so Claude can react to human verdicts. Each terminal write `publish()`es the regions it touched (`eval-board`, `run-summary`, `run-history`, `event-log`).

---

## 2. PR review room — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/` (`app.py`, `templates/*`, `scripts/analyze_pr.py`, `scripts/review_loop.py`).

**Intent.** Not a diff viewer — a *synthesis* surface for a multi-PR change-set. Read every open PR at a glance, see which ones collide on the same files (the merge-order risk), drill into any one for intent + file churn + open concerns + an architecture sketch, and hand Claude a review task that it answers back into the same room.

**Data model** (`pr-workbench/app.py` `SCHEMA`). Four tables, real foreign keys with `ON DELETE CASCADE` — the relational shape is what unlocks the unique value (see the collisions query below):

- `prs(id, number, title, author, branch, summary, state, risk, additions, deletions, updated_at)` — one row per PR. `summary` is markdown (the seed embeds a mermaid flowchart). `state` is `open | draft | approved | changes`; `risk` is `low | medium | high` and drives board sort order.
- `pr_files(id, pr_id→prs, path, additions, deletions, kind)` — one row per file touched per PR. **This is the table that makes the room more than a list:** because `path` repeats across PRs, a self-join on `path` surfaces overlap, and a `GROUP BY path` surfaces collisions.
- `concerns(id, pr_id→prs, severity, title, body, path, resolved)` — review findings; `severity` is `blocker | warn | nit`, `body` is markdown, `resolved` toggles. Open-blocker counts roll up onto the fleet board.
- `requests(id, pr_id→prs, kind, body, status, response, created_at, answered_at)` — **the human→agent channel that makes this a workbench, not a dashboard.** `pr_id` is nullable (a null means a whole-set ask). `kind` is `ask | investigate | draft-comment | merge-check | summarize`; `status` walks `queued → working → answered`; `body` is what the human asked and `response` is what Claude answered, both markdown. This one table closes the loop.

**The unique multi-PR value — the `collisions()` query.** `pr-workbench/app.py` `collisions()` is the heart of the recipe:

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

`GROUP BY f.path ... HAVING n > 1` returns exactly the files that more than one PR touches — the merge-order risk map. `COUNT(DISTINCT f.pr_id)` is how many PRs collide on that path; `SUM(additions + deletions)` ranks by churn so the hottest contested file sorts first; the `GROUP_CONCAT(... '|' ...)` packs each colliding PR's number/risk/state into one string that the partial unpacks into chips. No diff tool gives you this — it is a fact about the *set*, not any one PR, and it is the reason to look at five PRs in one room instead of five tabs. The per-PR detail view runs the complementary self-join (`pr_files f1 JOIN pr_files f2 ON f1.path = f2.path AND f2.pr_id != f1.pr_id`) to show "who else touches my files," and marks any path in the collision set as hot.

**Layout.** An overview strip (PR count, total adds/dels, open blockers, collision count), a fleet board sorted by risk then churn (each card shows file count, blocker/warn/nit badges, and request-status spinners), a collisions panel (hot files → which PRs, churn-ranked), a per-PR detail sheet (summary markdown, file list with churn bars, concerns, overlap, a per-PR ask thread), and a global request queue.

**Terminal ingests.** `analyze_pr.py` → `POST /pr/ingest` upserts a whole analyzed PR by number (title, summary, files, concerns) — Claude reads a real diff, classifies the files and concerns, and posts the structured result; the server recomputes collisions on every ingest. The two-way loop: the human files a review task via `POST /pr/<id>/ask` (htmx form), `review_loop.py` pulls it with `GET /claude/queue` (which flips `queued → working` so the human sees the spinner move), and posts the answer with `POST /claude/respond` (`working → answered`). The queue-pull-and-flip is the detail that makes the loop feel live: the human sees Claude *pick up* the task, not just answer it.

---

## 3. Document review / redline — BUILT

Source of truth: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/`. It holds `app.py`, `templates/index.html`, the `document` and `annotations` partials, `scripts/review.py`, and `sample-doc.html`. Set the reviewed file with `REVIEW_DOC=/path/to/doc.html uv run app.py`. With no arg it serves the bundled `sample-doc.html`.

**Intent.** Review a document the way you would in Google Docs. Select a span of text. Leave a comment, or a redline that proposes a replacement. The agent reads the notes from the terminal, applies them to the source file, and resolves each one. The card turns green and the agent's reply shows up, live. Built across several real review rounds on a memo.

**Data model** (`doc-review/app.py` `SCHEMA`). One table carries the whole loop:

`annotations(id, kind, block_id, start_off, end_off, quote, section, comment, suggestion, status, agent_note, created_at, resolved_at)`. One row per note. `kind` is `comment` or `redline`. The anchor is `(block_id, start_off, end_off)`. `quote` is the selected text. `section` is the nearest heading, filled server-side as a readable locator. `comment` is the human's note. `suggestion` is a redline's proposed replacement. `status` walks `open` to `addressed` to `wontfix`. `agent_note` is the terminal's reply.

The browser writes the note fields. The terminal writes `status` and `agent_note`. Each side owns its own columns on one shared row. This is the eval viewer's split-ownership shape, specialized for prose.

The document is not a table. It is a fixed HTML snapshot, parsed once at startup into ordered blocks. `parse_memo()` pulls `h1`, `h2`, `h3`, `p`, `li`, `td`, `th`, `blockquote`, `caption`, and `cite`, then renders each with `data-block="<id>"`. Offsets are block-relative, so they never drift during a review.

**Char-perfect anchoring is the hard part.** A painted `<mark>` must cover exactly the characters the human selected. That only holds when the server's stored block text and the browser's `textContent` are byte-identical. Two rules keep them aligned. Both are easy to break.

1. Normalize identically on the server, in `_block_text`. Run `html.unescape` over every entity, not a hardcoded subset. That was the first bug. Then collapse each whitespace run to one space, or source-HTML newlines inject phantom offsets. Now `&mdash;`, `&rarr;`, and `&#39;` each become one character on the server, matching how the browser decodes them.
2. Render with a fully whitespace-trimmed Jinja macro, in `partials/document.html`. Every tag uses `{%- -%}` or `{{- -}}`. One stray newline between text runs shifts every offset after it. That was the second bug. It stays invisible until you assert the painted span equals the selection. The browser computes an offset by walking the block's text nodes and summing their lengths. The rendered `textContent` equals the stored string, so that offset indexes the same string the server stored.

Verify it the way the build did. Select a span that crosses an entity such as an em-dash. Save it. Assert the rendered `<mark>` equals the selected substring. If it is off by a few characters, suspect macro whitespace first and entity normalization second.

**Layout.** Light theme by default: warm off-white paper, a serif body, blue for comments, red for redlines, green for resolved. Two columns. The document reads as a page on the left, block by block, with saved annotations painted as `<mark>` underlines. An annotation rail sits on the right, cards sorted open-first. Each card shows the quoted span, the comment, any suggestion, and the agent's note once resolved. A floating toolbar appears on `mouseup` with Comment and Redline buttons. A compose popover shows what is selected: the exact quote plus the char range, such as "chars 28–49". Clicking a highlight scrolls to its card and flashes it. There is no markdown pipeline. The doc is HTML and comments are short, so htmx and the SSE extension are the only CDN deps.

**Terminal ingests.** `scripts/review.py` is the agent's half. `list` prints open annotations with section, quote, comment, and suggestion. `list --all` adds the resolved ones. `show <id>` and `json` dump detail for parsing. The resolve verbs are `resolve <id> "note"`, `wontfix <id> "note"`, and `reopen <id>`. Each resolve POSTs to `/api/annotations/<id>/resolve`, writes SQLite, and publishes `document` and `annotations`, so the browser updates with no reload. The annotation is the human's steer. A redline says "change this to that," and the agent answers by editing the file and resolving with what it did. The work queue is `GET /api/annotations?status=open`. A session loops: the human leaves a batch, says "drain the review," the agent edits the source and resolves each note, and the human reloads to see the round in green.

**Bending it.** The table fits any problem shaped as "anchor a human note to a span of a fixed artifact, then have the agent resolve it." Review comments on a spec. Labels on a transcript. Callouts on a rendered log. Keep the anchoring rules verbatim if you keep text selection, since that is the part that is hard to get right. If the artifact is line-oriented, like code or logs, anchor on `(block_id, line)` instead of char offsets and the normalization problem disappears.

---

## The rest — sketches at the same altitude

Each of these is the same stack with a different schema. They are not yet browser-verified; treat the columns as a starting point and harden them in Phase 4.

### 4. Agent trace replay

**Intent.** Step through a recorded agent run — prompt, tool calls, tool results, model output per turn — and annotate where it went wrong, then let the terminal re-run a single turn with a tweak and diff the outcome.

**Data model.**

- `traces(id, label, model, created_at, status)` — one recorded run.
- `steps(id, trace_id→traces, idx, role, kind, content, tokens, latency_ms, flagged, human_note)` — one row per turn; `kind` is `prompt | tool_call | tool_result | output`, `content` is markdown/JSON, `flagged` + `human_note` are the human's columns. `idx` orders the replay.
- `events` — shared activity log (same shape as recipe 1).

**Layout.** A trace picker, a vertical step timeline (collapsed chips that expand to the full content sheet), a per-step latency/token sparkline (Chart.js), an activity log.

**Terminal ingests.** `POST /claude/trace` to load a recorded run (steps as a JSON array); `POST /claude/rerun-step` to push a re-executed turn's new output alongside the original for a side-by-side diff. Reads back `GET /claude/flags` to see which steps the human flagged.

### 5. Refactor cockpit

**Intent.** Drive a large mechanical refactor (a rename, an API migration) across many files: see every call site, mark each reviewed/approved, and let the terminal report progress as it edits.

**Data model.**

- `sites(id, file, line, before, after, status, human_note)` — one row per call site; `status` is `pending | applied | reviewed | skipped`. `before`/`after` are code snippets (highlight.js renders them).
- `files(id, path, n_sites, n_done)` — denormalized rollup per file for the progress board.
- `events` — shared log.

**Layout.** A file-progress board (per-file bars: done/total), a call-site list filterable by status (before→after side-by-side with syntax highlighting), an overall progress doughnut.

**Terminal ingests.** `POST /claude/site` to register or update a call site as Claude applies the edit (`pending → applied`); the human flips `applied → reviewed`. `GET /claude/pending` lets Claude pull the human's skips so it doesn't re-touch them.

### 6. Data-cleanup workbench

**Intent.** Triage a dirty dataset: surface the rows a profiling pass flagged, propose a fix per issue, and accept/reject each fix by hand while the terminal applies the accepted ones.

**Data model.**

- `issues(id, row_ref, column, rule, severity, original, proposed, decision, human_note)` — one flagged cell; `rule` is the quality check that fired (`null | dup | format | range | enum`), `proposed` is the suggested fix, `decision` is `pending | accept | reject | edit`.
- `rules(id, name, n_flagged, n_accepted)` — rollup per quality rule.
- `events` — shared log.

**Layout.** A rule-summary strip (how many cells each rule flagged), an issue queue grouped by column (original → proposed, with an accept/reject/edit control per row), an accepted-fixes counter.

**Terminal ingests.** `POST /claude/profile` to load a profiling run (issues as JSON); `POST /claude/apply` to confirm an accepted fix was written back to the source. `GET /claude/decisions` returns the human's accept/reject calls so the terminal applies exactly what was approved.

### 7. Prompt / skill lab

**Intent.** Iterate on a prompt or skill: keep every version, run each against a fixed sample set, and compare outputs side-by-side while rating them by hand.

**Data model.**

- `versions(id, label, body, parent_id, created_at)` — one prompt revision; `parent_id` threads the lineage.
- `samples(id, input, gold)` — the fixed evaluation inputs.
- `outputs(id, version_id→versions, sample_id→samples, text, rating, human_note, created_at)` — one model output per (version × sample); `rating` is the human's score (`good | meh | bad`).
- `events` — shared log.

**Layout.** A version lineage rail, a sample grid, an output matrix (version columns × sample rows, each cell rated inline), a per-version score doughnut.

**Terminal ingests.** `POST /claude/version` to register a new prompt revision; `POST /claude/output` to push the model's output for a (version, sample) pair. `GET /claude/ratings` returns the human's scores so the terminal knows which version is winning.

### 8. Architecture decision board

**Intent.** Work a set of open architecture decisions toward resolution: each decision has options, tradeoffs, and a status; the human picks, the terminal supplies the analysis behind each option.

**Data model.**

- `decisions(id, title, context, status, chosen_option_id, created_at)` — one ADR-in-progress; `status` is `open | discussing | decided | superseded`.
- `options(id, decision_id→decisions, title, body, pros, cons)` — one candidate per decision; `body`/`pros`/`cons` are markdown.
- `comments(id, decision_id→decisions, source, body, created_at)` — threaded discussion; `source` is `human | claude`.
- `events` — shared log.

**Layout.** A decision board (cards by status), a per-decision detail sheet (context + option cards with pros/cons + comment thread), a decided-count summary.

**Terminal ingests.** `POST /claude/option` to add an analyzed option to a decision; `POST /claude/comment` to add Claude's analysis to a thread. The human picks via an htmx POST that sets `chosen_option_id` and flips `status → decided`. `GET /claude/open-decisions` lets the terminal pull what still needs analysis.

### 9. Incident timeline builder

**Intent.** Assemble a postmortem timeline from scattered signals: each event gets a timestamp, a source, and a classification; the human curates the narrative while the terminal feeds raw signals in.

**Data model.**

- `incidents(id, title, severity, started_at, resolved_at, status)` — the incident.
- `timeline(id, incident_id→incidents, at, source, kind, summary, detail, included, human_note)` — one signal; `kind` is `alert | deploy | action | observation | root-cause`, `included` is whether the human kept it in the official narrative, `detail` is markdown.
- `events` — shared log (meta-narration, distinct from the incident timeline itself).

**Layout.** An incident header (severity, duration, status), a chronological timeline (chips by `kind`, toggle `included` to build the official story), a root-cause sheet, a contributing-factors summary.

**Terminal ingests.** `POST /claude/signal` to push a raw signal (from logs, deploy history, alerts) onto the timeline; `POST /claude/root-cause` to post a drafted root-cause analysis. `GET /claude/curated` returns the human's `included` selections so the terminal can render the final postmortem from exactly the kept events.

### 10. Migration planner

**Intent.** Plan and sequence a multi-step migration (a framework upgrade, a datastore move): each step has dependencies and a status; the human approves the order, the terminal reports as it executes.

**Data model.**

- `steps(id, title, body, status, risk, est_effort, human_note)` — one migration step; `status` is `blocked | ready | in-progress | done`, `body` is markdown.
- `deps(step_id→steps, depends_on→steps)` — the dependency edges; a topological sort over this gives the safe order, and a step is `ready` only when every `depends_on` is `done`.
- `events` — shared log.

**Layout.** A dependency graph (mermaid, rendered from `deps`), a ready-queue board (steps unblocked right now), a per-step detail sheet, an overall progress doughnut.

**Terminal ingests.** `POST /claude/step` to register or update a step (and its deps); `POST /claude/step-status` to report execution progress (`ready → in-progress → done`), which can unblock downstream steps server-side. `GET /claude/approved-order` returns the human's confirmed sequence so the terminal executes in the agreed order.

---

## Picking and bending a recipe

- **Match on the relationship, not the domain.** A "list of independent items each with a human verdict and a terminal result" is recipe 1's shape whether the items are eval cases, lint findings, or moderation queue entries. A "set of things that collide on a shared dimension" is recipe 2's shape whether the dimension is files, time slots, or owners — and the `GROUP BY ... HAVING n > 1` collision query transfers directly.
- **Every mutated table is an SSE target.** When you add a column a human or the agent writes, ask: which `publish()` target does this change invalidate, and which `GET /partials/<region>` re-renders it? If the answer is "none," it is not part of the live surface.
- **Keep the two-way loop.** The thing that separates a workbench from a generated dashboard is the human→agent channel (recipe 2's `requests` table; recipe 1's `/claude/feedback` read-back). If the terminal only writes and the human only reads, you have built a dashboard — add the channel that lets the human steer and the agent answer in the same room.
- **`events` is free narration.** Every recipe carries the same `events(source, message, created_at)` table and `log_event()` helper. It costs almost nothing and makes "who did what, when" legible across both surfaces — keep it.
