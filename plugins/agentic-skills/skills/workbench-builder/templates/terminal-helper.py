# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Terminal half of the workbench loop — the agent's hands.

A workbench is a two-way loop, not a dashboard. The human acts in the browser
(htmx POST -> SQLite -> publish SSE). The terminal acts here (httpx -> SQLite ->
publish SSE). Both share one SQLite file, so a POST from this script lands in an
already-open browser live, with no reload — the server re-renders the affected
partial and pushes a named SSE event that re-fetches exactly that region.

This file shows the TWO patterns every workbench terminal helper needs. Copy the
one you need into scripts/<verb>.py, set BASE, and swap the demo payloads for
real work where marked. Run with uv so the inline deps resolve with no venv:

    uv run scripts/terminal-helper.py ingest "date-parse fails on DST" "expected Thu, got Wed"
    uv run scripts/terminal-helper.py status 4 done
    uv run scripts/terminal-helper.py loop            # pull queue, answer each
    uv run scripts/terminal-helper.py loop --list      # just show what's queued

These verbs hit the routes the app.py skeleton ships (/items/ingest,
/items/<id>/status, /claude/queue, /claude/respond). Rename them per recipe —
an eval viewer might expose `record-result`, a PR room `analyze-pr`. Distilled
from workbench/scripts/{post_claude_note,record_eval_result}.py and
pr-workbench/scripts/{analyze_pr,review_loop}.py.
"""
import sys

import httpx

# The port app.py binds (app.run(host="127.0.0.1", port=PORT, ...)). 127.0.0.1
# only — the workbench is a local, no-auth tool. Match this to YOUR app.py.
BASE = "http://127.0.0.1:5050"


# ---------------------------------------------------------------------------
# Pattern 1 — one-shot ingest / post.
#
# The terminal pushes a single fact into shared state and returns. The server
# writes SQLite and calls publish(<region>), so the browser's matching live
# region (hx-trigger="sse:<region>") re-fetches itself. Use this for "record a
# result", "post a note", "ingest an analyzed PR" — anything fire-and-forget.
# Raise on non-2xx so a wiring bug surfaces loudly instead of silently no-op'ing.
# ---------------------------------------------------------------------------
def ingest_item(title: str, detail: str = "", status: str = "new", agent_note: str | None = None) -> None:
    """Push one analyzed work item into shared state from the terminal.

    Hits the app.py skeleton's POST /items/ingest (upsert by title). In a real
    run Claude substitutes the demo args for actual work: read the file, run the
    eval, analyze the PR — then ingest the synthesized item. The browser's board
    region re-renders on the SSE. This is the fire-and-forget "agent found
    something, put it on the board" path.
    """
    payload: dict = {"title": title, "detail": detail, "status": status}
    if agent_note:
        payload["agent_note"] = agent_note  # markdown — rendered in the browser
    r = httpx.post(f"{BASE}/items/ingest", json=payload)
    r.raise_for_status()
    print(f"ingested: {title}")


def set_status(item_id: str, status: str) -> None:
    """Record a verdict for one work item from the terminal.

    Hits POST /items/<id>/status (form-encoded, matching the htmx buttons the
    human uses — terminal and browser drive the SAME endpoint). The board row
    re-renders live on the SSE.
    """
    r = httpx.post(f"{BASE}/items/{item_id}/status", data={"status": status})
    r.raise_for_status()
    print(f"set {item_id}: {status}")


# ---------------------------------------------------------------------------
# Pattern 2 — pull-and-respond review loop.
#
# This is what makes the loop two-way: the HUMAN steers from the browser
# (clicks "ask Claude to check merge order"), which queues a request; the
# TERMINAL pulls the queue, does the work, and posts an answer back. Both sides
# watch the same SQLite state update live.
#
# GET /claude/queue is stateful by design: it flips queued -> working and
# publishes, so the human sees the spinner move the instant Claude picks the
# work up. Then per request you POST /claude/respond with markdown the browser
# renders (it runs the full marked + highlight + mermaid + DOMPurify pipeline).
# ---------------------------------------------------------------------------
def review_loop(list_only: bool = False) -> None:
    """Pull the human's pending requests, do the work, answer each."""
    reqs = httpx.get(f"{BASE}/claude/queue").json()["requests"]
    if not reqs:
        print("queue empty.")
        return
    if list_only:
        for r in reqs:
            print(f"  #{r.get('ref','?')} [{r['kind']}] {r['body'][:70]}")
        return
    for r in reqs:
        # ----- substitute real work here -------------------------------------
        # A real run reads the diff / traces the import / runs the eval and
        # synthesizes the answer from it. _demo_answer is a stand-in so the
        # template runs end-to-end against a freshly seeded workbench.
        answer = _demo_answer(r)
        # ---------------------------------------------------------------------
        resp = httpx.post(
            f"{BASE}/claude/respond",
            json={"request_id": r["id"], "response": answer},
        )
        resp.raise_for_status()
        print(f"answered request {r['id']} (#{r.get('ref', '?')})")


def _demo_answer(r: dict) -> str:
    """Worked example replies, keyed by request kind. Delete in a real helper —
    this exists only so `loop` produces something to render in the demo."""
    kind = r.get("kind", "")
    ref = r.get("ref", "?")
    if kind == "merge-check":
        return (
            f"**Not yet — land #412 first.** #{ref} edits `app/models.py` and "
            "`api/routes.py`, both of which #412 rewrites. Recommended order:\n\n"
            "1. `#412` (the extraction — everything rebases on it)\n"
            "2. `#415`, then `#419`\n3. `#417` last\n\n"
            f"Rebase #{ref} after #412 lands and re-run the suite."
        )
    if kind == "investigate":
        return (
            "Traced it. The cycle is:\n\n```\napp/models.py -> billing.service\n"
            "billing/service.py -> app.models (Invoice)\n```\n\n"
            "Fix: define an `InvoiceLike` Protocol in `billing/types.py`, so "
            "`billing` never imports `app`. ~15 lines, no behavior change."
        )
    if kind == "summarize":
        return f"**#{ref} in one line:** {r.get('body', '').strip() or 'pulled from the diff.'}"
    return f"Looked into #{ref}. {r.get('body', '')}\n\n*(demo reply — a real run answers from the diff.)*"


# ---------------------------------------------------------------------------
# CLI dispatch — a thin arg parser so the template is runnable as-is. Real
# helpers are usually one verb per file (scripts/post_note.py etc.); this keeps
# both patterns in one file you can read top-to-bottom.
# ---------------------------------------------------------------------------
def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(
            "usage:\n"
            "  terminal-helper.py ingest <title> [detail] [status]\n"
            "  terminal-helper.py status <item_id> <status>\n"
            "  terminal-helper.py loop [--list]"
        )
    verb, args = sys.argv[1], sys.argv[2:]
    if verb == "ingest":
        if not args:
            sys.exit("usage: terminal-helper.py ingest <title> [detail] [status]")
        ingest_item(args[0], args[1] if len(args) > 1 else "",
                    args[2] if len(args) > 2 else "new")
    elif verb == "status":
        if len(args) < 2:
            sys.exit("usage: terminal-helper.py status <item_id> <status>")
        set_status(args[0], args[1])
    elif verb == "loop":
        review_loop(list_only="--list" in args)
    else:
        sys.exit(f"unknown verb: {verb!r} (ingest | status | loop)")


if __name__ == "__main__":
    main()
