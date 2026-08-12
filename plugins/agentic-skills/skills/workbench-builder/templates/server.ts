/**
 * Workbench backend — Bun.serve + bun:sqlite + SSE invalidation.
 *
 * One file: schema, seed, SSE fan-out, region routes, mutation routes, and
 * the human→agent request queue. 127.0.0.1 only. No auth, no deploy, no
 * bundler config. Run: `bun --hot server.ts` (HMR while you reshape the UI).
 *
 * Rename the placeholder `items` table to your domain (evals, prs, steps,
 * rows, variants, decisions...). Keep `events` (the append-only activity log)
 * and `requests` (the human→agent channel) — every workbench wants both.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5050;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "workbench.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

// ---------------------------------------------------------------------------
// Database. bun:sqlite is synchronous and this server is a single process, so
// ONE module-level connection serves every request — no pooling, no per-request
// open/close. WAL lets the terminal helper write while the browser reads.
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    -- Split ownership: the human writes status/human_note from the browser,
    -- the agent writes result/agent_note from the terminal. Neither side
    -- clobbers the other's columns.
    status     TEXT NOT NULL DEFAULT 'open',   -- open | accepted | rejected
    human_note TEXT NOT NULL DEFAULT '',
    result     TEXT NOT NULL DEFAULT '',
    agent_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,                  -- ingest | status | note | ...
    detail     TEXT NOT NULL DEFAULT '',
    item_id    INTEGER,
    -- Who acted. The wake-on-work digest reports only human events, so the
    -- agent's own writes never wake it.
    actor      TEXT NOT NULL DEFAULT 'human',  -- human | agent
    created_at TEXT NOT NULL
  );

  -- KEEP this table in every workbench: it is the human→agent channel.
  -- queued → working (claimed by /claude/queue) → answered (/claude/respond).
  CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL DEFAULT 'question',
    body       TEXT NOT NULL,
    item_id    INTEGER,
    status     TEXT NOT NULL DEFAULT 'queued', -- queued | working | answered
    response   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    answered_at TEXT
  );

  -- The agent's read cursor into events. Everything at or below last_event_id
  -- is processed; /claude/digest reports only what lies past it, so a wake-up
  -- never re-processes a batch (exactly-once per event).
  CREATE TABLE IF NOT EXISTS agent_watermark (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_event_id INTEGER NOT NULL DEFAULT 0
  );
`);

const now = () => new Date().toISOString();

// A session .db can predate a column (CREATE TABLE IF NOT EXISTS never alters).
// Ensure additive columns exist so a --hot restart on an old file doesn't 500.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("events", "actor", "actor TEXT NOT NULL DEFAULT 'human'");

// Seed like a session in progress, not a cold start — the human should open
// the page and immediately see the shape of the work.
const empty = db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number };
if (empty.n === 0) {
  const ins = db.query(
    "INSERT INTO items (title, body, status, created_at) VALUES (?, ?, ?, ?)",
  );
  ins.run("First item", "Replace the `items` schema with your domain.", "open", now());
  ins.run("Second item", "Seeded so the board renders rows on first boot.", "accepted", now());
  db.query("INSERT INTO events (kind, detail, actor, created_at) VALUES (?, ?, 'agent', ?)").run(
    "ingest",
    "seeded 2 items",
    now(),
  );
}

// First boot of the watermark starts at the current head of the event log:
// history before the watcher existed is already-handled work, not a pending batch.
{
  const wm = db.query("SELECT COUNT(*) AS n FROM agent_watermark").get() as { n: number };
  if (wm.n === 0) {
    const head = db.query("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number };
    db.query("INSERT INTO agent_watermark (id, last_event_id) VALUES (1, ?)").run(head.m);
  }
}

// ---------------------------------------------------------------------------
// SSE fan-out. Events are INVALIDATION SIGNALS, not data transport: a state
// change emits `event: <region>\ndata: stale`, and every open page refetches
// that region's JSON. The region name must be identical in three places:
// publish("<region>") here, the SSE event name on the wire, and
// useRegion("<region>") in the browser. Drift renders as a silently frozen
// panel.
// ---------------------------------------------------------------------------
type Subscriber = { write: (chunk: string) => void };
const subscribers = new Set<Subscriber>();

function publish(...regions: string[]) {
  for (const region of regions) {
    const frame = `event: ${region}\ndata: stale\n\n`;
    for (const sub of subscribers) {
      // A slow/broken pipe throws; drop that subscriber, never the frame.
      try {
        sub.write(frame);
      } catch {
        subscribers.delete(sub);
      }
    }
  }
}

function sseResponse(req: Request): Response {
  let sub: Subscriber;
  let keepAlive: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      sub = { write: (chunk) => controller.enqueue(encoder.encode(chunk)) };
      subscribers.add(sub);
      // retry tells the browser how fast to reconnect; hello confirms liveness
      // so the UI can light its LED before any real event arrives.
      sub.write("retry: 1000\n\nevent: hello\ndata: connected\n\n");
      // Comment frames keep intermediaries from timing out the idle stream.
      keepAlive = setInterval(() => {
        try {
          sub.write(": keep-alive\n\n");
        } catch {
          /* cancel() handles cleanup */
        }
      }, 15_000);
    },
    cancel() {
      clearInterval(keepAlive);
      subscribers.delete(sub);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Region queries — one function per live region, one JSON endpoint each.
// The browser's useRegion(name) fetches /api/regions/<name>; publish(name)
// tells every open page to refetch it. One query, every caller.
// ---------------------------------------------------------------------------
const regions: Record<string, (url: URL) => unknown> = {
  board: () =>
    db.query("SELECT * FROM items ORDER BY id DESC").all(),
  summary: () =>
    db
      .query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'open')     AS open,
                SUM(status = 'accepted') AS accepted,
                SUM(status = 'rejected') AS rejected
         FROM items`,
      )
      .get(),
  "event-log": () =>
    db.query("SELECT * FROM events ORDER BY id DESC LIMIT 25").all(),
  queue: () =>
    db.query("SELECT * FROM requests ORDER BY id DESC LIMIT 20").all(),
};

// ---------------------------------------------------------------------------
// Routes. Browser and terminal hit the SAME JSON endpoints — there is one
// mutation path, not an HTML one and a JSON one. Mutations return {ok: true}
// and publish(); the SSE round-trip re-renders every open page.
// ---------------------------------------------------------------------------
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  routes: {
    "/": homepage,

    "/events": (req) => {
      // Never let Bun idle-timeout the SSE stream.
      server.timeout(req, 0);
      return sseResponse(req);
    },

    "/api/regions/:name": (req) => {
      const query = regions[req.params.name];
      if (!query) return Response.json({ error: "unknown region" }, { status: 404 });
      return Response.json(query(new URL(req.url)));
    },

    // Human action from the browser: set an item's status + optional note.
    "/api/items/:id/status": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { status, human_note = "" } = (await req.json()) as {
          status: string;
          human_note?: string;
        };
        db.query("UPDATE items SET status = ?, human_note = ? WHERE id = ?").run(
          status,
          human_note,
          id,
        );
        db.query(
          "INSERT INTO events (kind, detail, item_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("status", `#${id} → ${status}`, id, now());
        publish("board", "summary", "event-log");
        return Response.json({ ok: true });
      },
    },

    // Terminal action: the agent ingests or updates an item.
    "/api/items/ingest": {
      POST: async (req) => {
        const { title, body = "", result = "", agent_note = "" } =
          (await req.json()) as {
            title: string;
            body?: string;
            result?: string;
            agent_note?: string;
          };
        const r = db
          .query(
            "INSERT INTO items (title, body, result, agent_note, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(title, body, result, agent_note, now());
        db.query(
          "INSERT INTO events (kind, detail, item_id, actor, created_at) VALUES (?, ?, ?, 'agent', ?)",
        ).run("ingest", title, Number(r.lastInsertRowid), now());
        publish("board", "summary", "event-log");
        return Response.json({ ok: true, id: Number(r.lastInsertRowid) });
      },
    },

    // Human → agent: ask a question / request work from the browser.
    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "question", item_id = null } = (await req.json()) as {
          body: string;
          kind?: string;
          item_id?: number | null;
        };
        db.query(
          "INSERT INTO requests (kind, body, item_id, created_at) VALUES (?, ?, ?, ?)",
        ).run(kind, body, item_id, now());
        publish("queue");
        return Response.json({ ok: true });
      },
    },

    // The agent's work order, read by wait-for-work.ts at wake-up: human
    // events past the watermark plus any queued requests, so the agent starts
    // with the batch already framed. Agent events are excluded — the agent's
    // own writes must not wake it.
    "/claude/digest": () => {
      const { last_event_id } = db
        .query("SELECT last_event_id FROM agent_watermark WHERE id = 1")
        .get() as { last_event_id: number };
      const head = db.query("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as {
        m: number;
      };
      return Response.json({
        watermark: last_event_id,
        latest_event_id: head.m,
        events: db
          .query("SELECT * FROM events WHERE id > ? AND actor = 'human' ORDER BY id")
          .all(last_event_id),
        queued_requests: db
          .query("SELECT * FROM requests WHERE status = 'queued' ORDER BY id")
          .all(),
      });
    },

    // Agent advances its cursor after processing a batch. Skipping this makes
    // the next wake-up replay the same events.
    "/claude/watermark": {
      POST: async (req) => {
        const { last_event_id } = (await req.json()) as { last_event_id: number };
        if (!Number.isFinite(Number(last_event_id))) {
          return Response.json({ error: "last_event_id must be a number" }, { status: 400 });
        }
        db.query("UPDATE agent_watermark SET last_event_id = ? WHERE id = 1").run(
          Number(last_event_id),
        );
        return Response.json({ ok: true });
      },
    },

    // Agent pulls its work. Pulling IS claiming: queued rows flip to working,
    // so the human sees the spinner move the moment the agent picks up.
    "/claude/queue": (req) => {
      const rows = db
        .query("SELECT * FROM requests WHERE status = 'queued' ORDER BY id")
        .all() as Array<{ id: number }>;
      if (rows.length > 0) {
        db.query(
          `UPDATE requests SET status = 'working'
           WHERE id IN (${rows.map((r) => r.id).join(",")})`,
        ).run();
        publish("queue");
      }
      return Response.json({ requests: rows });
    },

    // Agent answers a claimed request.
    "/claude/respond": {
      POST: async (req) => {
        const { request_id, response } = (await req.json()) as {
          request_id: number;
          response: string;
        };
        db.query(
          "UPDATE requests SET status = 'answered', response = ?, answered_at = ? WHERE id = ?",
        ).run(response, now(), request_id);
        db.query(
          "INSERT INTO events (kind, detail, actor, created_at) VALUES (?, ?, 'agent', ?)",
        ).run("respond", `request #${request_id} answered`, now());
        publish("queue", "event-log");
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`workbench up at ${server.url} — disposable, 127.0.0.1, this session only — state in ${DB_PATH}`);
