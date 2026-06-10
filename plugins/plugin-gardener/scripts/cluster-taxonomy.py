#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2.0",
#     "polars>=1.0",
#     "hdbscan>=0.8.40",
#     "cyclopts>=3.0",
# ]
# ///
"""Run HDBSCAN on the embedded catalog and emit cluster assignments.

Reads <audit-dir>/vectors.npz (from embed-catalog.py), fits HDBSCAN on the
1536-dim Cohere vectors, and writes two files:

  clusters.csv   — skill, cluster_id, membership_probability
  clusters-raw.txt — human-readable listing with outliers and straddlers

HDBSCAN uses cosine-distance-on-normalized-vectors (via Euclidean on L2-normalized
vectors), which matches the pairwise collision script's similarity notion.
Outliers are labeled cluster_id == -1. Straddlers are rows with nearest-cluster
membership probability below 0.5.
"""
from __future__ import annotations

from pathlib import Path

import cyclopts
import hdbscan
import numpy as np
import polars as pl

app = cyclopts.App(help=__doc__)


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return vectors / norms


@app.default
def main(
    *,
    audit_dir: Path = Path("plugin-gardener/audit"),
    min_cluster_size: int = 3,
    min_samples: int = 2,
    straddler_threshold: float = 0.5,
) -> None:
    """Cluster the catalog and emit clusters.csv + clusters-raw.txt."""
    audit_dir = audit_dir.resolve()
    vectors_path = audit_dir / "vectors.npz"
    if not vectors_path.exists():
        raise SystemExit(
            f"{vectors_path} not found. Run embed-catalog.py first."
        )

    data = np.load(vectors_path, allow_pickle=True)
    names = list(data["names"])
    vectors = data["vectors"]

    # Euclidean distance on L2-normalized vectors is monotonically related to
    # cosine distance, so this is the standard way to get cosine-like behavior
    # out of HDBSCAN's default metric.
    unit = l2_normalize(vectors)

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(unit)
    probabilities = clusterer.probabilities_

    df = pl.DataFrame(
        {
            "skill": names,
            "cluster_id": labels.tolist(),
            "membership_probability": [round(float(p), 4) for p in probabilities],
        }
    )
    clusters_csv = audit_dir / "clusters.csv"
    df.write_csv(clusters_csv)
    print(f"Wrote {clusters_csv}")

    # Build the human-readable summary.
    lines: list[str] = []
    lines.append(f"HDBSCAN clustering: {len(names)} skills")
    lines.append(
        f"Parameters: min_cluster_size={min_cluster_size}, "
        f"min_samples={min_samples}, metric=euclidean (on L2-normalized vectors)"
    )
    lines.append("")

    clusters = sorted(set(labels))
    for cluster_id in clusters:
        members = df.filter(pl.col("cluster_id") == cluster_id)
        if cluster_id == -1:
            lines.append(f"## Outliers (cluster -1): {members.height} skill(s)")
        else:
            lines.append(
                f"## Cluster {cluster_id}: {members.height} skill(s)"
            )
        for row in members.iter_rows(named=True):
            lines.append(
                f"  - {row['skill']}  (p={row['membership_probability']:.2f})"
            )
        lines.append("")

    straddlers = df.filter(
        (pl.col("cluster_id") != -1)
        & (pl.col("membership_probability") < straddler_threshold)
    )
    lines.append(f"## Straddlers (p < {straddler_threshold}): {straddlers.height} skill(s)")
    for row in straddlers.iter_rows(named=True):
        lines.append(
            f"  - {row['skill']} (cluster {row['cluster_id']}, p={row['membership_probability']:.2f})"
        )
    lines.append("")

    raw_txt = audit_dir / "clusters-raw.txt"
    raw_txt.write_text("\n".join(lines))
    print(f"Wrote {raw_txt}")
    print()
    print("\n".join(lines))


if __name__ == "__main__":
    app()
