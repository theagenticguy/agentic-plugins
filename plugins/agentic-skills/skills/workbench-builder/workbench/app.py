# /// script
# requires-python = ">=3.12"
# dependencies = ["flask>=3.1,<4"]
# ///
"""
Disposable localhost workbench — eval viewer.

A tiny visual surface for a Claude Code session. The terminal stays the
terminal; the browser becomes a place to scan eval cases, mark
pass/fail/needs-review, and read notes from both sides. Both surfaces talk to
the same SQLite file.

Run:
    uv run app.py
    # or, for Flask's own reloader:
    flask --app app --debug run --host 127.0.0.1 --port 5000

Design rules (kept deliberately boring):
  - 127.0.0.1 only. No auth, no deploy, no build step.
  - htmx drives forms/buttons and swaps server-rendered HTML fragments.
  - SSE is an INVALIDATION SIGNAL, not the data transport. On a state change
    we emit a tiny NAMED event (`event: <region>` with `data: stale`); the
    browser re-fetches that one region's partial over a normal GET.
"""

import queue
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, g, render_template, request

DB_PATH = Path(__file__).parent / "workbench.db"

app = Flask(__name__)

# --------------------------------------------------------------------------
# SSE plumbing: a fan-out of subscriber queues. publish() drops a small event
# onto every connected browser's queue. We never push data here — just "this
# target changed, go re-fetch it."
# --------------------------------------------------------------------------
_subscribers: set[queue.Queue] = set()
_subscribers_lock = threading.Lock()


def publish(target: str) -> None:
    """Fan a NAMED invalidation event out to every browser.

    `target` becomes the SSE `event:` name (e.g. "eval-board"). The browser
    side listens for that exact name with htmx's `hx-trigger="sse:eval-board"`
    and re-fetches the matching partial. The event carries no real data — it's
    a "this region is stale, go GET it" signal. That's the whole point: tiny
    events, server-rendered HTML over normal GETs.
    """
    with _subscribers_lock:
        for q in _subscribers:
            try:
                q.put_nowait(target)
            except queue.Full:
                # Drop this stale-region ping. Events are idempotent ("this
                # region is dirty, re-GET it"), so a full queue just means the
                # browser hasn't drained yet. Evicting the subscriber would
                # zombie a live tab — its SSE generator keeps emitting
                # keep-alives but the tab never updates again. Dropping is safe.
                pass


# --------------------------------------------------------------------------
# Database — raw sqlite3, no ORM.
# --------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS evals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    input         TEXT NOT NULL,
    expected      TEXT NOT NULL,
    actual        TEXT,
    status        TEXT NOT NULL DEFAULT 'needs-review',  -- pass | fail | needs-review
    human_note    TEXT,
    claude_note   TEXT,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    n_pass     INTEGER NOT NULL DEFAULT 0,
    n_fail     INTEGER NOT NULL DEFAULT 0,
    n_review   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,   -- human | claude | system
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        # busy_timeout FIRST: every later statement on this connection then
        # waits on a contended lock instead of failing immediately. Two writers
        # (the human's htmx thread + the agent's terminal thread) share one
        # SQLite file under threaded=True; WAL (set once in init_db) lets a
        # reader and the writer proceed concurrently, and this timeout absorbs
        # the brief writer-writer contention. Order matters — setting WAL or
        # any write here BEFORE the timeout is what caused "database is locked"
        # under concurrent first-load requests.
        g.db.execute("PRAGMA busy_timeout = 5000")
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
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
    conn = sqlite3.connect(DB_PATH)
    # Set WAL once, at startup, on this single connection. WAL is a persistent
    # property of the database file, so it does NOT need to be re-set on every
    # per-request connection (doing that raced under concurrent first-load
    # requests and raised "database is locked").
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    # Seed a few cases only if the table is empty, so reruns don't duplicate.
    count = conn.execute("SELECT COUNT(*) FROM evals").fetchone()[0]
    if count == 0:
        seed = [
            ("greeting-formal", "Write a one-line formal greeting.",
             "Good morning. How may I help you today?",
             "Good morning. How may I help you today?", "pass"),
            ("greeting-casual", "Write a casual hello.",
             "Hey! What's up?", "Greetings, human.", "fail"),
            ("sum-two-ints", "What is 17 + 25?",
             "42", "42", "pass"),
            ("date-parse", "Parse '2026-05-28' into a weekday.",
             "Thursday", "Wednesday", "fail"),
            ("empty-input", "Handle an empty string gracefully.",
             "(returns a friendly error)", None, "needs-review"),
            ("unicode-name", "Echo the name 'José Ñúñez'.",
             "José Ñúñez", "José Ñúñez", "needs-review"),
        ]
        ts = now()
        conn.executemany(
            "INSERT INTO evals (name, input, expected, actual, status, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(*row, ts) for row in seed],
        )
        conn.execute(
            "INSERT INTO events (source, message, created_at) VALUES (?, ?, ?)",
            ("system", f"Seeded {len(seed)} eval cases.", ts),
        )
        # Give one case a rich GFM note so highlighting + mermaid show on load.
        claude_md = (
            "Root cause: weekday lookup was **0-indexed**. Fix:\n\n"
            "```python\n"
            "# was: days[d.weekday() - 1]  -> off by one\n"
            "weekday = d.strftime('%A')   # 'Thursday'\n"
            "```\n\n"
            "Control flow now:\n\n"
            "```mermaid\n"
            "flowchart LR\n"
            "  A[parse date] --> B{valid?}\n"
            "  B -->|yes| C[strftime %A]\n"
            "  B -->|no| D[friendly error]\n"
            "```\n\n"
            "| case | before | after |\n"
            "|---|---|---|\n"
            "| date-parse | Wednesday | **Thursday** |\n"
        )
        conn.execute("UPDATE evals SET claude_note = ? WHERE name = 'date-parse'", (claude_md,))
        # Seed a couple of historical runs so the chart has a trend on first load.
        conn.executemany(
            "INSERT INTO runs (label, n_pass, n_fail, n_review, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            [
                ("baseline", 2, 3, 1, ts),
                ("after-first-pass", 2, 2, 2, ts),
            ],
        )
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Render helpers — each partial is rendered from a single query so htmx and the
# full-page render share one source of truth.
# --------------------------------------------------------------------------
def render_board(status_filter: str | None = None):
    if status_filter and status_filter != "all":
        rows = db().execute(
            "SELECT * FROM evals WHERE status = ? ORDER BY id", (status_filter,)
        ).fetchall()
    else:
        rows = db().execute("SELECT * FROM evals ORDER BY id").fetchall()
    return render_template(
        "partials/eval_board.html", evals=rows, status_filter=status_filter or "all"
    )


def render_summary():
    row = db().execute(
        "SELECT "
        "  SUM(status='pass') AS n_pass, "
        "  SUM(status='fail') AS n_fail, "
        "  SUM(status='needs-review') AS n_review, "
        "  COUNT(*) AS total "
        "FROM evals"
    ).fetchone()
    return render_template("partials/run_summary.html", s=row)


def render_event_log():
    rows = db().execute(
        "SELECT * FROM events ORDER BY id DESC LIMIT 25"
    ).fetchall()
    return render_template("partials/event_log.html", events=rows)


# --------------------------------------------------------------------------
# Pages & partials
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/partials/eval-board")
def partial_board():
    return render_board(request.args.get("status"))


@app.get("/partials/run-summary")
def partial_summary():
    return render_summary()


@app.get("/partials/event-log")
def partial_events():
    return render_event_log()


@app.get("/data/run-history")
def run_history():
    """Run snapshots as JSON, for the Observable Plot chart in the browser."""
    rows = db().execute(
        "SELECT id, label, n_pass, n_fail, n_review, created_at FROM runs ORDER BY id"
    ).fetchall()
    return {"runs": [dict(r) for r in rows]}


# --------------------------------------------------------------------------
# Human actions (htmx POSTs). Each returns the swapped fragment AND publishes
# an SSE invalidation so other surfaces refresh too.
# --------------------------------------------------------------------------
@app.post("/evals/<int:eval_id>/status")
def set_status(eval_id: int):
    new_status = request.form["status"]
    db().execute(
        "UPDATE evals SET status = ?, updated_at = ? WHERE id = ?",
        (new_status, now(), eval_id),
    )
    db().commit()
    name = db().execute("SELECT name FROM evals WHERE id = ?", (eval_id,)).fetchone()["name"]
    log_event("human", f"Marked '{name}' as {new_status}.")
    publish("eval-board")
    publish("run-summary")
    publish("event-log")
    # Return just the updated row so htmx can swap it in place.
    row = db().execute("SELECT * FROM evals WHERE id = ?", (eval_id,)).fetchone()
    return render_template("partials/eval_row.html", e=row)


@app.post("/evals/<int:eval_id>/note")
def set_note(eval_id: int):
    note = request.form.get("human_note", "").strip()
    db().execute(
        "UPDATE evals SET human_note = ?, updated_at = ? WHERE id = ?",
        (note, now(), eval_id),
    )
    db().commit()
    name = db().execute("SELECT name FROM evals WHERE id = ?", (eval_id,)).fetchone()["name"]
    log_event("human", f"Added a note to '{name}'.")
    publish("eval-board")
    publish("event-log")
    row = db().execute("SELECT * FROM evals WHERE id = ?", (eval_id,)).fetchone()
    return render_template("partials/eval_row.html", e=row)


# --------------------------------------------------------------------------
# Claude Code terminal-side endpoints. These are what the helper scripts POST
# to. They return JSON (the terminal doesn't want HTML) and publish SSE so the
# browser updates live while Claude works.
# --------------------------------------------------------------------------
@app.post("/claude/note")
def claude_note():
    data = request.get_json(force=True, silent=True) or request.form
    message = data.get("message", "").strip()
    eval_id = data.get("eval_id")
    if eval_id:
        db().execute(
            "UPDATE evals SET claude_note = ?, updated_at = ? WHERE id = ?",
            (message, now(), int(eval_id)),
        )
        db().commit()
        publish("eval-board")
    log_event("claude", message or "(empty note)")
    publish("event-log")
    return {"ok": True}


@app.post("/claude/eval-result")
def claude_eval_result():
    data = request.get_json(force=True, silent=True) or request.form
    eval_id = int(data["eval_id"])
    actual = data.get("actual", "")
    status = data.get("status", "needs-review")
    db().execute(
        "UPDATE evals SET actual = ?, status = ?, updated_at = ? WHERE id = ?",
        (actual, status, now(), eval_id),
    )
    db().commit()
    name = db().execute("SELECT name FROM evals WHERE id = ?", (eval_id,)).fetchone()["name"]
    log_event("claude", f"Recorded result for '{name}': {status}.")
    publish("eval-board")
    publish("run-summary")
    publish("event-log")
    return {"ok": True}


@app.post("/claude/run")
def claude_run():
    """Record a run summary snapshot — what the terminal saw on the last pass."""
    data = request.get_json(force=True, silent=True) or request.form
    label = data.get("label", "run")
    counts = db().execute(
        "SELECT SUM(status='pass') p, SUM(status='fail') f, SUM(status='needs-review') r FROM evals"
    ).fetchone()
    db().execute(
        "INSERT INTO runs (label, n_pass, n_fail, n_review, created_at) VALUES (?, ?, ?, ?, ?)",
        (label, counts["p"] or 0, counts["f"] or 0, counts["r"] or 0, now()),
    )
    db().commit()
    log_event("claude", f"Recorded run '{label}': "
                        f"{counts['p'] or 0} pass / {counts['f'] or 0} fail / {counts['r'] or 0} review.")
    publish("run-summary")
    publish("run-history")
    publish("event-log")
    return {"ok": True}


@app.get("/claude/feedback")
def claude_feedback():
    """Let the terminal read back what the human marked — closes the loop."""
    rows = db().execute(
        "SELECT id, name, status, human_note FROM evals "
        "WHERE human_note IS NOT NULL AND human_note != '' OR status != 'needs-review' "
        "ORDER BY id"
    ).fetchall()
    return {"feedback": [dict(r) for r in rows]}


# --------------------------------------------------------------------------
# SSE stream
# --------------------------------------------------------------------------
@app.get("/events")
def events():
    def stream():
        q: queue.Queue = queue.Queue(maxsize=64)
        with _subscribers_lock:
            _subscribers.add(q)
        try:
            yield "event: hello\ndata: connected\n\n"
            while True:
                try:
                    target = q.get(timeout=15)
                    # Named event — htmx's sse-swap / sse:<name> trigger keys off this.
                    yield f"event: {target}\ndata: stale\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"  # comment frame; keeps the connection open
        finally:
            with _subscribers_lock:
                _subscribers.discard(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    init_db()
    # threaded=True so the long-lived SSE stream doesn't block other requests.
    app.run(host="127.0.0.1", port=5050, debug=True, threaded=True)
