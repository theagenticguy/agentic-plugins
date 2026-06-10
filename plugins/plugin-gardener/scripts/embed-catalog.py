#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "boto3>=1.35",
#     "numpy>=2.0",
#     "pyyaml>=6.0",
#     "cyclopts>=3.0",
# ]
# ///
"""Embed every skill description in the marketplace via Bedrock Cohere Embed v4.

Walks all plugins listed in .claude-plugin/marketplace.json that have a local
source, extracts `name + description + when_to_use` from each SKILL.md's
frontmatter, and stores 1536-dim float vectors in `<audit-dir>/vectors.npz`
alongside a parallel list of skill names.

One Bedrock InvokeModel call per run — the catalog fits under the 96-item cap.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import boto3
import cyclopts
import numpy as np
import yaml

MODEL_ID = "global.cohere.embed-v4:0"
REGION = "us-east-1"
DIM = 1536

app = cyclopts.App(help=__doc__)


def parse_frontmatter(skill_md: Path) -> dict:
    """Pull the YAML frontmatter off a SKILL.md."""
    text = skill_md.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        return yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}


def extract_embed_text(skill_md: Path) -> tuple[str, str] | None:
    """Return (skill_name, text_to_embed) or None if unembeddable."""
    fm = parse_frontmatter(skill_md)
    name = fm.get("name") or skill_md.parent.name
    description = (fm.get("description") or "").strip()
    when_to_use = (fm.get("when_to_use") or "").strip()
    if not description and not when_to_use:
        return None
    text = description
    if when_to_use:
        text = f"{text}\n\n{when_to_use}"
    return name, text


def walk_catalog(repo_root: Path) -> list[tuple[str, Path, str]]:
    """Return [(skill_name, skill_md_path, embed_text), ...] across every plugin."""
    items: list[tuple[str, Path, str]] = []
    for skill_md in repo_root.glob("**/skills/*/SKILL.md"):
        # Exclude plugin-gardener's own skills from the catalog it audits.
        if "plugin-gardener" in skill_md.parts:
            continue
        extracted = extract_embed_text(skill_md)
        if extracted is None:
            continue
        name, text = extracted
        items.append((name, skill_md, text))
    items.sort(key=lambda row: row[0])
    return items


def embed_batch(texts: list[str]) -> np.ndarray:
    """One Bedrock InvokeModel call; returns (N, DIM) float32 array."""
    client = boto3.client("bedrock-runtime", region_name=REGION)
    body = json.dumps(
        {
            "input_type": "search_document",
            "texts": texts,
            "embedding_types": ["float"],
            "output_dimension": DIM,
        }
    )
    response = client.invoke_model(
        modelId=MODEL_ID,
        body=body,
        contentType="application/json",
        accept="*/*",
    )
    payload = json.loads(response["body"].read())
    embeddings = payload["embeddings"]
    # Single-type response shape: {"embeddings": [[...], ...]}
    # Multi-type response shape: {"embeddings": {"float": [[...], ...]}}
    if isinstance(embeddings, dict):
        embeddings = embeddings["float"]
    return np.asarray(embeddings, dtype=np.float32)


@app.default
def main(
    *,
    audit_dir: Path = Path("plugin-gardener/audit"),
    repo_root: Path = Path("."),
) -> None:
    """Embed the catalog and write vectors.npz under audit_dir."""
    repo_root = repo_root.resolve()
    audit_dir = audit_dir.resolve()
    audit_dir.mkdir(parents=True, exist_ok=True)

    items = walk_catalog(repo_root)
    if not items:
        raise SystemExit(f"No SKILL.md files found under {repo_root}")
    if len(items) > 96:
        raise SystemExit(
            f"Catalog has {len(items)} skills; Cohere Embed v4 caps at 96 per call. "
            "Split into batches before embedding."
        )

    names = [row[0] for row in items]
    paths = [str(row[1].relative_to(repo_root)) for row in items]
    texts = [row[2] for row in items]

    print(f"Embedding {len(items)} skills via {MODEL_ID}...")
    vectors = embed_batch(texts)
    print(f"Embeddings shape: {vectors.shape}")

    out_path = audit_dir / "vectors.npz"
    np.savez(
        out_path,
        names=np.asarray(names, dtype=object),
        paths=np.asarray(paths, dtype=object),
        vectors=vectors,
    )
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    app()
