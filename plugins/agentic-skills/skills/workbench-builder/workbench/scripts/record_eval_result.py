# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Record an eval result from the terminal side.

Usage:
    uv run scripts/record_eval_result.py <eval_id> <status> "<actual output>"

Example:
    uv run scripts/record_eval_result.py 4 pass "Thursday"
"""
import sys
import httpx

BASE = "http://127.0.0.1:5050"


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: record_eval_result.py <eval_id> <status> [actual]")
    eval_id, status = sys.argv[1], sys.argv[2]
    actual = sys.argv[3] if len(sys.argv) > 3 else ""
    r = httpx.post(f"{BASE}/claude/eval-result",
                   json={"eval_id": eval_id, "status": status, "actual": actual})
    r.raise_for_status()
    print(f"recorded eval {eval_id}: {status}")


if __name__ == "__main__":
    main()
