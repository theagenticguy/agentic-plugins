# plugin-gardener

Catalog hygiene for Claude Code skill/agent plugins. Audits a marketplace monthly: inventory, per-skill scoring, Bedrock Cohere v4 embedding-based collision detection, HDBSCAN taxonomy. Proposes resolutions; never auto-applies.

## Skills

| Skill                  | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `gardener`             | Full monthly audit — inventory, score, collide, report   |
| `audit-skill`          | Score a single skill against the rubric                  |
| `rewrite-descriptions` | Propose description rewrites to resolve a collision pair |

## Scripts

| Script                           | What it does                                                      |
| -------------------------------- | ----------------------------------------------------------------- |
| `scripts/embed-catalog.py`       | One Bedrock call, 1536-dim Cohere Embed v4, emits `vectors.npz`   |
| `scripts/pairwise-collisions.py` | Cosine matrix on vectors, emits ranked `collisions.csv`           |
| `scripts/cluster-taxonomy.py`    | HDBSCAN on vectors, emits `clusters.csv` + human-readable summary |

All scripts are PEP 723 single-file scripts. Run them with `uv run scripts/<name>.py --help` — no venv setup needed.

## Output layout

```text
plugin-gardener/audit/YYYY-MM/
  inventory.md
  scores/<skill>.md
  vectors.npz
  collisions.csv
  collisions.md
  clusters.csv
  clusters-raw.txt
  clusters.md
  report.md
```

## Bedrock auth

Scripts use `boto3.client("bedrock-runtime", region_name="us-east-1")`. Set `AWS_BEARER_TOKEN_BEDROCK` or use standard AWS credentials. The global cross-region inference profile `global.cohere.embed-v4:0` routes across all commercial regions for highest throughput.

## Shared references

- `references/rubric.md` — 7-dimension scoring rubric (single source of truth).
- `references/write-protocol.md` — Task-prompt write discipline block.
