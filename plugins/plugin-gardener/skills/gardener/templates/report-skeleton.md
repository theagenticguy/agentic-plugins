# Gardener Audit — {{ YYYY_MM }}

**Status:** IN PROGRESS
**Generated:** {{ timestamp }}

---

## Executive Summary

*3–5 bullets. The health score, the direction of travel, and the single most important thing to fix this month.*

---

## Catalog Health

**Score:** {{ total }}/100 (mean of {{ n }} scorecards)
**Delta vs. prior:** {{ +/-X.X }}
**Skills added since last audit:** N
**Skills retired since last audit:** N

### Score distribution

| Range             | Count |
| ----------------- | ----- |
| 90–100            |       |
| 80–89             |       |
| 70–79             |       |
| 60–69             |       |
| < 60 (quarantine) |       |

---

## Quarantine list

*Every skill scoring below 60. Name, score, top issue.*

| Skill | Score | Top issue |
| ----- | ----- | --------- |
|       |       |           |

---

## Top-5 Action Items

*Ranked by leverage. Each entry: concrete change, file path, expected impact.*

1. …
2. …
3. …
4. …
5. …

---

## Delta: Collisions

**New collisions this month:** N
**Resolved collisions:** N
**Persistent collisions:** N (carried from prior audit)

Top 3 new or unresolved:

1. skill-a ↔ skill-b — cosine X.XX — recommended: ACTION
2. …

---

## Delta: Scores

*Skills whose score changed by ≥ 5 points vs. prior audit.*

| Skill | Prior | Current | Change | Why |
| ----- | ----- | ------- | ------ | --- |
|       |       |         |        |     |

---

## Taxonomy notes

*1-paragraph summary of this month's HDBSCAN output. Are the clusters stable? Any new straddlers? See `clusters.md` for detail.*

---

## Input artifacts

- `inventory.md`
- `scores/*.md` (N files)
- `collisions.csv`, `collisions.md`
- `clusters.csv`, `clusters.md`
- `vectors.npz` — cached embeddings for this month's catalog
