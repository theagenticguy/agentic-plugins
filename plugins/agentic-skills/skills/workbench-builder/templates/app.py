# /// script
# requires-python = ">=3.12"
# dependencies = ["flask>=3.1,<4"]
# ///
"""
{{ WORKBENCH NAME }} — a disposable localhost workbench.

A tiny visual surface for a Claude Code session. The terminal stays the
terminal; the browser becomes a place to scan {{ THE THING }}, act on it, and
read notes from both sides. Both surfaces share one SQLite file, and the
two-way loop is what makes this a *workbench*, not a read-only dashboard:

  - Human acts in the browser     → htmx POST → SQLite → return a fragment +
                                     publish() an SSE invalidation.
  - Claude acts in the terminal   → httpx/curl → SQLite → publish() the same.
  - Human hands Claude a task     → requests table → /claude/queue pulls it
                                     (queued→working) → /claude/respond answers.

Run:
    uv run app.py        # http://127.0.0.1:5050  (PORT below)

Design rules (kept deliberately boring — boring means no toolchain, not no
capability):
  - 127.0.0.1 only. No auth, no deploy, no build step, no npm.
  - htmx drives forms/buttons and swaps server-rendered HTML fragments.
  - SSE is an INVALIDATION SIGNAL, not the data transport. On a state change we
    emit a tiny NAMED event; the browser re-fetches the matching partial over a
    normal GET. Tiny events, no client-side state model.

Layout this expects (Flask resolves templates relative to THIS file):
    your-workbench/
      app.py
      templates/
        index.html              # the base page (copy templates/index.html)
        partials/               # YOU create these — app.py renders them by name:
          board.html            #   the main list/grid (GET /partials/board)
          board_row.html        #   one row, swapped in place after status/note
          summary.html          #   stats / charts region (GET /partials/summary)
          event_log.html        #   the human+claude activity feed
          queue.html            #   the human→agent request queue
          thread.html           #   one item's ask-claude conversation
      scripts/                  # terminal-side helpers (copy templates/terminal-helper.py)
Running app.py before those partials exist raises TemplateNotFound — that is the
build, not a bug. Scaffold the partials in Phase 2 (see references/orchestrator.md).
"""

import queue
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, g, render_template, request

DB_PATH = Path(__file__).parent / "workbench.db"   # rename per workbench
app = Flask(__name__)

# Bind one port per workbench so several can run at once (eval viewer on 5050,
# PR room on 5051, …). 127.0.0.1 only — this is a local, no-auth tool.
PORT = 5050


# --------------------------------------------------------------------------
# SSE fan-out: a set of subscriber queues. publish() drops a small NAMED event
# onto every connected browser's queue. We never push data here — just "this
# region changed, go re-fetch it."
#
# Each `target` becomes the SSE `event:` name (e.g. "board"). The browser side
# listens for that exact name with htmx's `hx-trigger="sse:board"` and
# re-fetches the matching partial. publish() takes *targets so one state change
# can invalidate several regions at once (the board, the summary, the log).
# --------------------------------------------------------------------------
_subs: set[queue.Queue] = set()
_subs_lock = threading.Lock()


def publish(*targets: str) -> None:
    """Fan NAMED invalidation events out to every connected browser."""
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


# --------------------------------------------------------------------------
# Database — raw sqlite3, no ORM.
#
# The data model IS the design. Phase 0 of the build is deciding what shared
# state the human and the agent both act on; everything else hangs off these
# tables. Replace the {{ domain tables }} below with yours, but KEEP the
# `requests` table — it's the human→agent channel that closes the loop.
# --------------------------------------------------------------------------
SCHEMA = """
-- ==========================================================================
-- {{ YOUR DOMAIN TABLES HERE }}
-- The example below is a generic "items" board: rows the human triages and
-- the agent enriches. Swap it for your recipe's shape (PRs + files + concerns,
-- eval cases + runs, trace spans, migration steps, ...).
-- ==========================================================================
CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',      -- markdown; rendered in the browser
    status      TEXT NOT NULL DEFAULT 'new',   -- new | working | done  ({{ your states }})
    human_note  TEXT,                          -- what the human jotted down
    agent_note  TEXT,                          -- what Claude reported back
    updated_at  TEXT NOT NULL
);

-- A small activity feed — handy for showing both sides acting on the same state.
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,   -- human | claude | system
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ==========================================================================
-- The human → agent channel. KEEP THIS regardless of domain. The human files
-- a request from the browser; the terminal pulls it (flipping queued→working
-- so the human sees Claude pick it up), works it, and posts a response back.
-- ==========================================================================
CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER REFERENCES items(id) ON DELETE CASCADE,  -- nullable = whole-board ask
    kind        TEXT NOT NULL DEFAULT 'ask',     -- ask | investigate | summarize | {{ your kinds }}
    body        TEXT NOT NULL,                   -- what the human asked (markdown)
    status      TEXT NOT NULL DEFAULT 'queued',  -- queued | working | answered
    response    TEXT,                            -- Claude's reply (markdown)
    created_at  TEXT NOT NULL,
    answered_at TEXT
);
"""


def db() -> sqlite3.Connection:
    """One connection per request, cached on Flask's `g`, closed on teardown.
    row_factory = Row so partials can do `row["title"]`. Foreign keys ON so the
    ON DELETE CASCADE above actually fires."""
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
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def log_event(source: str, message: str) -> None:
    db().execute(
        "INSERT INTO events (source, message, created_at) VALUES (?, ?, ?)",
        (source, message, now()),
    )
    db().commit()


def init_db() -> None:
    """Create tables and seed once. The COUNT guard keeps reruns from
    duplicating the seed — the DB is disposable, but not on every reload."""
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0:
        _seed(conn)
    conn.commit()
    conn.close()


def _seed(conn: sqlite3.Connection) -> None:
    """A tiny but believable seed so the UI has something on first load. Give at
    least one row rich GFM (fenced code + a ```mermaid``` fence + a table) so the
    markdown/highlight/mermaid pipeline is exercised the moment the page opens."""
    ts = now()
    rich = (
        "First-pass finding: the retry path **double-counts** on timeout.\n\n"
        "```python\n"
        "# was: attempts += 1 inside BOTH the loop and the except\n"
        "attempts += 1          # once, at the top of the loop\n"
        "```\n\n"
        "Flow now:\n\n"
        "```mermaid\n"
        "flowchart LR\n"
        "  A[call] --> B{ok?}\n"
        "  B -->|yes| C[return]\n"
        "  B -->|no| D[retry <= 3]\n"
        "```\n\n"
        "| case | before | after |\n"
        "|---|---|---|\n"
        "| timeout | 2x | **1x** |\n"
    )
    seed = [
        # title, detail, status, agent_note
        ("Triage the flaky timeout test", rich, "working", None),
        ("Review config defaults", "Check `config.py` for a hard-coded TTL.", "new", None),
        ("Confirm the unicode echo case", "Echo 'José Ñúñez' round-trips cleanly.", "done", "Verified — no mojibake."),
    ]
    conn.executemany(
        "INSERT INTO items (title, detail, status, agent_note, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        [(*row, ts) for row in seed],
    )
    conn.execute(
        "INSERT INTO events (source, message, created_at) VALUES (?, ?, ?)",
        ("system", f"Seeded {len(seed)} items.", ts),
    )


# --------------------------------------------------------------------------
# Render helpers — one function per live region. Each partial is rendered from a
# single query so the full-page render and the htmx/SSE re-fetch share ONE
# source of truth. Add a render_<region>() for every region you can update.
# --------------------------------------------------------------------------
def render_board(status_filter: str | None = None):
    if status_filter and status_filter != "all":
        rows = db().execute(
            "SELECT * FROM items WHERE status = ? ORDER BY id", (status_filter,)
        ).fetchall()
    else:
        rows = db().execute("SELECT * FROM items ORDER BY id").fetchall()
    return render_template(
        "partials/board.html", items=rows, status_filter=status_filter or "all"
    )


def render_summary():
    s = db().execute(
        "SELECT "
        "  SUM(status='new')     AS n_new, "
        "  SUM(status='working') AS n_working, "
        "  SUM(status='done')    AS n_done, "
        "  COUNT(*)              AS total "
        "FROM items"
    ).fetchone()
    return render_template("partials/summary.html", s=s)


def render_event_log():
    rows = db().execute("SELECT * FROM events ORDER BY id DESC LIMIT 25").fetchall()
    return render_template("partials/event_log.html", events=rows)


def render_thread(item_id: int):
    """The per-item human↔agent conversation."""
    reqs = db().execute(
        "SELECT * FROM requests WHERE item_id = ? ORDER BY id DESC", (item_id,)
    ).fetchall()
    return render_template("partials/thread.html", reqs=reqs, item_id=item_id)


def render_queue():
    """The board-wide view of what the human has handed Claude and where it is."""
    reqs = db().execute(
        "SELECT r.*, i.title AS item_title "
        "FROM requests r LEFT JOIN items i ON i.id = r.item_id "
        "WHERE r.status != 'answered' "
        "ORDER BY CASE r.status WHEN 'working' THEN 0 ELSE 1 END, r.id DESC"
    ).fetchall()
    return render_template("partials/queue.html", reqs=reqs)


# --------------------------------------------------------------------------
# Pages & partials. The partial routes are GET-only and mirror the render
# helpers 1:1 — these are exactly what the SSE-triggered hx-get hits.
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/partials/board")
def p_board():
    return render_board(request.args.get("status"))


@app.get("/partials/summary")
def p_summary():
    return render_summary()


@app.get("/partials/event-log")
def p_event_log():
    return render_event_log()


@app.get("/partials/thread/<int:item_id>")
def p_thread(item_id: int):
    return render_thread(item_id)


@app.get("/partials/queue")
def p_queue():
    return render_queue()


# --------------------------------------------------------------------------
# Human actions (htmx POSTs). Each writes to SQLite, publishes the SSE
# invalidations for every region it touched, and returns the swapped fragment.
# --------------------------------------------------------------------------
@app.post("/items/<int:item_id>/status")
def set_status(item_id: int):
    new_status = request.form["status"]
    db().execute(
        "UPDATE items SET status = ?, updated_at = ? WHERE id = ?",
        (new_status, now(), item_id),
    )
    db().commit()
    title = db().execute("SELECT title FROM items WHERE id = ?", (item_id,)).fetchone()["title"]
    log_event("human", f"Marked '{title}' as {new_status}.")
    # One change, several stale regions — publish them all in one call.
    publish("board", "summary", "event-log")
    # Return just the updated row so htmx swaps it in place.
    row = db().execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return render_template("partials/board_row.html", i=row)


@app.post("/items/<int:item_id>/note")
def set_note(item_id: int):
    note = request.form.get("human_note", "").strip()
    db().execute(
        "UPDATE items SET human_note = ?, updated_at = ? WHERE id = ?",
        (note, now(), item_id),
    )
    db().commit()
    publish("board", "event-log")
    row = db().execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return render_template("partials/board_row.html", i=row)


# --------------------------------------------------------------------------
# Terminal-side ingest. Claude Code POSTs analyzed work in as JSON; the terminal
# wants JSON back, not HTML. Upsert so re-ingesting the same logical thing
# updates in place instead of duplicating. Publish so the browser updates live
# while Claude works.
# --------------------------------------------------------------------------
@app.post("/items/ingest")
def ingest():
    d = request.get_json(force=True)
    existing = (
        db().execute("SELECT id FROM items WHERE title = ?", (d["title"],)).fetchone()
        if d.get("title")
        else None
    )
    if existing:
        item_id = existing["id"]
        db().execute(
            "UPDATE items SET detail=?, status=?, agent_note=?, updated_at=? WHERE id=?",
            (d.get("detail", ""), d.get("status", "new"), d.get("agent_note"), now(), item_id),
        )
    else:
        cur = db().execute(
            "INSERT INTO items (title, detail, status, agent_note, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (d["title"], d.get("detail", ""), d.get("status", "new"), d.get("agent_note"), now()),
        )
        item_id = cur.lastrowid
    db().commit()
    log_event("claude", f"Ingested '{d.get('title', '?')}'.")
    publish("board", "summary", "event-log")
    return {"ok": True, "id": item_id}


# --------------------------------------------------------------------------
# Human → agent channel. This is the loop. Mirror these three endpoints exactly
# for your domain — they are why the workbench steers rather than just reports.
# --------------------------------------------------------------------------
@app.post("/items/<int:item_id>/ask")
def ask(item_id: int):
    """Human hands Claude a task on an item (htmx form POST). A blank body falls
    back to a sensible default per kind, so one-click buttons work."""
    kind = request.form.get("kind", "ask")
    body = request.form.get("body", "").strip()
    if not body:
        body = {
            "investigate": "Investigate this item in depth and report what you find.",
            "summarize": "Give me a tighter summary of what this is.",
        }.get(kind, "")
    db().execute(
        "INSERT INTO requests (item_id, kind, body, status, created_at) "
        "VALUES (?, ?, ?, 'queued', ?)",
        (item_id, kind, body, now()),
    )
    db().commit()
    publish("queue", f"thread-{item_id}")
    return render_thread(item_id)


@app.post("/items/ask")
def ask_board():
    """A board-wide ask (no item_id) — the index.html loop form posts here.
    item_id stays NULL (the schema allows it: nullable = whole-board ask), so
    the request shows up in the queue but isn't tied to one row. Returns the
    queue partial so the loop region swaps in place; publishes sse:queue so
    other tabs follow."""
    kind = request.form.get("kind", "ask")
    body = request.form.get("body", "").strip()
    if not body:
        return render_queue()
    db().execute(
        "INSERT INTO requests (item_id, kind, body, status, created_at) "
        "VALUES (NULL, ?, ?, 'queued', ?)",
        (kind, body, now()),
    )
    db().commit()
    publish("queue")
    return render_queue()


@app.get("/claude/queue")
def claude_queue():
    """Terminal pulls pending requests and flips them queued→working in the same
    breath, so the human watching the browser sees Claude pick the task up. The
    terminal helper polls this, works each request, then POSTs to /claude/respond."""
    reqs = db().execute(
        "SELECT r.id, r.kind, r.body, r.item_id, i.title "
        "FROM requests r LEFT JOIN items i ON i.id = r.item_id "
        "WHERE r.status = 'queued' ORDER BY r.id"
    ).fetchall()
    if reqs:
        db().execute("UPDATE requests SET status = 'working' WHERE status = 'queued'")
        db().commit()
        publish("queue")
        for r in reqs:
            if r["item_id"]:
                publish(f"thread-{r['item_id']}")
    return {"requests": [dict(r) for r in reqs]}


@app.post("/claude/respond")
def claude_respond():
    """Terminal posts Claude's answer back. status → answered; the thread + queue
    re-render in the browser with the reply."""
    d = request.get_json(force=True)
    rid = int(d["request_id"])
    row = db().execute("SELECT item_id FROM requests WHERE id = ?", (rid,)).fetchone()
    db().execute(
        "UPDATE requests SET response = ?, status = 'answered', answered_at = ? WHERE id = ?",
        (d.get("response", ""), now(), rid),
    )
    db().commit()
    publish("queue")
    if row and row["item_id"]:
        publish(f"thread-{row['item_id']}")
    return {"ok": True}


# --------------------------------------------------------------------------
# SSE stream. ONE EventSource per browser (opened via the htmx SSE extension on
# <body>). Each subscriber gets its own bounded queue; we yield a NAMED event
# per invalidation and a comment keep-alive otherwise so proxies don't close an
# idle connection.
# --------------------------------------------------------------------------
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
                    # NAMED event — htmx's sse:<name> trigger keys off this line.
                    yield f"event: {target}\ndata: stale\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"  # comment frame; holds the connection open
        finally:
            with _subs_lock:
                _subs.discard(q)

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    init_db()
    # threaded=True so the long-lived SSE stream doesn't block other requests;
    # debug=True for hot reload while Claude reshapes the UI mid-session.
    app.run(host="127.0.0.1", port=PORT, debug=True, threaded=True)
