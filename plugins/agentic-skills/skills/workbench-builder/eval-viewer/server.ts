/**
 * Eval viewer — the reference workbench for judge/eval sessions.
 *
 * Board of eval cases with split ownership (human verdicts, agent results),
 * run history for the charts, an append-only event log, and the human→agent
 * request queue. Bun.serve + bun:sqlite + SSE invalidation. 127.0.0.1 only.
 * Run: `bun --hot server.ts`
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5050;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "eval-viewer.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS evals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    prompt     TEXT NOT NULL DEFAULT '',
    expected   TEXT NOT NULL DEFAULT '',
    -- Agent-owned columns (terminal writes):
    actual     TEXT NOT NULL DEFAULT '',
    claude_note TEXT NOT NULL DEFAULT '',
    outcome    TEXT NOT NULL DEFAULT 'pending', -- pending | pass | fail
    -- Human-owned columns (browser writes):
    status     TEXT NOT NULL DEFAULT 'unreviewed', -- unreviewed | approved | flagged
    human_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    passed     INTEGER NOT NULL DEFAULT 0,
    failed     INTEGER NOT NULL DEFAULT 0,
    duration_s REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    eval_id    INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'question',
    body        TEXT NOT NULL,
    eval_id     INTEGER,
    status      TEXT NOT NULL DEFAULT 'queued',
    response    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    answered_at TEXT
  );
`);

const now = () => new Date().toISOString();

// Seed like a session in progress: mixed outcomes, one flagged case with a
// mermaid diagram in its note, and two prior runs so the charts draw.
const empty = db.query("SELECT COUNT(*) AS n FROM evals").get() as { n: number };
if (empty.n === 0) {
  const ins = db.query(
    `INSERT INTO evals (name, prompt, expected, actual, claude_note, outcome, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run(
    "extract-dates",
    "Extract all dates from the memo as ISO strings.",
    '["2026-03-12", "2026-06-23"]',
    '["2026-03-12", "2026-06-23"]',
    "Exact match on both dates.",
    "pass",
    "approved",
    now(),
  );
  ins.run(
    "summarize-thread",
    "Summarize the support thread in 2 sentences.",
    "Mentions the refund AND the shipping delay.",
    "Covers the refund; omits the shipping delay.",
    "Partial coverage — judge scored 0.5.\n\n```mermaid\nflowchart LR\n  P[prompt] --> J[judge]\n  J -->|0.5| S[score]\n```",
    "fail",
    "unreviewed",
    now(),
  );
  ins.run(
    "classify-priority",
    "Classify ticket priority: low / medium / high.",
    "high",
    "high",
    "Matched with `temperature=0`; stable across 3 retries.",
    "pass",
    "unreviewed",
    now(),
  );
  const run = db.query(
    "INSERT INTO runs (label, passed, failed, duration_s, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  run.run("baseline", 6, 4, 42.1, now());
  run.run("prompt-v2", 8, 2, 39.7, now());
  db.query("INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)").run(
    "ingest",
    "seeded 3 evals, 2 runs",
    now(),
  );
}

// --- SSE fan-out: invalidation signals only ---------------------------------
type Subscriber = { write: (chunk: string) => void };
const subscribers = new Set<Subscriber>();

function publish(...regions: string[]) {
  for (const region of regions) {
    const frame = `event: ${region}\ndata: stale\n\n`;
    for (const sub of subscribers) {
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

// --- Region queries ----------------------------------------------------------
const regions: Record<string, (url: URL) => unknown> = {
  board: () => db.query("SELECT * FROM evals ORDER BY id DESC").all(),
  summary: () =>
    db
      .query(
        `SELECT COUNT(*) AS total,
                SUM(outcome = 'pass')    AS pass,
                SUM(outcome = 'fail')    AS fail,
                SUM(outcome = 'pending') AS pending
         FROM evals`,
      )
      .get(),
  "run-history": () =>
    db.query("SELECT * FROM runs ORDER BY id LIMIT 50").all(),
  "event-log": () =>
    db.query("SELECT * FROM events ORDER BY id DESC LIMIT 25").all(),
  queue: () => db.query("SELECT * FROM requests ORDER BY id DESC LIMIT 20").all(),
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  routes: {
    "/": homepage,

    "/events": (req) => {
      server.timeout(req, 0);
      return sseResponse();
    },

    "/api/regions/:name": (req) => {
      const query = regions[req.params.name];
      if (!query) return Response.json({ error: "unknown region" }, { status: 404 });
      return Response.json(query(new URL(req.url)));
    },

    // Human verdict from the browser.
    "/api/evals/:id/status": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { status, human_note = "" } = (await req.json()) as {
          status: string;
          human_note?: string;
        };
        db.query("UPDATE evals SET status = ?, human_note = ? WHERE id = ?").run(
          status,
          human_note,
          id,
        );
        db.query(
          "INSERT INTO events (kind, detail, eval_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("verdict", `#${id} → ${status}`, id, now());
        publish("board", "event-log");
        return Response.json({ ok: true });
      },
    },

    // Agent records one eval result (upsert by name).
    "/claude/eval-result": {
      POST: async (req) => {
        const { name, prompt = "", expected = "", actual = "", claude_note = "", outcome } =
          (await req.json()) as {
            name: string;
            prompt?: string;
            expected?: string;
            actual?: string;
            claude_note?: string;
            outcome: "pass" | "fail" | "pending";
          };
        const existing = db.query("SELECT id FROM evals WHERE name = ?").get(name) as
          | { id: number }
          | null;
        let id: number;
        if (existing) {
          db.query(
            "UPDATE evals SET actual = ?, claude_note = ?, outcome = ? WHERE id = ?",
          ).run(actual, claude_note, outcome, existing.id);
          id = existing.id;
        } else {
          const r = db
            .query(
              `INSERT INTO evals (name, prompt, expected, actual, claude_note, outcome, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(name, prompt, expected, actual, claude_note, outcome, now());
          id = Number(r.lastInsertRowid);
        }
        db.query(
          "INSERT INTO events (kind, detail, eval_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("result", `${name}: ${outcome}`, id, now());
        publish("board", "summary", "event-log");
        return Response.json({ ok: true, id });
      },
    },

    // Agent records a whole run (feeds the charts).
    "/claude/run": {
      POST: async (req) => {
        const { label, passed, failed, duration_s = 0 } = (await req.json()) as {
          label: string;
          passed: number;
          failed: number;
          duration_s?: number;
        };
        db.query(
          "INSERT INTO runs (label, passed, failed, duration_s, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(label, passed, failed, duration_s, now());
        db.query(
          "INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)",
        ).run("run", `${label}: ${passed}/${passed + failed} passed`, now());
        publish("run-history", "event-log");
        return Response.json({ ok: true });
      },
    },

    // Agent reads back the human's verdicts (the feedback channel).
    "/claude/feedback": () =>
      Response.json(
        db
          .query(
            "SELECT id, name, status, human_note FROM evals WHERE status != 'unreviewed' ORDER BY id",
          )
          .all(),
      ),

    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "question", eval_id = null } = (await req.json()) as {
          body: string;
          kind?: string;
          eval_id?: number | null;
        };
        db.query(
          "INSERT INTO requests (kind, body, eval_id, created_at) VALUES (?, ?, ?, ?)",
        ).run(kind, body, eval_id, now());
        publish("queue");
        return Response.json({ ok: true });
      },
    },

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
        db.query(
          "UPDATE requests SET status = 'answered', response = ?, answered_at = ? WHERE id = ?",
        ).run(response, now(), request_id);
        db.query(
          "INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)",
        ).run("respond", `request #${request_id} answered`, now());
        publish("queue", "event-log");
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`eval viewer up at ${server.url} — disposable, 127.0.0.1, this session only — state in ${DB_PATH}`);
