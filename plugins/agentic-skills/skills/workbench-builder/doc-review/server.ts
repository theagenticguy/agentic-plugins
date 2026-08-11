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
`);

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
        const r = db
          .query(
            `INSERT INTO annotations (block_id, start, end, quote, kind, body, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(block_id, start, end, quote, kind, body, now());
        publish("annotations", `block-${block_id}`);
        return Response.json({ ok: true, id: Number(r.lastInsertRowid) });
      },
    },

    // Agent (or human) transitions an annotation.
    "/api/annotations/:id/status": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { status, reply = "" } = (await req.json()) as {
          status: "open" | "resolved" | "wontfix";
          reply?: string;
        };
        if (!["open", "resolved", "wontfix"].includes(status)) {
          return Response.json({ error: "bad status" }, { status: 400 });
        }
        const ann = db.query("SELECT block_id FROM annotations WHERE id = ?").get(id) as
          | { block_id: number }
          | null;
        if (!ann) return Response.json({ error: "not found" }, { status: 404 });
        db.query(
          "UPDATE annotations SET status = ?, reply = ?, resolved_at = ? WHERE id = ?",
        ).run(status, reply, status === "open" ? null : now(), id);
        publish("annotations", `block-${ann.block_id}`);
        return Response.json({ ok: true });
      },
    },
  },
});

console.log(
  `doc review up at ${server.url} — ${blocks.length} blocks from ${DOC_PATH} — disposable, 127.0.0.1 — state in ${DB_PATH}`,
);
