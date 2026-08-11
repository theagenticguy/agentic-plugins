/**
 * Grid workbench — the reference workbench for spreadsheet-shaped triage.
 *
 * One table of dirty rows. The human clicks a cell to edit it inline and sets a
 * per-row decision from the browser; the agent ingests rows and patches cells
 * from the terminal. EVERY cell edit from either side lands in `cells_log` with
 * an `actor`, so each actor watches the other work live. Column stats are SQL
 * aggregates, never client-side math.
 *
 * Bun.serve + bun:sqlite + SSE invalidation. 127.0.0.1 only.
 * Run: `bun --hot server.ts`
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5062;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "grid-workbench.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

// One module-level connection: bun:sqlite is synchronous and this is a single
// process. WAL lets the terminal scripts write while the browser reads.
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS rows (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Editable data columns. Both actors write these; cells_log records who.
    name       TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT '',
    amount     REAL,
    date       TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    -- Human-owned triage verdict (the browser writes it, the agent reads it).
    decision   TEXT NOT NULL DEFAULT 'pending', -- pending | keep | fix | drop
    updated_at TEXT NOT NULL
  );

  -- The audit trail that makes the two-way loop legible: one row per cell edit,
  -- attributed to human or agent. ON DELETE CASCADE needs foreign_keys = ON.
  CREATE TABLE IF NOT EXISTS cells_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id     INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    column     TEXT NOT NULL,
    old_value  TEXT NOT NULL DEFAULT '',
    new_value  TEXT NOT NULL DEFAULT '',
    actor      TEXT NOT NULL,                   -- human | agent
    created_at TEXT NOT NULL
  );

  -- The human→agent channel: queued → working (claimed by /claude/queue) →
  -- answered (/claude/respond).
  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'question',
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued', -- queued | working | answered
    response    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    answered_at TEXT
  );
`);

const now = () => new Date().toISOString();

/** Columns a cell edit may target. Anything else is a 400 — an unvalidated
 *  column name would be a SQL-injection hole in the UPDATE below. */
const EDITABLE = new Set(["name", "category", "amount", "date", "notes"]);
const DECISIONS = new Set(["pending", "keep", "fix", "drop"]);

// Seed like a triage session already in progress: real-looking expense rows
// with planted dirt so every render path is exercised on first boot — an empty
// category (nulls stat), an out-of-range amount (max stat + outlier badge), a
// malformed date (dirty badge), one row already decided, one already touched by
// the agent.
const seeded = db.query("SELECT COUNT(*) AS n FROM rows").get() as { n: number };
if (seeded.n === 0) {
  const ins = db.query(
    `INSERT INTO rows (name, category, amount, date, notes, decision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const seed: Array<[string, string, number | null, string, string, string]> = [
    ["Flight SEA→IAD", "travel", 412.5, "2026-07-02", "re:Invent prep trip", "keep"],
    ["Hotel — Arlington", "travel", 289.0, "2026-07-03", "", "pending"],
    ["Team lunch (6)", "meals", 148.22, "2026-07-06", "customer workshop", "pending"],
    ["Airport parking", "travel", 64.0, "07/09/2026", "date arrived US-format", "fix"],
    ["Datadog seat", "software", 31.0, "2026-07-10", "", "pending"],
    ["Conference badge", "", 1250.0, "2026-07-11", "category never filled in", "pending"],
    ["Taxi to venue", "travel", 27.4, "2026-07-11", "", "pending"],
    ["Whiteboard markers", "supplies", 12.99, "2026-07-12", "", "keep"],
    ["Client dinner", "meals", 96_400.0, "2026-07-14", "amount looks like cents", "pending"],
    ["Wifi day pass", "travel", 8.0, "2026-07-15", "", "pending"],
    ["Notion seat", "software", 10.0, "", "date missing entirely", "pending"],
    ["Poster printing", "supplies", null, "2026-07-18", "amount never captured", "pending"],
  ];
  for (const row of seed) ins.run(...row, now());
  db.query(
    `INSERT INTO cells_log (row_id, column, old_value, new_value, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(4, "notes", "", "date arrived US-format", "agent", now());
}

// --- SSE fan-out: invalidation signals only, never data transport ------------
type Subscriber = { write: (chunk: string) => void };
const subscribers = new Set<Subscriber>();

function publish(...regions: string[]) {
  for (const region of regions) {
    const frame = `event: ${region}\ndata: stale\n\n`;
    for (const sub of subscribers) {
      // A broken pipe throws; drop that subscriber, never the frame.
      try {
        sub.write(frame);
      } catch {
        subscribers.delete(sub);
      }
    }
  }
}

function sseResponse(): Response {
  let sub: Subscriber;
  let keepAlive: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      sub = { write: (chunk) => controller.enqueue(encoder.encode(chunk)) };
      subscribers.add(sub);
      sub.write("retry: 1000\n\nevent: hello\ndata: connected\n\n");
      keepAlive = setInterval(() => {
        try {
          sub.write(": keep-alive\n\n");
        } catch {
          /* cancel() cleans up */
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

/**
 * Per-column stats, computed in SQL. One UNION ALL branch per column so the
 * shape is uniform: text columns report distinct + empties, numeric columns
 * also report min/max/avg. The browser renders these numbers; it never derives
 * them, so a filtered or paginated grid can't disagree with its own stats.
 */
function columnStats() {
  return db
    .query(
      `SELECT 'name' AS column, 'text' AS kind, COUNT(*) AS n,
              SUM(name = '') AS empties, COUNT(DISTINCT name) AS distinct_n,
              NULL AS min_v, NULL AS max_v, NULL AS avg_v FROM rows
       UNION ALL
       SELECT 'category', 'text', COUNT(*),
              SUM(category = ''), COUNT(DISTINCT NULLIF(category, '')),
              NULL, NULL, NULL FROM rows
       UNION ALL
       SELECT 'amount', 'number', COUNT(*),
              SUM(amount IS NULL), COUNT(DISTINCT amount),
              MIN(amount), MAX(amount), ROUND(AVG(amount), 2) FROM rows
       UNION ALL
       SELECT 'date', 'text', COUNT(*),
              SUM(date = ''), COUNT(DISTINCT NULLIF(date, '')),
              NULL, NULL, NULL FROM rows
       UNION ALL
       SELECT 'notes', 'text', COUNT(*),
              SUM(notes = ''), COUNT(DISTINCT NULLIF(notes, '')),
              NULL, NULL, NULL FROM rows`,
    )
    .all();
}

// --- Region queries: one function per live panel -----------------------------
const regions: Record<string, (url: URL) => unknown> = {
  grid: () => db.query("SELECT * FROM rows ORDER BY id").all(),
  "column-stats": () => columnStats(),
  "edit-log": () =>
    db
      .query(
        `SELECT c.id, c.row_id, c.column, c.old_value, c.new_value, c.actor,
                c.created_at, r.name AS row_name
         FROM cells_log c LEFT JOIN rows r ON r.id = c.row_id
         ORDER BY c.id DESC LIMIT 25`,
      )
      .all(),
  queue: () => db.query("SELECT * FROM requests ORDER BY id DESC LIMIT 20").all(),
};

/** A rejected write, carrying the status code the route should return. */
type WriteError = { error: string; status: 400 | 404 };

/**
 * The single cell-write path. Both actors funnel through it, so the audit trail
 * cannot be bypassed and `updated_at` cannot drift: the log entry and the UPDATE
 * are one transaction.
 *
 * Returns null on success, or the rejection plus its status code — a bad column
 * or unparseable amount is the caller's fault (400); a missing row is a
 * different failure the caller must be able to tell apart (404).
 */
function writeCell(
  rowId: number,
  column: string,
  value: string,
  actor: "human" | "agent",
): WriteError | null {
  if (!EDITABLE.has(column)) {
    return { error: `column '${column}' is not editable`, status: 400 };
  }
  const row = db.query("SELECT * FROM rows WHERE id = ?").get(rowId) as
    | Record<string, unknown>
    | null;
  if (row === null) return { error: `row ${rowId} not found`, status: 404 };

  // `amount` is the one REAL column: an unparseable number would silently
  // become 0.0 through SQLite's type coercion, so reject it loudly instead.
  let stored: string | number | null = value;
  if (column === "amount") {
    if (value.trim() === "") {
      stored = null;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n)) return { error: `amount '${value}' is not a number`, status: 400 };
      stored = n;
    }
  }

  const old = row[column];
  db.transaction(() => {
    db.query(`UPDATE rows SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
      stored,
      now(),
      rowId,
    );
    db.query(
      `INSERT INTO cells_log (row_id, column, old_value, new_value, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(rowId, column, old === null ? "" : String(old), value, actor, now());
  })();
  return null;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  routes: {
    "/": homepage,

    "/events": (req) => {
      // Without this Bun idle-times-out the stream and the page reconnect-storms.
      server.timeout(req, 0);
      return sseResponse();
    },

    "/api/regions/:name": (req) => {
      const query = regions[req.params.name];
      if (!query) return Response.json({ error: "unknown region" }, { status: 404 });
      return Response.json(query(new URL(req.url)));
    },

    // Human cell edit from the browser (click → type → Enter/blur).
    "/api/rows/:id/cell": {
      POST: async (req) => {
        const { column, value } = (await req.json()) as { column: string; value: string };
        const err = writeCell(Number(req.params.id), column, String(value ?? ""), "human");
        if (err !== null) return Response.json({ error: err.error }, { status: err.status });
        publish("grid", "column-stats", "edit-log");
        return Response.json({ ok: true });
      },
    },

    // Human triage verdict. Not a cell edit — it never enters cells_log, so the
    // audit trail stays a record of DATA changes only.
    "/api/rows/:id/decision": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { decision } = (await req.json()) as { decision: string };
        if (!DECISIONS.has(decision)) {
          return Response.json({ error: `unknown decision '${decision}'` }, { status: 400 });
        }
        const r = db
          .query("UPDATE rows SET decision = ?, updated_at = ? WHERE id = ?")
          .run(decision, now(), id);
        if (r.changes === 0) {
          return Response.json({ error: `row ${id} not found` }, { status: 404 });
        }
        publish("grid");
        return Response.json({ ok: true });
      },
    },

    // Agent cell patch from the terminal — same writeCell path, actor 'agent'.
    "/claude/patch-cell": {
      POST: async (req) => {
        const { row_id, column, value } = (await req.json()) as {
          row_id: number;
          column: string;
          value: string;
        };
        const err = writeCell(Number(row_id), column, String(value ?? ""), "agent");
        if (err !== null) return Response.json({ error: err.error }, { status: err.status });
        publish("grid", "column-stats", "edit-log");
        return Response.json({ ok: true });
      },
    },

    // Agent bulk ingest. Each new row logs one cells_log entry per non-empty
    // cell, so an ingest is visible in the edit log as agent work.
    "/claude/ingest-rows": {
      POST: async (req) => {
        const { rows: incoming } = (await req.json()) as {
          rows: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(incoming)) {
          return Response.json({ error: "rows must be an array" }, { status: 400 });
        }
        const ids: number[] = [];
        db.transaction(() => {
          const ins = db.query(
            `INSERT INTO rows (name, category, amount, date, notes, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          const log = db.query(
            `INSERT INTO cells_log (row_id, column, old_value, new_value, actor, created_at)
             VALUES (?, ?, '', ?, 'agent', ?)`,
          );
          for (const raw of incoming) {
            const amount =
              raw.amount === null || raw.amount === undefined || raw.amount === ""
                ? null
                : Number(raw.amount);
            const r = ins.run(
              String(raw.name ?? ""),
              String(raw.category ?? ""),
              Number.isFinite(amount as number) ? (amount as number) : null,
              String(raw.date ?? ""),
              String(raw.notes ?? ""),
              now(),
            );
            const id = Number(r.lastInsertRowid);
            ids.push(id);
            for (const column of EDITABLE) {
              const v = raw[column];
              if (v !== undefined && v !== null && String(v) !== "") {
                log.run(id, column, String(v), now());
              }
            }
          }
        })();
        publish("grid", "column-stats", "edit-log");
        return Response.json({ ok: true, ids });
      },
    },

    // Agent reads back the human's triage verdicts — the return leg of the loop.
    "/claude/decisions": () =>
      Response.json(
        db
          .query(
            `SELECT id, name, category, amount, date, decision, updated_at
             FROM rows WHERE decision != 'pending' ORDER BY id`,
          )
          .all(),
      ),

    // Human → agent: ask a question from the browser.
    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "question" } = (await req.json()) as {
          body: string;
          kind?: string;
        };
        if (typeof body !== "string" || body.trim() === "") {
          return Response.json({ error: "body is required" }, { status: 400 });
        }
        db.query("INSERT INTO requests (kind, body, created_at) VALUES (?, ?, ?)").run(
          kind,
          body.trim(),
          now(),
        );
        publish("queue");
        return Response.json({ ok: true });
      },
    },

    // Agent pulls its work. Pulling IS claiming: queued → working, so the badge
    // moves in the browser the moment the agent picks up.
    "/claude/queue": () => {
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

    "/claude/respond": {
      POST: async (req) => {
        const { request_id, response } = (await req.json()) as {
          request_id: number;
          response: string;
        };
        const r = db
          .query(
            "UPDATE requests SET status = 'answered', response = ?, answered_at = ? WHERE id = ?",
          )
          .run(response, now(), Number(request_id));
        if (r.changes === 0) {
          return Response.json({ error: `request ${request_id} not found` }, { status: 404 });
        }
        publish("queue");
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`grid workbench up at ${server.url} — disposable, 127.0.0.1, this session only — state in ${DB_PATH}`);
