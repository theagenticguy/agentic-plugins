# Gardener Rubric

Single source of truth for scoring skills and agents. Both `/gardener` (catalog-wide) and `/audit-skill` (per-item) read this file verbatim. Changes here ripple everywhere.

Total: 100 points across 7 dimensions. Score thresholds:

- **≥ 80** — healthy; no action required
- **60–79** — needs polish; add to next maintenance sweep
- **< 60** — quarantine; fix or retire before next audit

---

## Dimension 1: Description quality (25 pts)

| Points | Criterion                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 10     | Opens with a concrete verb phrase that names what the skill does                                                  |
| 5      | Contains `Use when the user asks to <verb>` or `Use proactively <specific trigger>` clause                        |
| 5      | Includes negative discriminators when the domain overlaps with siblings (e.g., "Do NOT use when user mentions X") |
| 3      | Combined `description + when_to_use` ≤ 1,536 characters                                                           |
| 2      | Third-person voice; no first-person pronouns                                                                      |

Penalties:

- −5 if vague verbs dominate ("helps with", "manages", "handles")
- −5 if the description collides with a sibling at cosine ≥ 0.50 (Cohere Embed v4 space) without negative discriminators

---

## Dimension 2: Claude prompting hygiene (20 pts)

| Points | Criterion                                                                        |
| ------ | -------------------------------------------------------------------------------- |
| 6      | Rules use positive imperatives (what to do) rather than negation ladders         |
| 5      | Bold emphasis reserved for 1–2 high-cost rules per prompt                        |
| 4      | Non-obvious rules carry a motivation clause (`because…`)                         |
| 3      | Mixed content uses XML tags (`<scope>`, `<output>`, `<write_protocol>`, etc.)    |
| 2      | Scope is stated explicitly — no reliance on generalization from a single example |

Penalties:

- −5 if the prompt uses all-caps section headers or threat language ("YOU WILL BE STOPPED")
- −3 if the prompt references deprecated parameters (`temperature`, `top_p`, `budget_tokens` on current Claude models)

---

## Dimension 3: Progressive disclosure (15 pts)

| Points | Criterion                                                                      |
| ------ | ------------------------------------------------------------------------------ |
| 6      | SKILL.md under 300 lines (under 200 is optimal; 300–500 is warn; 500+ fails)   |
| 4      | Heavy content lives in `references/*.md`, not inline in SKILL.md               |
| 3      | Every `references/*.md` file is linked from SKILL.md with a `when to load` cue |
| 2      | Templates live in `templates/` and are referenced, not inlined                 |

---

## Dimension 4: Structural compliance (15 pts)

| Points | Criterion                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------- |
| 4      | Frontmatter `name` matches the directory name, kebab-case                                       |
| 4      | Frontmatter `description` ≤ 1,024 chars                                                         |
| 3      | `allowed-tools` list is scoped to what the skill actually needs                                 |
| 2      | Side-effect skills (deploy, commit, publish, send-*) set `disable-model-invocation: true`       |
| 2      | No orphan reference files; all `references/` and `templates/` files are reachable from SKILL.md |

---

## Dimension 5: Proactive-label discipline (10 pts)

| Points | Criterion                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5      | Matches one of three allowed label slots: `use proactively` (rare noun trigger), explicit "Does NOT trigger proactively" disclaimer, or default `Use when the user asks to <verb>` |
| 3      | If `use proactively`, the trigger noun phrase is rare and domain-specific (not "build an agent" or "create a diagram")                                                             |
| 2      | If a reviewer/critic/evaluator, carries the explicit "Does NOT trigger proactively" disclaimer                                                                                     |

---

## Dimension 6: Example and motivation density (10 pts)

| Points | Criterion                                                                         |
| ------ | --------------------------------------------------------------------------------- |
| 5      | At least one worked example or sample prompt in SKILL.md or references/           |
| 3      | A `Gotchas` or `Common mistakes` section exists                                   |
| 2      | Confidence or quality bar is named (e.g., "Cite every quantitative claim inline") |

---

## Dimension 7: Freshness signals (5 pts)

| Points | Criterion                                                                         |
| ------ | --------------------------------------------------------------------------------- |
| 3      | Pinned versions or dates are within 90 days (for library-reference skills)        |
| 2      | Skill has been touched in the last 180 days, or carries a `Last reviewed:` header |

Library-reference skills that pin versions should track upstream minor releases. Opinion-only skills are exempt — score 5 by default.

---

## How to score

Read the skill's SKILL.md, all `references/*.md`, all `templates/`. Apply each dimension independently. Record a short rationale for every criterion under 3 points — the rationale is the value of the scorecard, not the number.

A dimension can score fractional points if partially met. A dimension can go negative via penalties but a total under 0 is treated as 0.

## What NOT to score

- Content quality inside the skill (is the Slidev design system accurate? is the LangGraph reference up to date?). That's a separate maintainer concern and not visible to the router.
- Popularity, usage frequency, or user reviews. Out of scope for the static rubric.
- Perceived usefulness. If it ships, it exists; if it scores poorly, it needs work — not "this skill is silly."
