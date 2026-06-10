# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""The terminal half of the review loop.

In a real session Claude Code runs this (or its logic inline): pull the queue of
things the human asked, do the work — read the diff, trace the import, draft the
comment — then POST a markdown response back. The browser updates live via SSE.

    uv run scripts/review_loop.py            # pull queue, auto-answer (demo)
    uv run scripts/review_loop.py --list     # just show what's queued
"""
import sys
import httpx

BASE = "http://127.0.0.1:5051"


def main() -> None:
    pull = httpx.get(f"{BASE}/claude/queue").json()
    reqs = pull["requests"]
    if not reqs:
        print("queue empty.")
        return
    if "--list" in sys.argv:
        for r in reqs:
            print(f"  #{r.get('pr_number','?')} [{r['kind']}] {r['body'][:70]}")
        return
    for r in reqs:
        # A real run would synthesize this from the actual diff/code. Demo replies:
        answer = _demo_answer(r)
        httpx.post(f"{BASE}/claude/respond", json={"request_id": r["id"], "response": answer})
        print(f"answered request {r['id']} on PR #{r.get('pr_number','?')}")


def _demo_answer(r: dict) -> str:
    kind, pr = r["kind"], r.get("pr_number", "?")
    if kind == "merge-check":
        return (f"**Not yet — merge #412 first.** PR #{pr} edits `app/models.py` and "
                f"`api/routes.py`, both of which #412 rewrites. Recommended order:\n\n"
                "1. `#412` (the extraction — everything rebases on it)\n"
                "2. `#415`, then `#419`\n3. `#417` last (smallest config touch)\n\n"
                "Rebase #" f"{pr} after #412 lands and re-run the suite.")
    if kind == "draft-comment":
        return ("> **Requesting changes.** Solid direction. Two things before approve:\n>\n"
                "> 1. The circular import (`billing.service` ↔ `app.models`) needs a protocol seam.\n"
                "> 2. Add the Alembic migration for the dropped `invoices.legacy_id` column.\n>\n"
                "> Happy to re-review once those land.")
    if kind == "investigate":
        return ("Traced it. The cycle is:\n\n```\napp/models.py  -> imports billing.service (new)\n"
                "billing/service.py -> imports app.models (Invoice)\n```\n\n"
                "Fix: define an `InvoiceLike` Protocol in `billing/types.py` and type against that, "
                "so `billing` never imports `app`. ~15 lines, no behavior change.")
    if kind == "summarize":
        return f"**PR #{pr} in one line:** moves invoice/subscription logic into a standalone `billing/` package; everything else in the set rebases on it."
    return f"Looked into PR #{pr}. {r['body']}\n\n*(demo response — a real run would answer from the diff.)*"


if __name__ == "__main__":
    main()
