# /// script
# requires-python = ">=3.12"
# dependencies = ["flask>=3.1,<4"]
# ///
"""Document review workbench — a disposable localhost surface for redlining any
HTML document, with a two-way human <-> agent loop.

Two-way loop over one SQLite file:
  - Human selects text in the browser, leaves a comment or a redline (suggested
    replacement) -> htmx POST -> SQLite -> publish() SSE invalidation.
  - The agent (terminal) reads open annotations via httpx/JSON, acts on them in
    the real source doc, then resolves each (status + agent_note) -> publish()
    the same SSE, so the browser updates live with the resolution.

The shared state is ONE table: `annotations`. Each row is a human note anchored
to a character range inside one block of the rendered doc. The doc is a fixed
snapshot served read-only at /partials/document, so block-relative offsets are a
stable anchor for the life of a review.

THE LOAD-BEARING TECHNIQUE — char-perfect anchoring. A selection is stored as
(block_id, start_off, end_off) into the block's PLAIN TEXT. For the painted
<mark> to land on exactly the selected characters, the server's stored text and
the browser's textContent must be byte-identical. Two rules guarantee that:
  1. `_block_text` normalizes with html.unescape (ALL entities, not a subset) +
     whitespace-collapse, so &mdash;/&rarr;/&#39; etc. become one char on both
     sides and source-HTML newlines never create phantom offsets.
  2. The document partial renders that exact string with a FULLY whitespace-
     trimmed Jinja macro ({%- -%}, {{- -}}), so no indentation or newline leaks
     into the block and shifts every downstream offset.
A single stray space in the macro silently breaks alignment — this is the bug
to watch when bending the recipe.

Run:
    REVIEW_DOC=/path/to/doc.html uv run app.py     # http://127.0.0.1:5057
    uv run app.py                                  # falls back to sample-doc.html
"""

import html as html_lib
import os
import queue
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, g, jsonify, render_template, request

HERE = Path(__file__).parent
DB_PATH = HERE / "doc_review.db"
# The document under review. Read once at startup into stable, addressable
# blocks. Point it at any HTML file via the REVIEW_DOC env var; falls back to
# the sample doc shipped beside this app so the recipe runs with zero args.
MEMO_PATH = Path(os.environ.get("REVIEW_DOC", str(HERE / "sample-doc.html")))

app = Flask(__name__)
PORT = int(os.environ.get("PORT", "5057"))


# --------------------------------------------------------------------------
# SSE fan-out — publish(*regions) drops a tiny NAMED event on every connected
# browser's queue; the browser re-fetches the matching partial over a GET.
# --------------------------------------------------------------------------
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


# --------------------------------------------------------------------------
# The memo, parsed into addressable blocks ONCE at import. Each reviewable
# block (h1/h2/h3/p/li/td/blockquote/caption) gets a stable integer id. The
# browser renders these with data-block="<id>"; a selection inside one block is
# anchored as (block_id, start_offset, end_offset) into that block's plain text.
# A fixed snapshot means those offsets never drift during a review session.
# --------------------------------------------------------------------------
BLOCK_TAGS = ("h1", "h2", "h3", "p", "li", "td", "th", "blockquote", "caption", "cite")


def _block_text(inner: str) -> str:
    """The block's plain text, normalized so it is BYTE-IDENTICAL to what the
    browser's textContent will read back. Two rules make alignment exact:
      1. html.unescape handles ALL entities (not a hardcoded subset), so e.g.
         &mdash; / &rarr; / &#39; collapse to one char on the server exactly as
         the browser decodes them to one char.
      2. collapse every run of whitespace to a single space, so source-HTML
         newlines and indentation never create phantom offset drift.
    The document partial renders THIS string (Jinja re-escapes it), so the
    browser textContent of the rendered block == this string, char for char.
    Selection offsets then index the identical string on both sides."""
    no_tags = re.sub(r"<[^>]+>", "", inner)
    unescaped = html_lib.unescape(no_tags)
    return re.sub(r"\s+", " ", unescaped).strip()


def parse_memo() -> list[dict]:
    """Return ordered blocks: {id, tag, text}. Body-only, in document order, one
    entry per reviewable element. `text` is the normalized plain text that both
    the server (offset storage) and the browser (textContent) agree on exactly."""
    raw = MEMO_PATH.read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*)</body>", raw, re.S)
    body_html = body.group(1) if body else raw
    blocks: list[dict] = []
    pat = re.compile(r"<(" + "|".join(BLOCK_TAGS) + r")\b[^>]*>(.*?)</\1>", re.S | re.I)
    for i, m in enumerate(pat.finditer(body_html)):
        tag = m.group(1).lower()
        inner = m.group(2).strip()
        text = _block_text(inner)
        if not text:
            continue
        blocks.append({"id": i, "tag": tag, "text": text})
    # re-id sequentially after filtering so ids are dense
    for n, b in enumerate(blocks):
        b["id"] = n
    return blocks


MEMO_BLOCKS = parse_memo()
MEMO_TITLE = next((b["text"] for b in MEMO_BLOCKS if b["tag"] == "h1"), "Document review")


# --------------------------------------------------------------------------
# Database — raw sqlite3, no ORM. One table is the whole data model.
# --------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS annotations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'comment',  -- comment | redline
    block_id    INTEGER NOT NULL,                 -- which memo block
    start_off   INTEGER NOT NULL,                 -- char offset into block text
    end_off     INTEGER NOT NULL,
    quote       TEXT NOT NULL,                    -- the selected text (display + re-anchor)
    section     TEXT,                             -- nearest heading, for the agent's context
    comment     TEXT NOT NULL DEFAULT '',         -- the human's note
    suggestion  TEXT,                             -- redline: proposed replacement for `quote`
    status      TEXT NOT NULL DEFAULT 'open',     -- open | addressed | wontfix
    agent_note  TEXT,                             -- the agent's reply from the terminal
    created_at  TEXT NOT NULL,
    resolved_at TEXT
);
"""


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
def _close(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    # Set WAL once, at startup, on this single connection. WAL is a persistent
    # property of the database file, so it does NOT need to be re-set on every
    # per-request connection (doing that raced under concurrent first-load
    # requests and raised "database is locked").
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def _section_for_block(block_id: int) -> str:
    """Nearest preceding heading text — gives the agent a human-readable locator."""
    section = ""
    for b in MEMO_BLOCKS:
        if b["id"] > block_id:
            break
        if b["tag"] in ("h1", "h2", "h3"):
            section = b["text"]
    return section


# --------------------------------------------------------------------------
# Render helpers — one per live region.
# --------------------------------------------------------------------------
def render_document():
    anns = db().execute(
        "SELECT * FROM annotations ORDER BY block_id, start_off"
    ).fetchall()
    by_block: dict[int, list] = {}
    for a in anns:
        by_block.setdefault(a["block_id"], []).append(a)
    return render_template("partials/document.html", blocks=MEMO_BLOCKS, by_block=by_block)


def render_annotations():
    anns = db().execute(
        "SELECT * FROM annotations "
        "ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, block_id, start_off"
    ).fetchall()
    counts = {
        "open": sum(1 for a in anns if a["status"] == "open"),
        "total": len(anns),
        "redline": sum(1 for a in anns if a["kind"] == "redline"),
    }
    return render_template("partials/annotations.html", anns=anns, counts=counts)


# --------------------------------------------------------------------------
# Pages & partials.
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html", title=MEMO_TITLE)


@app.get("/partials/document")
def p_document():
    return render_document()


@app.get("/partials/annotations")
def p_annotations():
    return render_annotations()


# --------------------------------------------------------------------------
# Human actions (htmx). Each writes SQLite, publishes the regions it touched.
# --------------------------------------------------------------------------
@app.post("/annotate")
def annotate():
    f = request.form
    block_id = int(f["block_id"])
    kind = f.get("kind", "comment")
    db().execute(
        "INSERT INTO annotations "
        "(kind, block_id, start_off, end_off, quote, section, comment, suggestion, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?, 'open', ?)",
        (
            kind,
            block_id,
            int(f["start_off"]),
            int(f["end_off"]),
            f.get("quote", ""),
            _section_for_block(block_id),
            f.get("comment", "").strip(),
            (f.get("suggestion", "").strip() or None) if kind == "redline" else None,
            now(),
        ),
    )
    db().commit()
    publish("document", "annotations")
    return render_annotations()


@app.post("/annotations/<int:aid>/delete")
def delete_annotation(aid: int):
    db().execute("DELETE FROM annotations WHERE id = ?", (aid,))
    db().commit()
    publish("document", "annotations")
    return render_annotations()


# --------------------------------------------------------------------------
# Terminal-side (the agent's hands). JSON in/out — read open annotations, resolve.
# --------------------------------------------------------------------------
@app.get("/api/annotations")
def api_annotations():
    status = request.args.get("status")  # e.g. ?status=open
    if status:
        rows = db().execute(
            "SELECT * FROM annotations WHERE status = ? ORDER BY block_id, start_off",
            (status,),
        ).fetchall()
    else:
        rows = db().execute(
            "SELECT * FROM annotations ORDER BY block_id, start_off"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/annotations/<int:aid>/resolve")
def api_resolve(aid: int):
    d = request.get_json(force=True)
    status = d.get("status", "addressed")  # addressed | wontfix | open
    db().execute(
        "UPDATE annotations SET status = ?, agent_note = ?, resolved_at = ? WHERE id = ?",
        (status, d.get("agent_note"), now() if status != "open" else None, aid),
    )
    db().commit()
    publish("document", "annotations")
    return {"ok": True, "id": aid, "status": status}


# --------------------------------------------------------------------------
# SSE stream — one EventSource per browser; NAMED invalidation events only.
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
                    yield f"event: {target}\ndata: stale\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
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
    app.run(host="127.0.0.1", port=PORT, debug=True, threaded=True)
