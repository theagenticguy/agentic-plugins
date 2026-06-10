# Collisions — {{ YYYY_MM }}

**Status:** IN PROGRESS
**Embedding model:** `global.cohere.embed-v4:0`
**Thresholds:** REVIEW ≥ 0.50, MERGE_CANDIDATE ≥ 0.60 (calibrated for Cohere v4)

---

## Ranked collision pairs

| # | Skill A | Skill B | Cosine | Action | Reason |
| - | ------- | ------- | ------ | ------ | ------ |
| 1 |         |         |        |        |        |

**Actions:**

- `MERGE` — collapse the two skills; the weaker scorecard is retired.
- `DISAMBIGUATE` — both stay, but add negative discriminators to descriptions (e.g., "Do NOT use when user mentions X").
- `DISABLE_MODEL_INVOCATION` — one skill is a sub-worker of another; hide it from the router.
- `RETIRE` — collision is a symptom of dead weight; retire the weaker skill.
- `IGNORE_EXPECTED` — collision reflects domain adjacency, not a routing bug.

---

## False positives (IGNORE_EXPECTED)

*Pairs above threshold that are genuinely distinct. Short reason per row.*

---

## Fixes ready to apply

*Top 3 collision resolutions as copy-paste ready changes. Each entry: current description → proposed description, with the exact file path.*
