# Clusters — {{ YYYY_MM }}

**Status:** IN PROGRESS
**Algorithm:** HDBSCAN on Cohere Embed v4 1536-dim vectors
**Parameters:** `min_cluster_size=3`, `min_samples=2`

---

## Clusters

### Cluster 0 — {{ name }}

- skill-a
- skill-b
- skill-c

*Tightness (mean pairwise cosine): …*
*Observation: …*

### Cluster 1 — {{ name }}

…

---

## Outliers (noise-labeled)

*Skills HDBSCAN left unclustered. These are genuinely sui generis — not a problem, but worth noting.*

- skill-x
- skill-y

---

## Straddlers

*Skills whose nearest cluster membership is ambiguous (low probability). These are forced-category candidates.*

| Skill | Nearest cluster | Probability | Alt cluster | Alt probability |
| ----- | --------------- | ----------- | ----------- | --------------- |
|       |                 |             |             |                 |

---

## Taxonomy observations

*Short prose paragraph on the shape. Examples:*

- Tight clusters reflect real domain boundaries.
- Loose clusters suggest the catalog's natural category is broader than the author named it.
- Straddlers between two tight clusters are the best candidates for disambiguation or split.
- A cluster dominated by one high-scoring skill and several low-scoring ones suggests the low-scoring skills could be references inside the high-scoring one.

---

## Actions

*If the taxonomy suggests a reorganization, name it. Otherwise: "No reorganization needed this month."*
