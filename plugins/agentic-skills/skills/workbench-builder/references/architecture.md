# Workbench Architecture — The Boring-on-Purpose Stack

This is the technical pattern reference for every workbench this skill builds. Read it before scaffolding `app.py` so the SSE plumbing, the partial routes, and the two-way loop all land the same way every time. "Boring" here means no toolchain — no npm, no bundler, no ORM, no framework-of-the-week. It does **not** mean no capability. The whole point is to stand up a live, two-way visual surface for a Claude Code session in one file the model can reshape mid-session.

Every claim below is grounded in the working implementations:

- Eval viewer: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/workbench/app.py`
- PR review room: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/app.py`
- Document review / redline: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/app.py`
- Terminal loop helper: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/scripts/review_loop.py`

---

## Contents

1. [The stack and why each piece](#1-the-stack-and-why-each-piece)
2. [Raw sqlite3, no ORM](#2-raw-sqlite3-no-orm)
3. [SSE as an invalidation signal](#3-sse-as-an-invalidation-signal)
4. [The publish() fan-out](#4-the-publish-fan-out)
5. [htmx-ext-sse wiring on the browser side](#5-htmx-ext-sse-wiring-on-the-browser-side)
6. [Partial routes: one query, two callers](#6-partial-routes-one-query-two-callers)
7. [The two-way loop: human path and terminal path](#7-the-two-way-loop-human-path-and-terminal-path)
8. [The human→agent channel that makes it a workbench](#8-the-humanagent-channel-that-makes-it-a-workbench)
9. [threaded=True and debug=True](#9-threadedtrue-and-debugtrue)
10. [The data model is the design](#10-the-data-model-is-the-design)

---

## 1. The stack and why each piece

| Piece               | Choice                                | Why                                                                                                                            |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web framework       | Flask                                 | Single-file, route-decorator, `render_template` for Jinja partials. No app factory ceremony needed for a localhost tool.       |
| Persistence         | raw `sqlite3`                         | One file, zero setup, shared by both surfaces. An ORM buys nothing here and hides the SQL that *is* the design.                |
| Templating          | Jinja partials                        | The same partial renders for the full page load and for every htmx swap — one source of truth for each region's HTML.          |
| Interactivity       | htmx                                  | Buttons and forms POST and swap server-rendered HTML fragments. No client state model, no JSON-to-DOM glue.                    |
| Live updates        | SSE via htmx-ext-sse                  | One long-lived stream carries tiny named "this region is stale" signals; htmx re-fetches the partial over a normal GET.        |
| Dependency delivery | PEP 723 inline deps + `uv run app.py` | The app declares `flask>=3.1,<4` in a script header. No venv, no `requirements.txt`, no install step the user has to remember. |

Both apps open with the same PEP 723 header, which is what makes `uv run app.py` self-contained:

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["flask>=3.1,<4"]
# ///
```

The CDN libraries (htmx, marked, highlight.js, mermaid, Chart.js, DOMPurify) come in as `<script>` tags with verified SRI hashes — no npm, no build step. See `references/rendering.md` for that layer; this file is the backend.

Bind to loopback only. `app.run(host="127.0.0.1", ...)` means no auth, no TLS, no deploy story to reason about — the surface exists for exactly one human at one terminal during one session, then gets thrown away with its `.db` file.

---

## 2. Raw sqlite3, no ORM

The schema is plain SQL in a module-level string, applied with `executescript` on startup. The eval viewer's three tables:

```python
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
...
"""
```

The connection lives on Flask's `g` (request-scoped), with `Row` factory so partials read columns by name, and it closes on teardown:

```python
def db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()
```

`PRAGMA foreign_keys = ON` matters once you have child tables. The PR room leans on it hard — `pr_files` and `concerns` both declare `REFERENCES prs(id) ON DELETE CASCADE`, so re-ingesting a PR can `DELETE FROM pr_files WHERE pr_id=?` and let the cascade clean up without orphan rows.

`init_db()` runs the schema (idempotent via `IF NOT EXISTS`), then seeds **realistic, interconnected** data only when the table is empty so reruns don't duplicate:

```python
def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    count = conn.execute("SELECT COUNT(*) FROM evals").fetchone()[0]
    if count == 0:
        ...  # seed
    conn.commit()
    conn.close()
```

Seed data is not filler. The PR room seeds five PRs that *deliberately overlap on hot files* (`app/models.py`, `api/routes.py`, `config.py`) so the collision-detection query has something to find on first load. The eval viewer seeds one case with a GFM note containing a fenced code block, a `mermaid` flowchart, and a table — so the markdown/mermaid/highlight pipeline renders something real the instant the page opens. A workbench that opens empty looks broken; seed it like a session already in progress.

Derived state is a query, not a column. The PR room never stores "which files collide" — it computes it on demand with a self-join and `HAVING n > 1`:

```python
def collisions():
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
    ...
```

Keeping derived facts as live queries means there's no cache to invalidate — a write to `pr_files` instantly changes what `collisions()` returns. That's the merge-order risk map, the unique multi-PR value of that recipe, and it falls out of the data model for free.

---

## 3. SSE as an invalidation signal

This is the load-bearing idea of the whole stack. **The SSE stream is not a data transport.** The server never pushes rendered HTML or JSON rows down the event stream. It pushes the *name of a region that just went stale*, and the browser re-fetches that region over a normal GET.

The stream endpoint emits **named events** with a throwaway payload:

```python
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
                    # Named event — htmx's sse:<name> trigger keys off this.
                    yield f"event: {target}\ndata: stale\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"  # comment frame; keeps the connection open
        finally:
            with _subscribers_lock:
                _subscribers.discard(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

Three details that each earn their place:

- **`event: <target>`** sets the SSE event *name*. The data is always the literal string `stale` — nobody reads it. The name is the whole message.
- **The 15-second timeout** turns into a `: keep-alive` comment frame. SSE comment frames (lines starting with `:`) keep the TCP connection and any intermediary proxies from killing an idle stream, without firing any client handler.
- **`X-Accel-Buffering: no` + `Cache-Control: no-cache`** stop buffering so events flush immediately.

Why invalidation instead of pushing data:

- The event is tiny and identical regardless of payload size — no serialization, no client-side render logic to keep in sync with the server templates.
- The re-fetch is a normal GET against a partial route, so the same Jinja partial that rendered on page load also renders the live update. One template, two triggers.
- No client state model. The browser never holds a copy of the data it has to reconcile; it just re-asks for the HTML when told the region is dirty.

---

## 4. The publish() fan-out

Behind `/events` is a set of subscriber queues — one per connected browser tab — guarded by a lock. `publish()` drops the stale-region name onto every queue:

```python
_subscribers: set[queue.Queue] = set()
_subscribers_lock = threading.Lock()


def publish(target: str) -> None:
    with _subscribers_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(target)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.discard(q)
```

The PR room's variant takes `*targets` so one write can invalidate several regions in a single call — `publish("fleet", "collisions", "overview")` after an ingest:

```python
def publish(*targets: str) -> None:
    with _subs_lock:
        dead = []
        for q in _subs:
            for t in targets:
                try:
                    q.put_nowait(t)
                except queue.Full:
                    dead.append(q)
        for q in dead:
            _subs.discard(q)
```

Notes:

- `put_nowait` + `maxsize=64`: a queue that fills means a wedged or vanished subscriber. Rather than block the writing request, it gets collected into `dead` and discarded. The stream's own `finally` block also discards on disconnect — belt and suspenders.
- A subscriber is added inside the `stream()` generator (so it lives exactly as long as the connection) and removed in `finally`. No registry of "who's connected" to maintain elsewhere.
- `publish()` is called from request handlers, which run on Flask's worker threads — hence the lock, and hence `threaded=True` (Section 9).

The pattern is intentionally minimal: in-process, in-memory, single-writer-many-reader. There is no message broker because there is exactly one Flask process and a handful of localhost tabs.

---

## 5. htmx-ext-sse wiring on the browser side

The browser opens **one** `EventSource` for the whole page, via the htmx SSE extension declared on `<body>`:

```html
<body hx-ext="sse" sse-connect="/events">
```

Each live region declares which named event re-fetches it, alongside the partial route that produces its HTML. From the eval viewer's `index.html`:

```html
<div id="eval-board"  hx-get="/partials/eval-board"  hx-trigger="load, sse:eval-board"></div>
<div id="run-summary" hx-get="/partials/run-summary" hx-trigger="load, sse:run-summary"></div>
<div id="event-log"   hx-get="/partials/event-log"   hx-trigger="load, sse:event-log"></div>
```

How a region resolves a live update:

1. `sse-connect="/events"` opens the single stream once on page load.
2. `hx-trigger="load, sse:eval-board"` fires the region's `hx-get` twice: once on `load` (initial fill), and again every time a `sse:eval-board` event arrives on the stream.
3. The named event maps one-to-one to a `publish("eval-board")` call on the server — server-side `event: eval-board` ⇄ client-side `sse:eval-board`.
4. The `hx-get` is a plain GET to the matching partial route; the server re-renders the Jinja partial and htmx swaps it into `#eval-board`.

So the contract is a naming convention enforced by hand: **the SSE event name, the `sse:` trigger, and the `publish()` argument must all be the same string**, and there's a `/partials/<region>` GET route that renders it. The PR room follows the identical pattern for `overview`, `fleet`, `collisions`, and `queue`.

Per-PR threads use a parameterized name — `publish(f"thread-{pid}")` on the server, `sse:thread-{{ pid }}` on the region — so only the open thread for that PR refreshes, not every thread.

Re-render the markdown/mermaid/highlight pipeline on `htmx:afterSwap` so SSE-swapped fragments get the same treatment as the initial render (covered in `references/rendering.md`).

---

## 6. Partial routes: one query, two callers

Each region has a render helper that runs one query and renders one partial. The full-page route and the htmx partial route both call it, so there is never a second code path that could render the same region differently:

```python
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


@app.get("/partials/eval-board")
def partial_board():
    return render_board(request.args.get("status"))
```

Granularity is a choice per action. Marking a status returns just the **one changed row** for an in-place swap (`hx-swap="outerHTML"` on `#eval-row-<id>`), while the SSE invalidation refreshes the whole board for every *other* tab:

```python
row = db().execute("SELECT * FROM evals WHERE id = ?", (eval_id,)).fetchone()
return render_template("partials/eval_row.html", e=row)
```

The acting tab gets the precise fragment back synchronously from its POST; observers get the coarser region refresh via SSE. Both are correct because both render from the same data.

---

## 7. The two-way loop: human path and terminal path

A dashboard is read-only. A **workbench** is written from both sides — the human in the browser and Claude in the terminal — against one shared SQLite file, and each side's writes show up live on the other. Both paths do the same three things: **write SQLite → log/derive → `publish()` SSE**. They differ only in transport and response type.

**Human path — htmx POST, returns HTML.** A button or form POSTs, the handler writes, publishes the affected regions, and returns the swapped fragment:

```python
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
    row = db().execute("SELECT * FROM evals WHERE id = ?", (eval_id,)).fetchone()
    return render_template("partials/eval_row.html", e=row)
```

The matching markup (from `partials/eval_row.html`):

```html
<button class="btn" hx-post="/evals/{{ e['id'] }}/status" hx-vals='{"status":"pass"}'
        hx-target="#eval-row-{{ e['id'] }}" hx-swap="outerHTML">pass</button>
```

**Terminal path — httpx/JSON POST, returns JSON.** The same writes, but the caller is a script (or Claude inline), so the handler accepts JSON and returns `{"ok": True}` instead of HTML — the terminal doesn't want a fragment, it wants an ack. The browser still updates live because the handler `publish()`es:

```python
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
```

`get_json(force=True, silent=True) or request.form` makes the endpoint forgiving — it accepts a JSON body from `httpx` or a form post from `curl --data`. The terminal helpers are PEP 723 inline-dep scripts run with `uv run`:

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
BASE = "http://127.0.0.1:5051"
httpx.post(f"{BASE}/claude/respond", json={"request_id": r["id"], "response": answer})
```

The key consequence: **the human marks a result in the browser and Claude reads it back from the terminal, or Claude records a result from the terminal and the human watches the board update with no reload.** That is the loop. An `events` log table written by both `log_event("human", ...)` and `log_event("claude", ...)` gives a shared activity feed so each side can see what the other did.

---

## 8. The human→agent channel that makes it a workbench

Writing from both sides is necessary but not sufficient. The thing that turns "two surfaces over one DB" into a genuine collaboration is a channel where **the human asks Claude to do something and Claude answers** — steering, not just status-sharing. The PR room implements this with a `requests` table and a three-endpoint protocol.

The table records the ask, its lifecycle, and the reply:

```python
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
```

The lifecycle is `queued → working → answered`, and each transition publishes SSE so the human watches the request move:

**1. Human asks** (htmx POST → insert `queued` → publish → return the thread fragment):

```python
@app.post("/pr/<int:pid>/ask")
def ask(pid: int):
    kind = request.form.get("kind", "ask")
    body = request.form.get("body", "").strip()
    if not body:
        body = {"investigate": "Investigate this PR in depth and report what you find.",
                "merge-check": "Is this PR safe to merge given the file collisions? What order?",
                ...}.get(kind, "")
    db().execute(
        "INSERT INTO requests (pr_id, kind, body, status, created_at) VALUES (?,?,?,'queued',?)",
        (pid, kind, body, now()))
    db().commit()
    publish("fleet", "queue")
    return render_thread(pid)
```

**2. Claude pulls the queue** (terminal GET → flip `queued → working` → publish so the human sees the spinner move):

```python
@app.get("/claude/queue")
def claude_queue():
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
```

Pulling the queue is the act of claiming the work — flipping to `working` and publishing means the human's board shows "Claude picked this up" without Claude having to say so. That feedback is what makes the channel feel alive rather than fire-and-forget.

**3. Claude responds** (terminal JSON POST → fill `response`, flip to `answered` → publish so the answer renders in the thread):

```python
@app.post("/claude/respond")
def claude_respond():
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
```

The terminal half is the `review_loop.py` helper: `GET /claude/queue`, do the work — read the diff, trace the import, draft the comment — then `POST /claude/respond` per request. In a real session Claude runs this logic inline rather than the demo's canned replies, but the protocol is identical.

The eval viewer has a lighter version of the same idea: `GET /claude/feedback` lets the terminal read back which cases the human marked or annotated, closing the loop the other direction. Whatever the recipe, **build at least one endpoint where the human's input flows to the agent and one where the agent's output flows back** — otherwise you've built a dashboard, not a workbench.

---

## 9. threaded=True and debug=True

```python
if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5050, debug=True, threaded=True)
```

- **`threaded=True` is mandatory, not optional.** The `/events` handler is an infinite generator — it never returns while the tab is open. On the single-threaded dev server it would occupy the one worker and block every other request, including the partial GETs the SSE events are supposed to trigger. With threads, each long-lived stream sits on its own worker while POSTs and partial fetches run on others. This is also why `publish()` needs its lock — handlers on different threads touch `_subscribers` concurrently.
- **`debug=True`** gives the reloader, so the model can edit `app.py` mid-session and the server restarts itself — central to "Claude reshapes the UI while you watch." It's safe precisely because the surface is loopback-only and disposable.
- **Pick a fixed, memorable port per recipe** (eval viewer `5050`, PR room `5051`, doc-review `5057`) so the terminal helpers can hardcode `BASE` and the human can bookmark the tab.

---

## 10. The data model is the design

Every recipe in this skill — eval viewer, PR review room, document review / redline, agent trace replay, refactor cockpit, incident timeline — is *the same stack over a different schema and layout*. The stack in this file does not change between recipes. What changes is:

- The **tables** and their relationships (the eval viewer's flat `evals`; the PR room's `prs → pr_files / concerns / requests` graph).
- The **derived queries** that compute the recipe's unique value (collision detection is what makes the PR room worth more than five separate diff views).
- The **regions** and their named events (`eval-board` vs `fleet`/`collisions`/`overview`).
- The **two-way endpoints** — what the human hands the agent, what the agent hands back.

So Phase 0 of the build — naming the shared state — is the design work. Once the schema and the regions are named, the rest is this pattern, filled in: a `publish()` per write, a `/partials/<region>` per region with the matching `hx-trigger="sse:<region>"`, a render helper per region shared by full-page and partial, and a pair of two-way endpoints. Get the data model right and the workbench mostly writes itself.
