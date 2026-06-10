# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Post a terminal-side note from Claude Code into the workbench.

Usage:
    uv run scripts/post_claude_note.py "<message>" [eval_id]

Examples:
    uv run scripts/post_claude_note.py "Reran the suite after fixing the date parser."
    uv run scripts/post_claude_note.py "Fixed: off-by-one in weekday lookup." 4
"""
import sys
import httpx

BASE = "http://127.0.0.1:5050"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: post_claude_note.py <message> [eval_id]")
    payload = {"message": sys.argv[1]}
    if len(sys.argv) > 2:
        payload["eval_id"] = sys.argv[2]
    r = httpx.post(f"{BASE}/claude/note", json=payload)
    r.raise_for_status()
    print("note posted")


if __name__ == "__main__":
    main()
