#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2.0",
#     "polars>=1.0",
#     "cyclopts>=3.0",
# ]
# ///
"""Compute pairwise cosine similarity on the embedded catalog.

Reads <audit-dir>/vectors.npz (produced by embed-catalog.py), computes the full
cosine matrix, and writes ranked upper-triangle pairs above a review threshold
to <audit-dir>/collisions.csv with columns: skill_a, skill_b, cosine, action.

Thresholds are calibrated for Cohere Embed v4's cosine space, which is
tighter than OpenAI/Voyage spaces. The 2026-04 baseline on 38 skills showed:
max observed pair 0.63, real-world collisions clustering in the 0.50-0.63
range. Recalibrate if you swap embedding models.

Actions:
  REVIEW           0.50 <= cosine <  0.60  — disambiguate via negative keywords
  MERGE_CANDIDATE  cosine >= 0.60          — fold into a single skill
"""
from __future__ import annotations

from pathlib import Path

import cyclopts
import numpy as np
import polars as pl

app = cyclopts.App(help=__doc__)


def cosine_matrix(vectors: np.ndarray) -> np.ndarray:
    """Row-normalize then dot. Safe for small catalogs (< ~1000 items)."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    # Guard against zero-norm rows.
    norms[norms == 0.0] = 1.0
    unit = vectors / norms
    return unit @ unit.T


@app.default
def main(
    *,
    audit_dir: Path = Path("plugin-gardener/audit"),
    review_threshold: float = 0.50,
    merge_threshold: float = 0.60,
) -> None:
    """Emit ranked collision pairs to collisions.csv."""
    audit_dir = audit_dir.resolve()
    vectors_path = audit_dir / "vectors.npz"
    if not vectors_path.exists():
        raise SystemExit(
            f"{vectors_path} not found. Run embed-catalog.py first."
        )

    data = np.load(vectors_path, allow_pickle=True)
    names = list(data["names"])
    vectors = data["vectors"]

    sim = cosine_matrix(vectors)

    rows: list[dict[str, object]] = []
    n = len(names)
    for i in range(n):
        for j in range(i + 1, n):
            cos = float(sim[i, j])
            if cos < review_threshold:
                continue
            action = (
                "MERGE_CANDIDATE" if cos >= merge_threshold else "REVIEW"
            )
            rows.append(
                {
                    "skill_a": names[i],
                    "skill_b": names[j],
                    "cosine": round(cos, 4),
                    "action": action,
                }
            )

    if not rows:
        print(
            f"No collisions above {review_threshold} across {n} skills. "
            "Writing empty file."
        )

    df = (
        pl.DataFrame(rows, schema={"skill_a": pl.Utf8, "skill_b": pl.Utf8, "cosine": pl.Float64, "action": pl.Utf8})
        .sort("cosine", descending=True)
    )
    out_path = audit_dir / "collisions.csv"
    df.write_csv(out_path)

    print(f"{len(rows)} pair(s) flagged across {n} skills")
    print(f"  REVIEW:          {df.filter(pl.col('action') == 'REVIEW').height}")
    print(f"  MERGE_CANDIDATE: {df.filter(pl.col('action') == 'MERGE_CANDIDATE').height}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    app()
