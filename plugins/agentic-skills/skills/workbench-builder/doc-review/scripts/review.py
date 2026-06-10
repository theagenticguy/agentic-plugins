# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Terminal half of the doc-review loop — the agent's hands.

The human selects text and leaves comments/redlines in the browser. This script
lets the agent read those annotations from the terminal, act on them in the real
source doc, and resolve each one -- which pushes an SSE invalidation so the
human's open browser updates live (status pill flips, the highlight goes green,
the agent's note appears under the card).

    uv run scripts/review.py list                 # all open annotations, pretty
    uv run scripts/review.py list --all           # include resolved
    uv run scripts/review.py show <id>            # full detail for one
    uv run scripts/review.py resolve <id> "note"  # mark addressed + leave a note
    uv run scripts/review.py wontfix <id> "note"  # mark wontfix + leave a note
    uv run scripts/review.py reopen <id>          # back to open
    uv run scripts/review.py json [--all]         # raw JSON (for the agent to parse)
"""
import json
import sys

import httpx

BASE = "http://127.0.0.1:5057"

C = {"open": "\033[33m", "redline": "\033[31m", "comment": "\033[36m",
     "addressed": "\033[32m", "wontfix": "\033[90m", "dim": "\033[90m",
     "bold": "\033[1m", "reset": "\033[0m"}


def _fetch(status: str | None = None) -> list[dict]:
    params = {"status": status} if status else {}
    r = httpx.get(f"{BASE}/api/annotations", params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def cmd_list(show_all: bool) -> None:
    anns = _fetch(None if show_all else "open")
    if not anns:
        print("no open annotations." if not show_all else "no annotations yet.")
        return
    print(f"\n{C['bold']}{len(anns)} annotation(s){C['reset']}\n")
    for a in anns:
        kc = C.get(a["kind"], "")
        sc = C.get(a["status"], "")
        print(f"  {C['bold']}#{a['id']}{C['reset']}  {kc}{a['kind']:<8}{C['reset']} "
              f"{sc}[{a['status']}]{C['reset']}  {C['dim']}{a['section']}{C['reset']}")
        print(f"      quote: {C['dim']}“{_clip(a['quote'], 90)}”{C['reset']}")
        if a["comment"]:
            print(f"      note:  {a['comment']}")
        if a["kind"] == "redline" and a.get("suggestion"):
            print(f"      {C['redline']}suggest →{C['reset']} {a['suggestion']}")
        if a.get("agent_note"):
            print(f"      {C['addressed']}agent →{C['reset']} {a['agent_note']}")
        print()


def cmd_show(aid: int) -> None:
    a = next((x for x in _fetch() if x["id"] == aid), None)
    if not a:
        sys.exit(f"no annotation #{aid}")
    print(json.dumps(a, indent=2, ensure_ascii=False))


def cmd_resolve(aid: int, status: str, note: str) -> None:
    r = httpx.post(f"{BASE}/api/annotations/{aid}/resolve",
                   json={"status": status, "agent_note": note or None}, timeout=10)
    r.raise_for_status()
    print(f"#{aid} → {status}" + (f"  ({note})" if note else ""))


def cmd_json(show_all: bool) -> None:
    print(json.dumps(_fetch(None if show_all else "open"), indent=2, ensure_ascii=False))


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def main() -> None:
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    verb = a[0]
    if verb == "list":
        cmd_list("--all" in a)
    elif verb == "json":
        cmd_json("--all" in a)
    elif verb == "show":
        cmd_show(int(a[1]))
    elif verb == "resolve":
        cmd_resolve(int(a[1]), "addressed", a[2] if len(a) > 2 else "")
    elif verb == "wontfix":
        cmd_resolve(int(a[1]), "wontfix", a[2] if len(a) > 2 else "")
    elif verb == "reopen":
        cmd_resolve(int(a[1]), "open", "")
    else:
        sys.exit(f"unknown verb {verb!r} (list | show | resolve | wontfix | reopen | json)")


if __name__ == "__main__":
    main()
