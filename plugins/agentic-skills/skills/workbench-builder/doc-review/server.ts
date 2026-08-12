/**
 * Doc review / redline workbench — select text in the browser, leave comments
 * and redlines; the agent lists and resolves them from the terminal.
 *
 * Anchoring contract: the server parses the document into blocks and stores
 * each block's NORMALIZED text (entities decoded, whitespace collapsed). The
 * browser renders that exact string per block, so a selection's character
 * offsets are computed against the same text the server stored — byte-equal by
 * construction. Annotations are (block_id, start, end, quote).
 *
 * Attribution contract: an annotation row records the note, not who moved it,
 * so every mutation also appends one `events` row carrying the actor. Human
 * routes live under /api, agent routes under /claude, and the wake-on-work
 * digest reports only human events — the agent's own resolves never wake it.
 *
 * Point at your own file with REVIEW_DOC=/path/to/doc.html.
 * Run: `bun --hot server.ts`
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5057;
const DOC_PATH =
  process.env.REVIEW_DOC ?? new URL("./sample-doc.html", import.meta.url).pathname;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "doc-review.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

// --- Document parsing --------------------------------------------------------
// Reviewable text lives in these block tags. Inner inline tags are stripped;
// entities are decoded and whitespace collapsed so browser text and stored
// text are identical strings.
const BLOCK_TAGS = ["h1", "h2", "h3", "p", "li", "blockquote", "td", "th", "caption"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rarr: "→",
  larr: "←",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function normalize(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

type Block = { id: number; tag: string; text: string };

function parseBlocks(html: string): Block[] {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const re = new RegExp(`<(${BLOCK_TAGS.join("|")})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "gi");
  const blocks: Block[] = [];
  let m: RegExpExecArray | null;
  let id = 0;
  while ((m = re.exec(body)) !== null) {
    const text = normalize(m[2]);
    if (text !== "") blocks.push({ id: id++, tag: m[1].toLowerCase(), text });
  }
  return blocks;
}

const docHtml = await Bun.file(DOC_PATH).text();
const blocks = parseBlocks(docHtml);
const docTitle = normalize(docHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Document");

// --- Database ----------------------------------------------------------------
const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS annotations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id    INTEGER NOT NULL,
    start       INTEGER NOT NULL,
    end         INTEGER NOT NULL,
    quote       TEXT NOT NULL,          -- exact selected text, for drift detection
    kind        TEXT NOT NULL,          -- comment | redline
    body        TEXT NOT NULL,          -- the note, or the proposed replacement
    status      TEXT NOT NULL DEFAULT 'open',  -- open | resolved | wontfix
    reply       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    resolved_at TEXT
  );

  -- The attributed activity log. A status flip reuses an annotation row, so the
  -- annotations table cannot serve as the log: only an append-only id sequence
  -- gives the agent's watermark something monotonic to walk.
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,                 -- annotate | status
    detail        TEXT NOT NULL DEFAULT '',
    annotation_id INTEGER,
    actor         TEXT NOT NULL DEFAULT 'human', -- human | agent
    created_at    TEXT NOT NULL
  );

  -- The human→agent channel: queued → working (claimed by /claude/queue) →
  -- answered (/claude/respond).
  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'question',
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',  -- queued | working | answered
    response    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    answered_at TEXT
  );

  -- The agent's read cursor into events. Everything at or below last_event_id
  -- is processed; the digest reports only what lies past it, so a wake-up never
  -- re-processes a batch (exactly-once per event).
  CREATE TABLE IF NOT EXISTS agent_watermark (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_event_id INTEGER NOT NULL DEFAULT 0
  );
`);

// A session .db can predate a column (CREATE TABLE IF NOT EXISTS never alters).
// Ensure additive columns exist so a --hot restart on an old file doesn't 500.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("events", "actor", "actor TEXT NOT NULL DEFAULT 'human'");

// First boot of the watermark starts at the current head of the log: history
// before the watcher existed is already-handled work, not a pending batch.
{
  const wm = db.query("SELECT COUNT(*) AS n FROM agent_watermark").get() as { n: number };
  if (wm.n === 0) {
    const head = db.query("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number };
    db.query("INSERT INTO agent_watermark (id, last_event_id) VALUES (1, ?)").run(head.m);
  }
}

const now = () => new Date().toISOString();

// --- SSE fan-out: invalidation signals only ----------------------------------
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

// --- Regions ------------------------------------------------------------------
const regions: Record<string, (url: URL) => unknown> = {
  document: () => ({ title: docTitle, blocks }),
  annotations: (url) => {
    const status = url.searchParams.get("status");
    return status
      ? db.query("SELECT * FROM annotations WHERE status = ? ORDER BY id DESC").all(status)
      : db.query("SELECT * FROM annotations ORDER BY id DESC").all();
  },
  queue: () => db.query("SELECT * FROM requests ORDER BY id DESC LIMIT 20").all(),
};

/** One event row per mutation, so the wake-on-work digest can attribute it. */
function logEvent(kind: string, detail: string, annotationId: number, actor: "human" | "agent") {
  db.query(
    `INSERT INTO events (kind, detail, annotation_id, actor, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(kind, detail, annotationId, actor, now());
}

/**
 * The single status-transition path. Both actors funnel through it — the browser
 * reopen button and the terminal resolve — so the log entry and the UPDATE are
 * one transaction and neither side can flip a status unattributed.
 *
 * Returns null on success, or the rejection plus the status code the route owes
 * the caller: a bad status is the caller's fault (400), a missing annotation is
 * a different failure it must be able to tell apart (404).
 */
function setStatus(
  id: number,
  status: string,
  reply: string,
  actor: "human" | "agent",
): { error: string; status: 400 | 404 } | null {
  if (!["open", "resolved", "wontfix"].includes(status)) {
    return { error: "bad status", status: 400 };
  }
  const ann = db.query("SELECT block_id FROM annotations WHERE id = ?").get(id) as
    | { block_id: number }
    | null;
  if (ann === null) return { error: "not found", status: 404 };
  db.transaction(() => {
    db.query("UPDATE annotations SET status = ?, reply = ?, resolved_at = ? WHERE id = ?").run(
      status,
      reply,
      status === "open" ? null : now(),
      id,
    );
    logEvent("status", `#${id} → ${status}`, id, actor);
  })();
  publish("annotations", `block-${ann.block_id}`);
  return null;
}

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

    // Human creates an annotation from a selection.
    "/api/annotations": {
      POST: async (req) => {
        const { block_id, start, end, quote, kind, body } = (await req.json()) as {
          block_id: number;
          start: number;
          end: number;
          quote: string;
          kind: "comment" | "redline";
          body: string;
        };
        // Reject drifted anchors instead of storing a lie: the quote must be
        // exactly what those offsets slice out of the block's stored text.
        const block = blocks[block_id];
        if (!block || block.text.slice(start, end) !== quote) {
          return Response.json({ error: "anchor mismatch" }, { status: 409 });
        }
        let id = 0;
        db.transaction(() => {
          const r = db
            .query(
              `INSERT INTO annotations (block_id, start, end, quote, kind, body, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(block_id, start, end, quote, kind, body, now());
          id = Number(r.lastInsertRowid);
          logEvent("annotate", `${kind} on block ${block_id}: “${quote}”`, id, "human");
        })();
        publish("annotations", `block-${block_id}`);
        return Response.json({ ok: true, id });
      },
    },

    // Human transitions an annotation from the browser (the reopen override).
    "/api/annotations/:id/status": {
      POST: async (req) => {
        const { status, reply = "" } = (await req.json()) as { status: string; reply?: string };
        const err = setStatus(Number(req.params.id), status, reply, "human");
        if (err !== null) return Response.json({ error: err.error }, { status: err.status });
        return Response.json({ ok: true });
      },
    },

    // Agent transitions an annotation from the terminal (scripts/review.ts) —
    // same path, actor 'agent', so the resolve stays out of the next digest.
    "/claude/annotations/:id/status": {
      POST: async (req) => {
        const { status, reply = "" } = (await req.json()) as { status: string; reply?: string };
        const err = setStatus(Number(req.params.id), status, reply, "agent");
        if (err !== null) return Response.json({ error: err.error }, { status: err.status });
        return Response.json({ ok: true });
      },
    },

    // Human → agent: ask a question, or hand over the batch, from the browser.
    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "question" } = (await req.json()) as { body: string; kind?: string };
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

    // The agent's work order, read by scripts/wait-for-work.ts at wake-up: the
    // human events past the watermark, the annotations still awaiting a reply,
    // and any queued requests — the batch arrives already framed.
    "/claude/digest": () => {
      const { last_event_id } = db
        .query("SELECT last_event_id FROM agent_watermark WHERE id = 1")
        .get() as { last_event_id: number };
      const head = db.query("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number };
      return Response.json({
        watermark: last_event_id,
        latest_event_id: head.m,
        events: db
          .query(
            `SELECT e.id, e.kind, e.detail, e.annotation_id, e.created_at,
                    a.block_id, a.quote, a.body, a.status, a.kind AS annotation_kind
             FROM events e LEFT JOIN annotations a ON a.id = e.annotation_id
             WHERE e.id > ? AND e.actor = 'human' ORDER BY e.id`,
          )
          .all(last_event_id),
        open_annotations: db
          .query("SELECT * FROM annotations WHERE status = 'open' ORDER BY id")
          .all(),
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

console.log(
  `doc review up at ${server.url} — ${blocks.length} blocks from ${DOC_PATH} — disposable, 127.0.0.1 — state in ${DB_PATH}`,
);
