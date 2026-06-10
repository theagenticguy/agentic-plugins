# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Ingest an analyzed PR into the review room from the terminal.

In a real session Claude Code would run `gh pr view`, `git diff --numstat`, read
the changed files, and synthesize this JSON. Here it's a worked example you can
pipe in. Reads a JSON object on stdin, or runs the built-in demo PR.

    uv run scripts/analyze_pr.py < pr.json
    uv run scripts/analyze_pr.py            # posts the demo PR (#423)
"""
import json
import sys
import httpx

BASE = "http://127.0.0.1:5051"

DEMO = {
    "number": 423, "title": "Migrate billing config to pydantic-settings",
    "author": "dana", "branch": "billing/pydantic-config", "state": "open", "risk": "medium",
    "summary": ("Replaces the ad-hoc `config.py` dict with a typed `Settings` model. "
                "**Collides with #415 and #417** on `config.py`.\n\n"
                "```mermaid\nflowchart TD\n  C[config.py dict] --> S[Settings model]\n  S --> V[validation at boot]\n```"),
    "files": [
        {"path": "config.py", "additions": 70, "deletions": 40, "kind": "modified"},
        {"path": "billing/settings.py", "additions": 95, "deletions": 0, "kind": "added"},
        {"path": "tests/test_config.py", "additions": 60, "deletions": 0, "kind": "added"},
    ],
    "concerns": [
        {"severity": "warn", "title": "Three PRs now edit config.py",
         "body": "Coordinate merge order with #415 and #417 to avoid a three-way conflict.",
         "path": "config.py"},
    ],
}


def main() -> None:
    payload = DEMO
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            payload = json.loads(raw)
    r = httpx.post(f"{BASE}/pr/ingest", json=payload)
    r.raise_for_status()
    print(f"ingested PR #{payload['number']}: {payload['title']}")


if __name__ == "__main__":
    main()
