# /// script
# requires-python = ">=3.12"
# dependencies = ["flask>=3.1,<4"]
# ///
"""
PR review room — a disposable localhost workbench for understanding a change-set.

Not a diff viewer. A *synthesis* surface: read many PRs at a glance, see which
ones collide on the same files (merge-order risk), and drill into any one for an
intent summary, file churn, open concerns, and an architecture sketch.

The terminal side (Claude Code) ingests PRs — title, summary, files, concerns —
via JSON POSTs. The browser is the human's review surface. Both share one SQLite
file; SSE pushes "this region is stale" so the board updates live as PRs land.

Run:
    uv run app.py        # http://127.0.0.1:5051
"""

import queue
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, g, render_template, request

DB_PATH = Path(__file__).parent / "prwb.db"
app = Flask(__name__)

# --- SSE fan-out (named events; the browser re-fetches the named partial) ----
_subs: set[queue.Queue] = set()
_subs_lock = threading.Lock()


def publish(*targets: str) -> None:
    with _subs_lock:
        for q in _subs:
            for t in targets:
                try:
                    q.put_nowait(t)
                except queue.Full:
                    # Drop this stale-region ping. Events are idempotent ("this
                    # region is dirty, re-GET it"), so a full queue just means
                    # the browser hasn't drained yet. Evicting the subscriber
                    # would zombie a live tab — its SSE generator keeps emitting
                    # keep-alives but the tab never updates again. Dropping is
                    # safe.
                    pass


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")


# --- DB ----------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS prs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     INTEGER NOT NULL,
    title      TEXT NOT NULL,
    author     TEXT NOT NULL,
    branch     TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',     -- markdown
    state      TEXT NOT NULL DEFAULT 'open',  -- open | draft | approved | changes
    risk       TEXT NOT NULL DEFAULT 'medium',-- low | medium | high
    additions  INTEGER NOT NULL DEFAULT 0,
    deletions  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pr_files (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id     INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
    path      TEXT NOT NULL,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    kind      TEXT NOT NULL DEFAULT 'modified' -- added | modified | deleted | renamed
);
CREATE TABLE IF NOT EXISTS concerns (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id    INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
    severity TEXT NOT NULL DEFAULT 'nit',  -- blocker | warn | nit
    title    TEXT NOT NULL,
    body     TEXT NOT NULL DEFAULT '',     -- markdown
    path     TEXT,
    resolved INTEGER NOT NULL DEFAULT 0
);
-- the human -> agent channel: review tasks you hand to Claude, and its replies
CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id      INTEGER REFERENCES prs(id) ON DELETE CASCADE,  -- nullable = whole-set ask
    kind       TEXT NOT NULL DEFAULT 'ask',  -- ask | investigate | draft-comment | merge-check | summarize
    body       TEXT NOT NULL,                -- what the human asked (markdown)
    status     TEXT NOT NULL DEFAULT 'queued', -- queued | working | answered
    response   TEXT,                         -- Claude's reply (markdown)
    created_at TEXT NOT NULL,
    answered_at TEXT
);
"""


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        # WAL + busy_timeout: two writers — the human's htmx thread and the
        # agent's terminal thread — hit one SQLite file under threaded=True.
        # WAL lets readers and the writer proceed concurrently; busy_timeout
        # makes a contended write wait briefly instead of raising "database is
        # locked".
        g.db.execute("PRAGMA journal_mode = WAL")
        g.db.execute("PRAGMA busy_timeout = 5000")
    return g.db


@app.teardown_appcontext
def _close(_exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM prs").fetchone()[0] == 0:
        _seed(conn)
    conn.commit()
    conn.close()


def _seed(conn: sqlite3.Connection) -> None:
    """A believable change-set: splitting monolithic billing into a service,
    spread across 5 PRs that deliberately overlap on a few hot files."""
    ts = now()
    prs = [
        # number, title, author, branch, state, risk, summary, files[(path,add,del,kind)], concerns[(sev,title,body,path)]
        (412, "Extract BillingService from monolith", "dana", "billing/extract-service", "changes", "high",
         "Pulls invoice + subscription logic out of `app/models.py` into a new "
         "`billing/` package. **Largest** PR in the set — everything else rebases on this.\n\n"
         "```mermaid\nflowchart LR\n  M[app/models.py] -->|move| B[billing/service.py]\n  B --> R[billing/repository.py]\n  API[api/routes.py] --> B\n```",
         [("billing/service.py", 340, 0, "added"), ("billing/repository.py", 180, 0, "added"),
          ("app/models.py", 12, 410, "modified"), ("api/routes.py", 28, 22, "modified"),
          ("tests/test_billing.py", 210, 0, "added")],
         [("blocker", "Circular import on `app.models`", "`billing/service.py` imports `app.models` which now imports back from `billing`. Break with a protocol.", "billing/service.py"),
          ("warn", "No migration for `invoices.legacy_id`", "The column is dropped but no Alembic migration is included.", "app/models.py")]),
        (415, "Add Stripe webhook handler", "evan", "billing/stripe-webhooks", "open", "medium",
         "New webhook endpoint for Stripe events. Depends on #412's `BillingService` "
         "interface. Touches `api/routes.py` and `config.py`.",
         [("api/routes.py", 64, 4, "modified"), ("billing/webhooks.py", 150, 0, "added"),
          ("config.py", 18, 2, "modified"), ("tests/test_webhooks.py", 90, 0, "added")],
         [("warn", "Webhook signature not verified in tests", "Happy-path only; add a tampered-signature case.", "tests/test_webhooks.py"),
          ("nit", "Hard-coded event types", "Move the `event_types` list to config.", "billing/webhooks.py")]),
        (417, "Cache subscription lookups in Redis", "dana", "billing/sub-cache", "open", "medium",
         "Adds a read-through cache for subscription status. Also edits "
         "`billing/service.py` (collides with #412) and `config.py` (collides with #415).",
         [("billing/service.py", 46, 8, "modified"), ("billing/cache.py", 88, 0, "added"),
          ("config.py", 9, 0, "modified"), ("requirements.txt", 1, 0, "modified")],
         [("warn", "No cache invalidation on plan change", "Stale subscription tier after upgrade until TTL expires.", "billing/cache.py")]),
        (419, "Rename `User.plan` -> `User.tier`", "priya", "refactor/user-tier", "approved", "high",
         "Wide rename across the codebase. Touches `app/models.py` (collides with #412) "
         "and `api/routes.py` (collides with #412 and #415). **Merge-order sensitive.**",
         [("app/models.py", 30, 30, "modified"), ("api/routes.py", 14, 14, "modified"),
          ("app/serializers.py", 22, 22, "modified"), ("tests/test_users.py", 18, 18, "modified")],
         [("blocker", "Rename overlaps #412's model surgery", "Both edit `app/models.py` heavily. Land #412 first, then rebase this.", "app/models.py")]),
        (421, "Docs: billing architecture overview", "evan", "docs/billing", "draft", "low",
         "Documentation only. New `docs/billing.md` describing the extracted service. "
         "Zero code risk.",
         [("docs/billing.md", 120, 0, "added")],
         []),
    ]
    for num, title, author, branch, state, risk, summary, files, concerns in prs:
        add = sum(f[1] for f in files)
        dele = sum(f[2] for f in files)
        cur = conn.execute(
            "INSERT INTO prs (number,title,author,branch,summary,state,risk,additions,deletions,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (num, title, author, branch, summary, state, risk, add, dele, ts))
        pid = cur.lastrowid
        conn.executemany(
            "INSERT INTO pr_files (pr_id,path,additions,deletions,kind) VALUES (?,?,?,?,?)",
            [(pid, *f) for f in files])
        conn.executemany(
            "INSERT INTO concerns (pr_id,severity,title,body,path) VALUES (?,?,?,?,?)",
            [(pid, *c) for c in concerns])


# --- derived: file collisions across PRs -------------------------------------
def collisions():
    """Files touched by more than one PR — the merge-order risk map."""
    rows = db().execute("""
        SELECT f.path,
               COUNT(DISTINCT f.pr_id) AS n,
               SUM(f.additions + f.deletions) AS churn,
               GROUP_CONCAT(p.number || '|' || p.risk || '|' || p.state, ';') AS prs
        FROM pr_files f JOIN prs p ON p.id = f.pr_id
        GROUP BY f.path
        HAVING n > 1
        ORDER BY n DESC, churn DESC
    """).fetchall()
    out = []
    for r in rows:
        prs = [dict(zip(("number", "risk", "state"), x.split("|"))) for x in r["prs"].split(";")]
        out.append({"path": r["path"], "n": r["n"], "churn": r["churn"], "prs": prs})
    return out


# --- render helpers ----------------------------------------------------------
def fleet_rows():
    prs = db().execute("""
        SELECT p.*,
          (SELECT COUNT(*) FROM pr_files f WHERE f.pr_id=p.id) AS n_files,
          (SELECT COUNT(*) FROM concerns c WHERE c.pr_id=p.id AND c.resolved=0 AND c.severity='blocker') AS n_block,
          (SELECT COUNT(*) FROM concerns c WHERE c.pr_id=p.id AND c.resolved=0 AND c.severity='warn') AS n_warn,
          (SELECT COUNT(*) FROM concerns c WHERE c.pr_id=p.id AND c.resolved=0 AND c.severity='nit') AS n_nit,
          (SELECT COUNT(*) FROM requests r WHERE r.pr_id=p.id AND r.status='queued') AS n_queued,
          (SELECT COUNT(*) FROM requests r WHERE r.pr_id=p.id AND r.status='working') AS n_working,
          (SELECT COUNT(*) FROM requests r WHERE r.pr_id=p.id AND r.status='answered') AS n_answered
        FROM prs p
        ORDER BY CASE p.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 (p.additions + p.deletions) DESC
    """).fetchall()
    maxchurn = max([p["additions"] + p["deletions"] for p in prs], default=1) or 1
    return prs, maxchurn


def render_fleet():
    prs, maxchurn = fleet_rows()
    return render_template("partials/fleet.html", prs=prs, maxchurn=maxchurn)


def render_collisions():
    return render_template("partials/collisions.html", cols=collisions())


def render_overview():
    s = db().execute("""
        SELECT COUNT(*) AS n_prs, COALESCE(SUM(additions),0) AS adds, COALESCE(SUM(deletions),0) AS dels
        FROM prs""").fetchone()
    blockers = db().execute("SELECT COUNT(*) FROM concerns WHERE resolved=0 AND severity='blocker'").fetchone()[0]
    ncol = len(collisions())
    return render_template("partials/overview.html", s=s, blockers=blockers, ncol=ncol)


# --- pages & partials --------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/partials/overview")
def p_overview():
    return render_overview()


@app.get("/partials/fleet")
def p_fleet():
    return render_fleet()


@app.get("/partials/collisions")
def p_collisions():
    return render_collisions()


@app.get("/partials/pr/<int:pid>")
def p_pr(pid: int):
    pr = db().execute("SELECT * FROM prs WHERE id=?", (pid,)).fetchone()
    if pr is None:
        return "not found", 404
    files = db().execute(
        "SELECT * FROM pr_files WHERE pr_id=? ORDER BY (additions+deletions) DESC", (pid,)).fetchall()
    concerns = db().execute(
        "SELECT * FROM concerns WHERE pr_id=? ORDER BY CASE severity WHEN 'blocker' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END",
        (pid,)).fetchall()
    # which other PRs share a file with this one?
    overlap = db().execute("""
        SELECT DISTINCT p2.number, p2.id, f2.path
        FROM pr_files f1
        JOIN pr_files f2 ON f1.path = f2.path AND f2.pr_id != f1.pr_id
        JOIN prs p2 ON p2.id = f2.pr_id
        WHERE f1.pr_id = ?
        ORDER BY p2.number""", (pid,)).fetchall()
    maxf = max([f["additions"] + f["deletions"] for f in files], default=1) or 1
    collide_paths = {c["path"] for c in collisions()}
    return render_template("partials/pr_detail.html", pr=pr, files=files,
                           concerns=concerns, overlap=overlap, maxf=maxf,
                           collide_paths=collide_paths)


# --- terminal-side ingestion -------------------------------------------------
@app.post("/pr/ingest")
def ingest():
    """Claude Code posts a whole analyzed PR. Upsert by PR number."""
    d = request.get_json(force=True)
    add = sum(f.get("additions", 0) for f in d.get("files", []))
    dele = sum(f.get("deletions", 0) for f in d.get("files", []))
    existing = db().execute("SELECT id FROM prs WHERE number=?", (d["number"],)).fetchone()
    if existing:
        pid = existing["id"]
        db().execute("UPDATE prs SET title=?,author=?,branch=?,summary=?,state=?,risk=?,additions=?,deletions=?,updated_at=? WHERE id=?",
                     (d["title"], d.get("author", "?"), d.get("branch", "?"), d.get("summary", ""),
                      d.get("state", "open"), d.get("risk", "medium"), add, dele, now(), pid))
        db().execute("DELETE FROM pr_files WHERE pr_id=?", (pid,))
        db().execute("DELETE FROM concerns WHERE pr_id=?", (pid,))
    else:
        cur = db().execute("INSERT INTO prs (number,title,author,branch,summary,state,risk,additions,deletions,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                           (d["number"], d["title"], d.get("author", "?"), d.get("branch", "?"),
                            d.get("summary", ""), d.get("state", "open"), d.get("risk", "medium"), add, dele, now()))
        pid = cur.lastrowid
    db().executemany("INSERT INTO pr_files (pr_id,path,additions,deletions,kind) VALUES (?,?,?,?,?)",
                     [(pid, f["path"], f.get("additions", 0), f.get("deletions", 0), f.get("kind", "modified"))
                      for f in d.get("files", [])])
    db().executemany("INSERT INTO concerns (pr_id,severity,title,body,path) VALUES (?,?,?,?,?)",
                     [(pid, c.get("severity", "nit"), c["title"], c.get("body", ""), c.get("path"))
                      for c in d.get("concerns", [])])
    db().commit()
    publish("fleet", "collisions", "overview")
    return {"ok": True, "id": pid}


@app.post("/concern/<int:cid>/resolve")
def resolve_concern(cid: int):
    db().execute("UPDATE concerns SET resolved = 1 - resolved WHERE id=?", (cid,))
    db().commit()
    publish("fleet", "overview")
    return {"ok": True}


# --- human -> agent review requests ------------------------------------------
def render_thread(pid: int):
    reqs = db().execute(
        "SELECT * FROM requests WHERE pr_id=? ORDER BY id DESC", (pid,)).fetchall()
    return render_template("partials/thread.html", reqs=reqs, pid=pid)


def render_queue():
    reqs = db().execute("""
        SELECT r.*, p.number AS pr_number
        FROM requests r LEFT JOIN prs p ON p.id = r.pr_id
        WHERE r.status != 'answered'
        ORDER BY CASE r.status WHEN 'working' THEN 0 ELSE 1 END, r.id DESC
    """).fetchall()
    return render_template("partials/queue.html", reqs=reqs)


@app.get("/partials/thread/<int:pid>")
def p_thread(pid: int):
    return render_thread(pid)


@app.get("/partials/queue")
def p_queue():
    return render_queue()


@app.post("/pr/<int:pid>/ask")
def ask(pid: int):
    """Human hands Claude a review task on a PR (htmx form POST)."""
    kind = request.form.get("kind", "ask")
    body = request.form.get("body", "").strip()
    if not body:
        body = {"investigate": "Investigate this PR in depth and report what you find.",
                "draft-comment": "Draft a changes-requested review comment for this PR.",
                "merge-check": "Is this PR safe to merge given the file collisions? What order?",
                "summarize": "Give me a tighter summary of what this PR actually changes."}.get(kind, "")
    db().execute(
        "INSERT INTO requests (pr_id, kind, body, status, created_at) VALUES (?,?,?,'queued',?)",
        (pid, kind, body, now()))
    db().commit()
    publish("fleet", "queue")
    return render_thread(pid)


@app.get("/claude/queue")
def claude_queue():
    """Terminal pulls pending requests. Marks them 'working' so the board shows
    Claude has picked them up — the human sees the spinner move."""
    reqs = db().execute("""
        SELECT r.id, r.kind, r.body, r.pr_id, p.number AS pr_number, p.title
        FROM requests r LEFT JOIN prs p ON p.id = r.pr_id
        WHERE r.status = 'queued' ORDER BY r.id""").fetchall()
    if reqs:
        db().execute("UPDATE requests SET status='working' WHERE status='queued'")
        db().commit()
        publish("fleet", "queue")
        for r in reqs:
            if r["pr_id"]:
                publish(f"thread-{r['pr_id']}")
    return {"requests": [dict(r) for r in reqs]}


@app.post("/claude/respond")
def claude_respond():
    """Terminal posts Claude's answer to a request."""
    d = request.get_json(force=True)
    rid = int(d["request_id"])
    pid = db().execute("SELECT pr_id FROM requests WHERE id=?", (rid,)).fetchone()
    db().execute("UPDATE requests SET response=?, status='answered', answered_at=? WHERE id=?",
                 (d.get("response", ""), now(), rid))
    db().commit()
    publish("fleet", "queue")
    if pid and pid["pr_id"]:
        publish(f"thread-{pid['pr_id']}")
    return {"ok": True}


@app.get("/events")
def events():
    def stream():
        q: queue.Queue = queue.Queue(maxsize=64)
        with _subs_lock:
            _subs.add(q)
        try:
            yield "event: hello\ndata: connected\n\n"
            while True:
                try:
                    target = q.get(timeout=15)
                    yield f"event: {target}\ndata: stale\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            with _subs_lock:
                _subs.discard(q)
    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5051, debug=True, threaded=True)
