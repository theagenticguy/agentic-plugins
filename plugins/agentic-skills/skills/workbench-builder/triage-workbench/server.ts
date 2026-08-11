/**
 * Triage workbench — one prioritized queue across four work surfaces.
 *
 * Email, Slack, calendar, and Asana items arrive normalized from the terminal
 * (MCP tools in a real session). The human triages each one in the browser —
 * respond | delegate | defer | done | ignore — and the agent reads those
 * decisions back through /claude/decisions. The signature verb is
 * /claude/mark-handled: when the agent detects the human already dealt with an
 * item (replied to the email, reacted in Slack), it flips the row to `handled`
 * and the item leaves the queue. The surface only ever shows what still needs
 * attention.
 *
 * Bun.serve + bun:sqlite + SSE invalidation. 127.0.0.1 only.
 * Run: `bun --hot server.ts`
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5065;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "triage.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

// One module-level connection: bun:sqlite is synchronous and this is a single
// process. WAL lets the terminal scripts write while the browser reads.
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,                    -- email | slack | calendar | asana
    source_ref  TEXT NOT NULL DEFAULT '',         -- upstream id: message id, ts, task gid
    kind        TEXT NOT NULL DEFAULT '',         -- thread | mention | meeting | task ...
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    sender      TEXT NOT NULL DEFAULT '',
    due_at      TEXT,                             -- ISO, nullable
    priority    INTEGER NOT NULL DEFAULT 3,       -- 1 urgent .. 4 low
    -- Human-owned (browser writes): status + human_note.
    -- Agent-owned (terminal writes): agent_note + handled_at.
    status      TEXT NOT NULL DEFAULT 'new',      -- new | respond | delegate | defer | done | ignore | handled
    human_note  TEXT NOT NULL DEFAULT '',
    agent_note  TEXT NOT NULL DEFAULT '',
    ingested_at TEXT NOT NULL,
    handled_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    item_id    INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'question',
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',   -- queued | working | answered
    response    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    answered_at TEXT
  );
`);

const now = () => new Date().toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

// Statuses a triaged item has left the queue by. `handled` is the agent's
// reply-detection verdict; done/ignore are the human's own dismissals.
const CLOSED = "('handled','done','ignore')";

// ---------------------------------------------------------------------------
// Seed like a session mid-triage: all four sources, mixed priorities, three
// rows already triaged by the human, one already flipped to `handled` by the
// agent (so the "only what needs attention" semantics show on first boot), and
// two items due within hours so the today rail has content.
// ---------------------------------------------------------------------------
const empty = db.query("SELECT COUNT(*) AS n FROM items").get() as { n: number };
if (empty.n === 0) {
  const ins = db.query(
    `INSERT INTO items
       (source, source_ref, kind, title, body, sender, due_at, priority, status, human_note, agent_note, ingested_at, handled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  type Seed = [
    string, string, string, string, string, string, string | null,
    number, string, string, string, string | null,
  ];
  const seeds: Seed[] = [
    [
      "email", "AAMkAG-01", "thread",
      "Re: Bedrock throughput ceiling on the ingest lane",
      "Their platform lead is asking whether provisioned throughput is the only path past 8 RPS, and wants a number before Thursday's architecture review.",
      "priya.raman@northwind.example", hoursFromNow(30), 1, "respond",
      "Draft the throughput math, cc the SA.", "", now(), null,
    ],
    [
      "email", "AAMkAG-02", "thread",
      "Contract redline — Schedule C, data residency clause",
      "Legal returned two comments on residency. Needs an owner before the redline goes back.",
      "j.okafor@legal.example", null, 2, "delegate",
      "Nadia owns Schedule C.", "", now(), null,
    ],
    [
      "email", "AAMkAG-03", "thread",
      "Invoice 4471 — payment confirmation",
      "Automated confirmation, no action needed.",
      "billing@vendor.example", null, 4, "handled",
      "", "Detected outbound reply 2h after receipt — no open loop.", now(), now(),
    ],
    [
      "email", "AAMkAG-04", "thread",
      "Follow-up: agent eval harness pilot scope",
      "Wants the pilot scope narrowed to two workflows so their team can staff it this quarter.",
      "m.delacroix@acme.example", hoursFromNow(72), 2, "new",
      "", "", now(), null,
    ],
    [
      "slack", "1754531200.481", "mention",
      "@laith can you sanity-check the judge rubric before we ship the gate?",
      "Thread in #ai-eng-namer — two of us disagree on whether faithfulness should hard-fail or warn.",
      "sanjana.k", hoursFromNow(6), 1, "new",
      "", "", now(), null,
    ],
    [
      "slack", "1754529900.117", "dm",
      "DM: got a minute on the Northwind escalation?",
      "Asking whether to loop in the account team before the customer's Thursday review.",
      "derek.m", null, 2, "defer",
      "After the review, not before.", "", now(), null,
    ],
    [
      "slack", "1754522400.902", "mention",
      "@laith the workbench-builder skill link in the wiki 404s",
      "Points at the retired path. Someone needs to repoint it.",
      "ops-bot", null, 4, "new",
      "", "", now(), null,
    ],
    [
      "slack", "1754519000.334", "mention",
      "@laith is the Chronos backtest notebook still the source of truth?",
      "Asked in #forecasting — they want to reuse the coverage calc.",
      "wei.zhang", null, 3, "new",
      "", "", now(), null,
    ],
    [
      "calendar", "AAMkCal-11", "meeting",
      "Northwind architecture review — prep needed",
      "60 min with their platform + security leads. You own the throughput section; slides not started.",
      "priya.raman@northwind.example", hoursFromNow(4), 1, "new",
      "", "", now(), null,
    ],
    [
      "calendar", "AAMkCal-12", "meeting",
      "AI Eng NAMER sprint review",
      "Standing 30 min. Bring the eval-gym status and the two blocked items.",
      "team-namer@example", hoursFromNow(20), 3, "new",
      "", "", now(), null,
    ],
    [
      "calendar", "AAMkCal-13", "meeting",
      "1:1 with Nadia — needs an agenda",
      "No agenda attached. Last one carried two open items.",
      "nadia.f@example", hoursFromNow(50), 3, "new",
      "", "", now(), null,
    ],
    [
      "asana", "1209887766554433", "task",
      "Post engagement notes for Northwind (Sprint Goal)",
      "Sprint commitment. Needs the Slack + calendar context joined into one update.",
      "laith (self-assigned)", hoursFromNow(10), 2, "new",
      "", "", now(), null,
    ],
    [
      "asana", "1209887766554512", "task",
      "Land the triage reference workbench",
      "Workstream: AI Engineering. Blocked on nothing; just needs the hours.",
      "laith (self-assigned)", hoursFromNow(96), 3, "new",
      "", "", now(), null,
    ],
    [
      "asana", "1209887766554698", "task",
      "Retire the stale forecasting skill pointer",
      "Low priority housekeeping; overdue since last sprint.",
      "ops@example", hoursFromNow(-24), 4, "new",
      "", "", now(), null,
    ],
  ];
  for (const s of seeds) ins.run(...s);
  db.query("INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)").run(
    "ingest",
    `seeded ${seeds.length} items across email, slack, calendar, asana`,
    now(),
  );
  db.query("INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)").run(
    "handled",
    "invoice 4471 → handled (reply detected)",
    now(),
  );
}

// ---------------------------------------------------------------------------
// SSE fan-out. Events are INVALIDATION SIGNALS, not data transport. A region
// name must be identical in three places: publish("<region>") here, the
// `event:` field on the wire, and useRegion("<region>") in the browser.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Region queries. `inbox` is PARAMETERIZED: useRegion("inbox", {source}) fetches
// /api/regions/inbox?source=slack. The SSE event name is still plain "inbox",
// so publish("inbox") invalidates every filtered view at once — one frame, each
// page refetches with its own params. Cheap and correct: a filtered refetch is
// a sub-millisecond query on loopback.
// ---------------------------------------------------------------------------
const SOURCES = new Set(["email", "slack", "calendar", "asana"]);

const regions: Record<string, (url: URL) => unknown> = {
  inbox: (url) => {
    const source = url.searchParams.get("source") ?? "";
    const order = "ORDER BY priority ASC, (due_at IS NULL), due_at ASC, id DESC";
    if (source !== "" && SOURCES.has(source)) {
      return db
        .query(
          `SELECT * FROM items WHERE status NOT IN ${CLOSED} AND source = ? ${order}`,
        )
        .all(source);
    }
    // '' or an unknown source falls through to every surface — the "All"
    // segment sends no param at all, so absent and empty behave identically.
    return db.query(`SELECT * FROM items WHERE status NOT IN ${CLOSED} ${order}`).all();
  },

  // Counts per source × status — feeds the stacked bar. Closed statuses stay in
  // this query on purpose: the chart is where `handled` volume stays visible
  // after the inbox drops it.
  "source-summary": () =>
    db
      .query(
        `SELECT source, status, COUNT(*) AS n
         FROM items GROUP BY source, status ORDER BY source, status`,
      )
      .all(),

  // Calendar-flavored slice: anything due inside 24h that is still open, plus
  // anything already overdue.
  today: () =>
    db
      .query(
        `SELECT * FROM items
         WHERE status NOT IN ${CLOSED}
           AND due_at IS NOT NULL
           AND due_at <= datetime('now', '+24 hours')
         ORDER BY due_at ASC`,
      )
      .all(),

  "event-log": () => db.query("SELECT * FROM events ORDER BY id DESC LIMIT 25").all(),

  queue: () => db.query("SELECT * FROM requests ORDER BY id DESC LIMIT 20").all(),
};

const TRIAGE_STATUSES = new Set(["respond", "delegate", "defer", "done", "ignore"]);

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

    // Human decision from the browser. Rejects an unknown status with 400
    // rather than writing a value no region query knows how to filter.
    "/api/items/:id/triage": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { status, human_note = "" } = (await req.json()) as {
          status: string;
          human_note?: string;
        };
        if (!TRIAGE_STATUSES.has(status)) {
          return Response.json(
            { error: `status must be one of ${[...TRIAGE_STATUSES].join("|")}` },
            { status: 400 },
          );
        }
        const row = db.query("SELECT title FROM items WHERE id = ?").get(id) as
          | { title: string }
          | null;
        if (row === null) return Response.json({ error: "no such item" }, { status: 404 });
        db.query("UPDATE items SET status = ?, human_note = ? WHERE id = ?").run(
          status,
          human_note,
          id,
        );
        db.query(
          "INSERT INTO events (kind, detail, item_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("triage", `#${id} → ${status}`, id, now());
        publish("inbox", "source-summary", "today", "event-log");
        return Response.json({ ok: true });
      },
    },

    // Terminal: bulk ingest of normalized items from the MCP surfaces. One
        // publish per batch, not per row — the whole point of taking an array.
    "/claude/ingest": {
      POST: async (req) => {
        const { items } = (await req.json()) as {
          items: Array<{
            source: string;
            source_ref?: string;
            kind?: string;
            title: string;
            body?: string;
            sender?: string;
            due_at?: string | null;
            priority?: number;
            agent_note?: string;
          }>;
        };
        if (!Array.isArray(items) || items.length === 0) {
          return Response.json({ error: "items must be a non-empty array" }, { status: 400 });
        }
        const bad = items.find((i) => !SOURCES.has(i.source));
        if (bad !== undefined) {
          return Response.json(
            { error: `unknown source ${JSON.stringify(bad.source)}` },
            { status: 400 },
          );
        }
        const ins = db.query(
          `INSERT INTO items
             (source, source_ref, kind, title, body, sender, due_at, priority, agent_note, ingested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const ids: number[] = [];
        for (const i of items) {
          const r = ins.run(
            i.source,
            i.source_ref ?? "",
            i.kind ?? "",
            i.title,
            i.body ?? "",
            i.sender ?? "",
            i.due_at ?? null,
            i.priority ?? 3,
            i.agent_note ?? "",
            now(),
          );
          ids.push(Number(r.lastInsertRowid));
        }
        db.query("INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)").run(
          "ingest",
          `ingested ${items.length} item(s): ${items.map((i) => i.source).join(", ")}`,
          now(),
        );
        publish("inbox", "source-summary", "today", "event-log");
        return Response.json({ ok: true, ids });
      },
    },

    // THE signature verb. The agent detected the human already dealt with this
    // item upstream (replied to the email, reacted in the thread), so the row
    // leaves the queue without the human touching it. Accepts either the
    // upstream source_ref or the local id — the agent usually holds the former.
    "/claude/mark-handled": {
      POST: async (req) => {
        const { source_ref, id, agent_note = "" } = (await req.json()) as {
          source_ref?: string;
          id?: number;
          agent_note?: string;
        };
        const row = (
          id !== undefined
            ? db.query("SELECT id, title FROM items WHERE id = ?").get(id)
            : db.query("SELECT id, title FROM items WHERE source_ref = ?").get(source_ref ?? "")
        ) as { id: number; title: string } | null;
        if (row === null) {
          return Response.json({ error: "no item matched id or source_ref" }, { status: 404 });
        }
        db.query(
          "UPDATE items SET status = 'handled', handled_at = ?, agent_note = ? WHERE id = ?",
        ).run(now(), agent_note, row.id);
        db.query(
          "INSERT INTO events (kind, detail, item_id, created_at) VALUES (?, ?, ?, ?)",
        ).run("handled", `#${row.id} ${row.title.slice(0, 48)} → handled`, row.id, now());
        publish("inbox", "source-summary", "today", "event-log");
        return Response.json({ ok: true, id: row.id });
      },
    },

    // Terminal: read back every human decision so the agent can act on it.
    // `new` and `handled` are excluded — one has no decision yet, the other is
    // the agent's own verdict coming back at it.
    "/claude/decisions": () =>
      Response.json(
        db
          .query(
            `SELECT id, source, source_ref, kind, title, sender, priority, status, human_note
             FROM items
             WHERE status NOT IN ('new', 'handled')
             ORDER BY priority ASC, id ASC`,
          )
          .all(),
      ),

    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "question" } = (await req.json()) as {
          body: string;
          kind?: string;
        };
        db.query(
          "INSERT INTO requests (kind, body, created_at) VALUES (?, ?, ?)",
        ).run(kind, body, now());
        publish("queue");
        return Response.json({ ok: true });
      },
    },

    // Pulling IS claiming: queued rows flip to working in the same call, so the
    // badge moves in the browser the moment the agent picks up.
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
        db.query("INSERT INTO events (kind, detail, created_at) VALUES (?, ?, ?)").run(
          "respond",
          `request #${request_id} answered`,
          now(),
        );
        publish("queue", "event-log");
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`triage workbench up at ${server.url} — disposable, 127.0.0.1, this session only — state in ${DB_PATH}`);
