# Gardener Orchestrator

Forked orchestrator. Runs the monthly catalog hygiene audit in four phases. Every phase writes to `plugin-gardener/audit/YYYY-MM/`. Proceeds autonomously — no approval gates; the final deliverable is a report, not a set of commits.

---

## Contents

- Inputs
- Setup
- Phase tracking
- Phase 1 — Inventory
- Phase 2 — Collide
  - 2a. Embed the catalog
  - 2b. Pairwise collisions
  - 2c. HDBSCAN taxonomy
  - 2d. Interpret
- Phase 3 — Score
  - Scoring Agent prompt template
  - Monitoring
  - Completion gate (run before Phase 4)
- Phase 4 — Report
  - Report Agent prompt
- Closing

## Inputs

- `{{ scope }}` — parsed from `$ARGUMENTS`. Defaults to `all` (every plugin in `.claude-plugin/marketplace.json` that lives inside this repo).
- `${CLAUDE_PLUGIN_ROOT}/references/rubric.md` — shared scoring rubric.
- `${CLAUDE_PLUGIN_ROOT}/references/write-protocol.md` — write-protocol block copied into every Agent prompt.
- `${CLAUDE_PLUGIN_ROOT}/scripts/embed-catalog.py` — produces `vectors.npz`.
- `${CLAUDE_PLUGIN_ROOT}/scripts/pairwise-collisions.py` — produces `collisions.csv`.
- `${CLAUDE_PLUGIN_ROOT}/scripts/cluster-taxonomy.py` — produces `clusters.md` + `clusters.csv`.
- Templates: `templates/inventory-skeleton.md`, `templates/scorecard-skeleton.md`, `templates/collisions-skeleton.md`, `templates/clusters-skeleton.md`, `templates/report-skeleton.md`.

## Setup

Compute `YYYY_MM` from `date +"%Y-%m"`. Create `plugin-gardener/audit/{{ YYYY_MM }}/` and `plugin-gardener/audit/{{ YYYY_MM }}/scores/`.

If a prior audit exists at `plugin-gardener/audit/` (latest dated directory before this month), remember its path as `{{ prior_audit }}` — the report phase reads it for delta.

---

## Phase tracking

Before Phase 1, create 4 todo items — Inventory, Collide, Score, Report. During Phase 3, additionally `TaskCreate` one item per skill scoring Agent and flip each to `completed` when its scorecard shows `Status: COMPLETE`. This is the load-bearing one — monthly audits run 40–50 parallel scorers and without todo items, the completion count drifts as notifications arrive out of order (the orchestrator's own warning below).

Flip phase items to `in_progress` on entry, `completed` on exit.

---

## Phase 1 — Inventory

Write `audit/{{ YYYY_MM }}/inventory.md` from `templates/inventory-skeleton.md`.

Walk the filesystem:

1. `Glob` `**/plugin.json` under the repo root to find every plugin.
2. For each plugin, walk `skills/*/SKILL.md` and `agents/*.md`.
3. For each item, extract:
   - Name (from frontmatter `name` or directory name).
   - Description + when_to_use (if present).
   - File stats: SKILL.md line count, reference count, template count.
   - Frontmatter fields of interest: `context`, `agent`, `allowed-tools`, `disable-model-invocation`, `user_facing`.
4. Write the inventory as a single Markdown file with one table per plugin, one row per skill/agent.

This runs inline in the orchestrator, not in a subagent. It's I/O-bound and produces the input for every later phase.

---

## Phase 2 — Collide

Collision detection is mostly deterministic scripts, with one Agent at the end to interpret and recommend actions.

### 2a. Embed the catalog

Run `${CLAUDE_PLUGIN_ROOT}/scripts/embed-catalog.py` with the audit month as the output directory:

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/scripts/embed-catalog.py \
  --audit-dir plugin-gardener/audit/{{ YYYY_MM }}
```

Output: `audit/{{ YYYY_MM }}/vectors.npz` containing skill names and 1,536-dim Cohere v4 float vectors.

### 2b. Pairwise collisions

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/scripts/pairwise-collisions.py \
  --audit-dir plugin-gardener/audit/{{ YYYY_MM }} \
  --review-threshold 0.50 \
  --merge-threshold 0.60
```

Output: `audit/{{ YYYY_MM }}/collisions.csv` with columns `skill_a, skill_b, cosine, action` where action is `REVIEW` (0.50 ≤ cos < 0.60) or `MERGE_CANDIDATE` (cos ≥ 0.60). Thresholds are calibrated for Cohere Embed v4's cosine space, which is tighter than OpenAI/Voyage spaces.

### 2c. HDBSCAN taxonomy

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/scripts/cluster-taxonomy.py \
  --audit-dir plugin-gardener/audit/{{ YYYY_MM }} \
  --min-cluster-size 3 \
  --min-samples 2
```

Outputs: `audit/{{ YYYY_MM }}/clusters.csv` (skill → cluster_id) and an indicative text summary at `clusters-raw.txt`. The Agent below turns this into readable Markdown.

### 2d. Interpret

Launch one foreground Opus Agent. Prompt:

```text
You are a catalog auditor. Turn raw collision and cluster data into ranked, actionable recommendations.

<inputs>
- Pairwise collisions: {{ collisions_csv_path }}
- Clusters: {{ clusters_csv_path }}
- Raw cluster summary: {{ clusters_raw_txt_path }}
- Inventory: {{ inventory_md_path }}

For each collision pair, also open both skills' SKILL.md files to verify the collision by reading the actual descriptions, not by trusting the cosine score alone.
</inputs>

<output>
Write two files:
- {{ collisions_md_path }} — ranked pairs, each with a recommended action (MERGE, DISAMBIGUATE via negative keywords, DISABLE_MODEL_INVOCATION, RETIRE, or IGNORE_EXPECTED).
- {{ clusters_md_path }} — cluster listing with straddlers and outliers named, plus taxonomy observations (e.g., "agent-SDK cluster is the tightest — expected" vs. "writing + presentation straddling — investigate").

Use templates/collisions-skeleton.md and templates/clusters-skeleton.md.
</output>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Every collision row has a recommended action and a 1-sentence justification grounded in what you read in both SKILL.md files, not just in the cosine score.
- Flag false-positive collisions (embedding flagged, reading confirms distinct) with `IGNORE_EXPECTED` and a reason.
- Cite file:line evidence in the justification when the proposed action is MERGE or RETIRE.
</quality_bar>
```

---

## Phase 3 — Score

Spawn one subagent per skill via the Agent tool — the model under-delegates by default, so this fan-out must be stated and executed explicitly, not folded into in-context scoring.

Launch one parallel Agent per skill. Use general-purpose Opus, run in background.

Before launching, for each skill create a scorecard skeleton at `audit/{{ YYYY_MM }}/scores/<skill-name>.md` from `templates/scorecard-skeleton.md`. The Agent edits this file in place.

**Scoring order matters.** Phase 2 already produced `collisions.csv` and `clusters.csv`. Pass the relevant rows to each scoring Agent as cross-reference context. The embeddings are signal — *where to look* — not substitute for reading the skill files.

### Scoring Agent prompt template

```text
You are a plugin catalog auditor. Score one skill against the rubric by reading its files. Write the scorecard to the output file.

<scope>
Skill: {{ skill_path }}
Skill name: {{ skill_name }}
Plugin: {{ plugin_name }}
</scope>

<primary_inputs>
Your primary work is reading files. Open and read in full:

1. `{{ skill_path }}/SKILL.md`
2. Every file under `{{ skill_path }}/references/` (if present)
3. Every file under `{{ skill_path }}/templates/` (if present)

Do not score from the description alone. Score from what's in the files.
</primary_inputs>

<cross_references>
This skill has siblings to cross-check when scoring Dimension 1 (description quality) and Dimension 5 (proactive-label discipline):

Collisions involving this skill (from pairwise-collisions.py):
{{ paste rows from audit/{{ YYYY_MM }}/collisions.csv where skill_a == {{ skill_name }} OR skill_b == {{ skill_name }} }}

Cluster membership (from cluster-taxonomy.py):
- Cluster ID: {{ cluster_id }}
- Sibling skills in the same cluster: {{ list of names }}

For each collision row, open the sibling's SKILL.md and verify whether the current skill's description has a negative-keyword discriminator naming that sibling. Missing discriminators → Dimension 1 penalty.

If the embedding flagged a collision but reading both descriptions shows they're legitimately distinct (genuine domain adjacency, already well-disambiguated), note that inline as a false-positive observation in the Dimension 1 rationale.
</cross_references>

<output>
Output file: {{ absolute_path_to_scorecard }}

The file already exists with a skeleton. Edit it in place — don't overwrite.
</output>

<rubric>
Read and apply: ${CLAUDE_PLUGIN_ROOT}/references/rubric.md

Score each dimension on its own scale (totals sum to 100). Record a short rationale (1–2 sentences with a file:line citation) for every criterion under 3 points. The rationale is the value; the number is the aggregate.
</rubric>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>

<quality_bar>
- Every rationale cites evidence from a file you read — `path/to/SKILL.md:42` style.
- Score fractional points where partially met.
- Note penalties explicitly with the line they cite.
- A dimension can score 0 but not negative.
- If a collision flagged by the embedding script turns out to be a false positive on reading, say so in the Dimension 1 rationale and do not penalize.
</quality_bar>
```

Launch every Agent in a single message. Record the Agent IDs for monitoring.

### Monitoring

Escalating check-ins: 30s → 2m → 5m → every 5m.

- `wc -l` across every scorecard file in one Bash call.
- Report compactly.
- Stuck detection: line count unchanged across two checks → launch a fresh `Agent` with the existing file state and a "skip completed sections" prompt so the new agent doesn't re-do work. The original backgrounded agent can finish or timeout on its own.

**Do not tally completion from notification messages in the main conversation.** Notifications can arrive in batches, out of order, or be summarized, and the count you keep in your head will drift. The filesystem is the source of truth.

### Completion gate (run before Phase 4)

Before launching Phase 4, verify completion deterministically with one Bash command:

```bash
cd plugin-gardener/audit/{{ YYYY_MM }}/scores && \
  total=$(ls *.md | wc -l) && \
  done=$(grep -l '^\*\*Status:\*\* COMPLETE' *.md | wc -l) && \
  echo "complete: $done / $total" && \
  if [ "$done" -ne "$total" ]; then \
    echo "pending:"; \
    grep -L '^\*\*Status:\*\* COMPLETE' *.md; \
  fi
```

Only proceed to Phase 4 when `complete: N / N` with no pending files listed. If any file is pending, resume monitoring on just those skills (or relaunch a fresh `Agent` if they are stalled per the stuck-detection rule).

Also verify every scorecard carries a `## Total:` line with a numeric score — a COMPLETE status without a total means the agent didn't finish the summary row:

```bash
grep -L -E '^## Total: [0-9]+' *.md
```

Any file that appears in this output needs the summary table filled in before the report phase can read it.

---

## Phase 4 — Report

One foreground Opus Agent writes the final deliverable. Runs synchronously — the user waits for this.

### Report Agent prompt

```text
You are a catalog health reporter. Read this month's audit artifacts and compose a single delta report.

<inputs>
This month:
- Inventory: {{ inventory_md_path }}
- Scorecards directory: {{ scores_dir_path }} (N files)
- Collisions: {{ collisions_md_path }}
- Clusters: {{ clusters_md_path }}

Prior month (for delta):
- Report: {{ prior_audit }}/report.md (skip if no prior exists)
</inputs>

<output>
Output file: {{ report_md_path }}

Use templates/report-skeleton.md.
</output>

<report_discipline>
Health score is the mean of all scorecard totals, weighted equally. Report to one decimal.

Delta section compares against prior report — new collisions, resolved collisions, score movement per skill, new skills added, retired skills.

Quarantine list is every skill scoring < 60.

Top-5 action items are ranked by a blend of severity (low score) and leverage (touching a collision unlocks a merge). State each as a concrete change, not a diagnosis — "Retire skills/review-deck (35-line orchestrator, colliding with craft-presentation at cos 0.94)" beats "review-deck is underweight."

When every section has real content, change the Status line from IN PROGRESS to COMPLETE.
</report_discipline>

<write_protocol>
{{ paste write-protocol.md verbatim }}
</write_protocol>
```

When the Agent completes, read `report.md` and present its Executive Summary and Top-5 Action Items inline to the user.

---

## Closing

After the report is written, tell the user:

```markdown
## Gardener Audit Complete — {{ YYYY_MM }}

**Catalog health:** {{ score }}/100 ({{ delta vs prior }})

### Output

- `plugin-gardener/audit/{{ YYYY_MM }}/report.md` — the deliverable
- `plugin-gardener/audit/{{ YYYY_MM }}/scores/` — N per-skill scorecards
- `plugin-gardener/audit/{{ YYYY_MM }}/collisions.md` — ranked pairs with actions
- `plugin-gardener/audit/{{ YYYY_MM }}/clusters.md` — taxonomy view

### Top-5 actions

{{ paste top-5 inline }}

### Next

For each action, invoke `/rewrite-descriptions <skill-name>` or apply manually. Run `/audit-skill <skill-name>` for a single-skill re-score after changes.
```

No approval gates, no PRs opened. The report is the deliverable — the user decides what to apply.
