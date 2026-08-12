/**
 * PR review room — the reference workbench for a multi-PR change-set.
 *
 * Not a diff viewer: a synthesis surface. Its core tables (prs, pr_files,
 * concerns, requests) exist for the collisions query — a GROUP BY path
 * HAVING n > 1 over pr_files answers a question about the SET of PRs that no
 * single PR page can answer. `events` + `agent_watermark` carry the
 * wake-on-work loop: the reviewer's verdicts become the agent's work order.
 *
 * Bun.serve + bun:sqlite + SSE invalidation. 127.0.0.1 only.
 * Run: `bun --hot server.ts`
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import homepage from "./index.html";

const PORT = 5051;
// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
// One file per workbench; delete it to reset the session.
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "pr-workbench.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
// Load-bearing here, not boilerplate: re-ingesting a PR deletes its file and
// concern rows through the CASCADE. Without this pragma SQLite ignores the
// foreign keys and every re-ingest orphans a full set of rows, which the
// collisions query would then count as extra PRs touching the path.
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS prs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    number     INTEGER NOT NULL UNIQUE,       -- the upsert key for /pr/ingest
    title      TEXT NOT NULL,
    author     TEXT NOT NULL DEFAULT '',
    branch     TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',      -- markdown, rendered by <Markdown>
    state      TEXT NOT NULL DEFAULT 'open',  -- open | draft | approved | changes
    risk       TEXT NOT NULL DEFAULT 'medium',-- high | medium | low (board sort)
    additions  INTEGER NOT NULL DEFAULT 0,
    deletions  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  -- One row per file touched per PR. path REPEATS across PRs on purpose:
  -- that repetition IS the collisions signal.
  CREATE TABLE IF NOT EXISTS pr_files (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id     INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
    path      TEXT NOT NULL,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    kind      TEXT NOT NULL DEFAULT 'modified' -- added | modified | deleted | renamed
  );

  CREATE TABLE IF NOT EXISTS concerns (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_id    INTEGER NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
    severity TEXT NOT NULL DEFAULT 'nit',     -- blocker | warn | nit
    title    TEXT NOT NULL,
    body     TEXT NOT NULL DEFAULT '',
    path     TEXT NOT NULL DEFAULT '',
    resolved INTEGER NOT NULL DEFAULT 0
  );

  -- The activity log the wake-on-work digest walks. Every browser mutation
  -- lands one actor-attributed row; the digest reports only human rows, so
  -- the agent's own ingests and answers never wake it. pr_id is a plain
  -- integer, not a foreign key: the log is an audit trail that outlives the
  -- rows it describes, and a CASCADE would erase the reason a PR moved.
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,                  -- ingest | state | concern | respond
    detail     TEXT NOT NULL DEFAULT '',
    pr_id      INTEGER,
    actor      TEXT NOT NULL DEFAULT 'human',  -- human | agent
    created_at TEXT NOT NULL
  );

  -- The human→agent channel. kind extends the standard set with PR verbs.
  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'ask',  -- ask | investigate | draft-comment | merge-check | summarize
    body        TEXT NOT NULL,
    pr_id       INTEGER,
    status      TEXT NOT NULL DEFAULT 'queued', -- queued | working | answered
    response    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    answered_at TEXT
  );

  -- The agent's read cursor into events. Everything at or below last_event_id
  -- is processed; /claude/digest reports only what lies past it, so a wake-up
  -- never re-processes a batch (exactly-once per event).
  CREATE TABLE IF NOT EXISTS agent_watermark (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_event_id INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files(path);
  CREATE INDEX IF NOT EXISTS idx_pr_files_pr   ON pr_files(pr_id);
  CREATE INDEX IF NOT EXISTS idx_concerns_pr   ON concerns(pr_id);
`);

const now = () => new Date().toISOString();

// A session .db can predate a column (CREATE TABLE IF NOT EXISTS never alters).
// Ensure additive columns exist so a --hot restart on an old file doesn't 500.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("events", "actor", "actor TEXT NOT NULL DEFAULT 'human'");

/** The one log-write path. Every mutation route calls it with its own actor, so
 *  attribution can never be forgotten on one branch and set on another. */
function logEvent(
  kind: string,
  detail: string,
  pr_id: number | null,
  actor: "human" | "agent",
): void {
  db.query(
    "INSERT INTO events (kind, detail, pr_id, actor, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(kind, detail, pr_id, actor, now());
}

// ---------------------------------------------------------------------------
// Ingest — the ONE write path for a whole analyzed PR. Shared by the seed and
// by POST /pr/ingest, so the seed can never drift from what the terminal
// produces. Upserts by number; children are replaced wholesale via the
// CASCADE so a re-analysis never leaves stale files or concerns behind.
// ---------------------------------------------------------------------------
type FileIn = { path: string; additions?: number; deletions?: number; kind?: string };
type ConcernIn = {
  severity?: string;
  title: string;
  body?: string;
  path?: string;
  resolved?: number | boolean;
};
type PrIn = {
  number: number;
  title: string;
  author?: string;
  branch?: string;
  summary?: string;
  state?: string;
  risk?: string;
  files?: FileIn[];
  concerns?: ConcernIn[];
};

function ingestPr(pr: PrIn): { id: number; created: boolean } {
  const files = pr.files ?? [];
  const concerns = pr.concerns ?? [];
  // Adds/dels are derived from the file rows, never trusted from the payload:
  // one source of truth means the fleet card's totals always equal the sum of
  // the file list the detail dialog shows.
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);

  const existing = db.query("SELECT id FROM prs WHERE number = ?").get(pr.number) as
    | { id: number }
    | null;

  let id: number;
  if (existing) {
    id = existing.id;
    db.query(
      `UPDATE prs SET title = ?, author = ?, branch = ?, summary = ?, state = ?,
                      risk = ?, additions = ?, deletions = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      pr.title,
      pr.author ?? "",
      pr.branch ?? "",
      pr.summary ?? "",
      pr.state ?? "open",
      pr.risk ?? "medium",
      additions,
      deletions,
      now(),
      id,
    );
    // Children are owned by the analysis, not merged into it.
    db.query("DELETE FROM pr_files WHERE pr_id = ?").run(id);
    db.query("DELETE FROM concerns WHERE pr_id = ?").run(id);
  } else {
    const r = db
      .query(
        `INSERT INTO prs (number, title, author, branch, summary, state, risk,
                          additions, deletions, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pr.number,
        pr.title,
        pr.author ?? "",
        pr.branch ?? "",
        pr.summary ?? "",
        pr.state ?? "open",
        pr.risk ?? "medium",
        additions,
        deletions,
        now(),
      );
    id = Number(r.lastInsertRowid);
  }

  const insFile = db.query(
    "INSERT INTO pr_files (pr_id, path, additions, deletions, kind) VALUES (?, ?, ?, ?, ?)",
  );
  for (const f of files) {
    insFile.run(id, f.path, f.additions ?? 0, f.deletions ?? 0, f.kind ?? "modified");
  }
  const insConcern = db.query(
    "INSERT INTO concerns (pr_id, severity, title, body, path, resolved) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const c of concerns) {
    insConcern.run(
      id,
      c.severity ?? "nit",
      c.title,
      c.body ?? "",
      c.path ?? "",
      c.resolved ? 1 : 0,
    );
  }
  return { id, created: existing === null };
}

// ---------------------------------------------------------------------------
// Seed — a change-set mid-review, not a cold start. Five PRs on a payments
// service that deliberately overlap on app/models.py and api/routes.py so the
// collisions rail has rows on first boot; severities spread across
// blocker/warn/nit; PR #412's summary carries GFM (table + nested list +
// fenced python) so the Markdown render path is exercised without a reload.
// ---------------------------------------------------------------------------
const seeded = db.query("SELECT COUNT(*) AS n FROM prs").get() as { n: number };
if (seeded.n === 0) {
  const SEED: PrIn[] = [
    {
      number: 412,
      title: "Idempotency keys on charge creation",
      author: "dana",
      branch: "feat/idempotency-keys",
      risk: "high",
      state: "changes",
      summary: `Adds an \`Idempotency-Key\` header to \`POST /charges\` so a retried
request cannot double-charge. Keys live in a new table with a 24h TTL.

| Path | Behavior before | Behavior now |
| --- | --- | --- |
| \`POST /charges\` (new key) | charge created | charge created, key stored |
| \`POST /charges\` (seen key) | **second charge** | replays the stored response |
| \`POST /charges\` (key in flight) | second charge | \`409 Conflict\` |

Open questions for review:

1. TTL placement
   - 24h in the table, or push it to Redis with a native expiry?
   - A cold cache must fall back to the table, so the table wins.
2. Key scope — per-merchant, not global. A shared key across merchants would
   leak a response body across tenants.

\`\`\`python
def create_charge(payload: ChargePayload, key: str | None) -> Charge:
    if key is None:
        return _charge(payload)
    with idempotency_guard(key, scope=payload.merchant_id) as guard:
        if guard.replayed:
            return guard.stored_response
        return guard.record(_charge(payload))
\`\`\`

The guard takes a row lock, so two concurrent requests with the same key
serialize instead of racing.`,
      files: [
        { path: "app/models.py", additions: 84, deletions: 3, kind: "modified" },
        { path: "api/routes.py", additions: 61, deletions: 12, kind: "modified" },
        { path: "app/idempotency.py", additions: 132, deletions: 0, kind: "added" },
        { path: "migrations/0041_idempotency_keys.sql", additions: 24, deletions: 0, kind: "added" },
        { path: "tests/test_idempotency.py", additions: 178, deletions: 0, kind: "added" },
      ],
      concerns: [
        {
          severity: "blocker",
          title: "Row lock held across the payment-provider call",
          path: "app/idempotency.py",
          body:
            "`idempotency_guard` opens the transaction before `_charge`, so the "
            + "row lock is held for the full provider round trip (p99 1.9s). Under "
            + "retry storms this exhausts the pool. Record the key, commit, then "
            + "charge, then update.",
        },
        {
          severity: "warn",
          title: "No index on (merchant_id, key)",
          path: "migrations/0041_idempotency_keys.sql",
          body: "Lookup is the hot path on every charge; the migration only indexes `key`.",
        },
        {
          severity: "nit",
          title: "TTL constant duplicated in two modules",
          path: "app/idempotency.py",
          body: "`86_400` appears in both `idempotency.py` and `models.py`.",
        },
      ],
    },
    {
      number: 408,
      title: "Split Charge model into Charge + Settlement",
      author: "moritz",
      branch: "refactor/settlement-split",
      risk: "high",
      state: "open",
      summary: `Splits the overloaded \`Charge\` model: authorization state stays on
\`Charge\`, money movement moves to a new \`Settlement\`. Unblocks
multi-capture, which the current single-row model cannot express.

- \`Charge.settled_at\` / \`Charge.payout_id\` move to \`Settlement\`
- A charge gets 0..n settlements; the sum is asserted \`<= authorized_amount\`
- Backfill is online — the migration writes one \`Settlement\` per settled charge

Reviewers: the interesting file is \`app/models.py\`, everything else follows
from it.`,
      files: [
        { path: "app/models.py", additions: 213, deletions: 96, kind: "modified" },
        { path: "api/routes.py", additions: 47, deletions: 38, kind: "modified" },
        { path: "app/settlement.py", additions: 164, deletions: 0, kind: "added" },
        { path: "migrations/0040_settlement.sql", additions: 71, deletions: 0, kind: "added" },
        { path: "app/reporting.py", additions: 22, deletions: 41, kind: "modified" },
        { path: "tests/test_models.py", additions: 96, deletions: 44, kind: "modified" },
      ],
      concerns: [
        {
          severity: "blocker",
          title: "Backfill migration is not resumable",
          path: "migrations/0040_settlement.sql",
          body:
            "The backfill runs as one statement over 41M rows. A timeout leaves it "
            + "half-applied with no marker to resume from. Batch on charge id with a "
            + "high-water mark.",
        },
        {
          severity: "warn",
          title: "`Charge.amount` now ambiguous",
          path: "app/models.py",
          body: "Authorized vs settled is exactly the confusion this PR set out to fix; rename to `authorized_amount`.",
        },
      ],
    },
    {
      number: 415,
      title: "Rate-limit the webhook receiver",
      author: "priya",
      branch: "fix/webhook-rate-limit",
      risk: "medium",
      state: "approved",
      summary: `A provider replay pushed 40k webhooks in 90 seconds and the receiver
happily accepted all of them. Adds a per-provider token bucket in front of
\`POST /webhooks/:provider\`, returning \`429\` with \`Retry-After\` once the
bucket empties.

Bucket sizing came from the p99 legitimate burst (measured 2026-07-28):
620 events/min for \`acquirer-a\`, 90/min for the rest.`,
      files: [
        { path: "api/routes.py", additions: 34, deletions: 4, kind: "modified" },
        { path: "app/ratelimit.py", additions: 88, deletions: 0, kind: "added" },
        { path: "config/limits.yaml", additions: 19, deletions: 2, kind: "modified" },
        { path: "tests/test_webhooks.py", additions: 74, deletions: 6, kind: "modified" },
      ],
      concerns: [
        {
          severity: "warn",
          title: "Bucket is per-process, not shared",
          path: "app/ratelimit.py",
          body: "Eight gunicorn workers means the effective limit is 8x the configured one.",
        },
        {
          severity: "nit",
          title: "`Retry-After` rounds down to 0",
          path: "app/ratelimit.py",
          body: "Sub-second refill emits `Retry-After: 0`, which some clients treat as immediate retry.",
        },
      ],
    },
    {
      number: 402,
      title: "Emit structured audit events for refunds",
      author: "dana",
      branch: "feat/refund-audit",
      risk: "medium",
      state: "open",
      summary: `Every refund transition now emits a structured audit event
(\`refund.requested\`, \`refund.approved\`, \`refund.settled\`) to the audit
topic. Compliance asked for a queryable trail; today it is only in the
application log.

Schema is additive-only — consumers pin a \`schema_version\` and unknown
fields are ignored.`,
      files: [
        { path: "app/models.py", additions: 29, deletions: 6, kind: "modified" },
        { path: "app/audit.py", additions: 117, deletions: 0, kind: "added" },
        { path: "app/refunds.py", additions: 52, deletions: 18, kind: "modified" },
        { path: "tests/test_audit.py", additions: 91, deletions: 0, kind: "added" },
      ],
      concerns: [
        {
          severity: "warn",
          title: "Audit emit is inside the refund transaction",
          path: "app/refunds.py",
          body: "A broker timeout rolls back the refund. Emit after commit from an outbox row.",
        },
        {
          severity: "nit",
          title: "Event names not centralized",
          path: "app/audit.py",
          body: "String literals at three call sites; make them an enum.",
        },
      ],
    },
    {
      number: 419,
      title: "Drop the legacy /v1/pay endpoint",
      author: "sam",
      branch: "chore/drop-v1-pay",
      risk: "low",
      state: "draft",
      summary: `\`/v1/pay\` has had zero traffic for 62 days (last call 2026-06-06,
an internal smoke test). Removes the route, the serializer, and the two
integration tests that only covered it.

Draft until the deprecation notice clears its 90-day window on 2026-09-04.`,
      files: [
        { path: "api/routes.py", additions: 2, deletions: 58, kind: "modified" },
        { path: "api/serializers_v1.py", additions: 0, deletions: 94, kind: "deleted" },
        { path: "tests/test_v1_pay.py", additions: 0, deletions: 61, kind: "deleted" },
        { path: "docs/api-changelog.md", additions: 11, deletions: 0, kind: "modified" },
      ],
      concerns: [
        {
          severity: "nit",
          title: "Changelog entry lacks the removal date",
          path: "docs/api-changelog.md",
          body: "Says \"removed in a future release\"; name 2026-09-04.",
        },
      ],
    },
  ];
  for (const pr of SEED) ingestPr(pr);
  logEvent("ingest", `analyzed ${SEED.length} PRs`, null, "agent");
  db.query(
    "INSERT INTO requests (kind, body, pr_id, status, response, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "merge-check",
    "If #408 lands first, how much of #412 has to be rewritten?",
    null,
    "answered",
    "Both rewrite app/models.py charge fields. Land #412 first: it only adds a "
      + "table and a header path, so #408 rebases onto it mechanically. The reverse "
      + "order forces #412's guard to be rewritten against Settlement.",
    now(),
    now(),
  );
}

// First boot of the watermark starts at the current head of the log: history
// before the watcher existed is already-handled work, not a pending batch.
{
  const wm = db.query("SELECT COUNT(*) AS n FROM agent_watermark").get() as { n: number };
  if (wm.n === 0) {
    const head = db.query("SELECT COALESCE(MAX(id), 0) AS m FROM events").get() as { m: number };
    db.query("INSERT INTO agent_watermark (id, last_event_id) VALUES (1, ?)").run(head.m);
  }
}

// ---------------------------------------------------------------------------
// SSE fan-out: invalidation signals only.
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
// Region queries.
//
// `collisions` is the reason this workbench exists: GROUP BY path HAVING n > 1
// returns exactly the files more than one PR touches — a fact about the SET,
// which no per-PR view can produce. GROUP_CONCAT packs the chips as
// number|risk|state triples so the rail needs one query, not one per file.
// ---------------------------------------------------------------------------
const COLLISIONS_SQL = `
  SELECT f.path,
         COUNT(DISTINCT f.pr_id) AS n,
         SUM(f.additions + f.deletions) AS churn,
         GROUP_CONCAT(DISTINCT p.number || '|' || p.risk || '|' || p.state) AS prs
  FROM pr_files f JOIN prs p ON p.id = f.pr_id
  GROUP BY f.path
  HAVING n > 1
  ORDER BY n DESC, churn DESC
`;

// "Who else touches my files" — the complementary self-join to the collisions
// GROUP BY, scoped to one PR.
const OVERLAP_SQL = `
  SELECT f2.path,
         p2.number,
         p2.title,
         p2.risk,
         p2.state,
         f2.additions + f2.deletions AS their_churn
  FROM pr_files f1
  JOIN pr_files f2 ON f2.path = f1.path AND f2.pr_id != f1.pr_id
  JOIN prs p2 ON p2.id = f2.pr_id
  WHERE f1.pr_id = ?
  ORDER BY f2.path, p2.number
`;

/** Sorted risk-then-churn, per the recipe. CASE gives risk an explicit order —
 *  alphabetical would put "low" above "medium". */
const FLEET_SQL = `
  SELECT p.*,
         (SELECT COUNT(*) FROM pr_files f WHERE f.pr_id = p.id) AS n_files,
         (SELECT COUNT(*) FROM concerns c WHERE c.pr_id = p.id AND c.severity = 'blocker' AND c.resolved = 0) AS n_blocker,
         (SELECT COUNT(*) FROM concerns c WHERE c.pr_id = p.id AND c.severity = 'warn'    AND c.resolved = 0) AS n_warn,
         (SELECT COUNT(*) FROM concerns c WHERE c.pr_id = p.id AND c.severity = 'nit'     AND c.resolved = 0) AS n_nit
  FROM prs p
  ORDER BY CASE p.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           (p.additions + p.deletions) DESC
`;

function prDetail(id: number) {
  const pr = db.query("SELECT * FROM prs WHERE id = ?").get(id);
  if (!pr) return null;
  return {
    pr,
    files: db
      .query(
        `SELECT * FROM pr_files WHERE pr_id = ?
         ORDER BY (additions + deletions) DESC, path`,
      )
      .all(id),
    concerns: db
      .query(
        `SELECT * FROM concerns WHERE pr_id = ?
         ORDER BY CASE severity WHEN 'blocker' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id`,
      )
      .all(id),
    overlap: db.query(OVERLAP_SQL).all(id),
    requests: db
      .query("SELECT * FROM requests WHERE pr_id = ? ORDER BY id DESC")
      .all(id),
  };
}

const regions: Record<string, (url: URL) => unknown> = {
  // One aggregate query for the whole strip: four scalars that must agree with
  // the fleet board and the collisions rail, so they are computed from the same
  // tables in one shot instead of four endpoints that can skew mid-ingest.
  overview: () =>
    db
      .query(
        `SELECT (SELECT COUNT(*) FROM prs) AS n_prs,
                (SELECT COALESCE(SUM(additions), 0) FROM prs) AS additions,
                (SELECT COALESCE(SUM(deletions), 0) FROM prs) AS deletions,
                (SELECT COUNT(*) FROM concerns WHERE severity = 'blocker' AND resolved = 0) AS blockers,
                (SELECT COUNT(*) FROM (${COLLISIONS_SQL})) AS n_collisions,
                (SELECT COUNT(*) FROM requests WHERE status != 'answered') AS open_requests`,
      )
      .get(),
  fleet: () => db.query(FLEET_SQL).all(),
  collisions: () => db.query(COLLISIONS_SQL).all(),
  queue: () =>
    db
      .query(
        `SELECT r.*, p.number AS pr_number
         FROM requests r LEFT JOIN prs p ON p.id = r.pr_id
         ORDER BY r.id DESC LIMIT 20`,
      )
      .all(),
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
      const name = req.params.name;
      // Parameterized region: pr-<id> is a live region like any other, so the
      // open Dialog repaints on re-ingest via publish(`pr-${id}`) with no
      // bespoke fetch wiring in the component.
      if (name.startsWith("pr-")) {
        const id = Number(name.slice(3));
        const detail = Number.isFinite(id) ? prDetail(id) : null;
        if (!detail) return Response.json({ error: "unknown pr" }, { status: 404 });
        return Response.json(detail);
      }
      const query = regions[name];
      if (!query) return Response.json({ error: "unknown region" }, { status: 404 });
      return Response.json(query(new URL(req.url)));
    },

    // Human action from the browser: set a PR's review state.
    "/api/prs/:id/state": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { state } = (await req.json()) as { state: string };
        if (!["open", "draft", "approved", "changes"].includes(state)) {
          return Response.json({ error: "bad state" }, { status: 400 });
        }
        const pr = db.query("SELECT number FROM prs WHERE id = ?").get(id) as
          | { number: number }
          | null;
        if (!pr) return Response.json({ error: "unknown pr" }, { status: 404 });
        db.query("UPDATE prs SET state = ?, updated_at = ? WHERE id = ?").run(state, now(), id);
        // A verdict is the human's half of the loop: logged so the wake-on-work
        // digest can hand the agent the batch of PRs the reviewer just moved.
        logEvent("state", `#${pr.number} → ${state}`, id, "human");
        // The state string is inside the collisions GROUP_CONCAT chips, so the
        // rail is stale too — publishing only "fleet" would freeze the chips.
        publish("fleet", "collisions", "overview", `pr-${id}`);
        return Response.json({ ok: true });
      },
    },

    // Human action: resolve / reopen a concern.
    "/api/concerns/:id/resolved": {
      POST: async (req) => {
        const id = Number(req.params.id);
        const { resolved } = (await req.json()) as { resolved: boolean };
        const row = db
          .query(
            `SELECT c.pr_id, c.title, c.severity, p.number
             FROM concerns c JOIN prs p ON p.id = c.pr_id WHERE c.id = ?`,
          )
          .get(id) as { pr_id: number; title: string; severity: string; number: number } | null;
        if (!row) return Response.json({ error: "unknown concern" }, { status: 404 });
        db.query("UPDATE concerns SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, id);
        logEvent(
          "concern",
          `#${row.number} ${row.severity} ${resolved ? "resolved" : "reopened"}: ${row.title}`,
          row.pr_id,
          "human",
        );
        publish("fleet", "overview", `pr-${row.pr_id}`);
        return Response.json({ ok: true });
      },
    },

    // Terminal action: the agent posts one whole analyzed PR.
    "/pr/ingest": {
      POST: async (req) => {
        const body = (await req.json()) as PrIn;
        if (typeof body.number !== "number" || typeof body.title !== "string") {
          return Response.json({ error: "number and title required" }, { status: 400 });
        }
        const { id, created } = ingestPr(body);
        logEvent(
          "ingest",
          `#${body.number} ${created ? "analyzed" : "re-analyzed"}: ${body.title}`,
          id,
          "agent",
        );
        // Every region an ingest can move. collisions is the point: a new PR
        // touching a seeded hot file adds a rail row with no reload.
        publish("fleet", "collisions", "overview", `pr-${id}`);
        return Response.json({ ok: true, id, created });
      },
    },

    // Human → agent.
    "/api/ask": {
      POST: async (req) => {
        const { body, kind = "ask", pr_id = null } = (await req.json()) as {
          body: string;
          kind?: string;
          pr_id?: number | null;
        };
        if (typeof body !== "string" || body.trim() === "") {
          return Response.json({ error: "body required" }, { status: 400 });
        }
        db.query(
          "INSERT INTO requests (kind, body, pr_id, created_at) VALUES (?, ?, ?, ?)",
        ).run(kind, body.trim(), pr_id, now());
        publish("queue", "overview");
        if (pr_id !== null) publish(`pr-${pr_id}`);
        return Response.json({ ok: true });
      },
    },

    // Agent pulls its work. Pulling IS claiming: queued → working.
    "/claude/queue": () => {
      const rows = db
        .query(
          `SELECT r.*, p.number AS pr_number
           FROM requests r LEFT JOIN prs p ON p.id = r.pr_id
           WHERE r.status = 'queued' ORDER BY r.id`,
        )
        .all() as Array<{ id: number; pr_id: number | null }>;
      if (rows.length > 0) {
        db.query(
          `UPDATE requests SET status = 'working'
           WHERE id IN (${rows.map((r) => r.id).join(",")})`,
        ).run();
        publish("queue");
        for (const r of rows) if (r.pr_id !== null) publish(`pr-${r.pr_id}`);
      }
      return Response.json({ requests: rows });
    },

    "/claude/respond": {
      POST: async (req) => {
        const { request_id, response } = (await req.json()) as {
          request_id: number;
          response: string;
        };
        const row = db.query("SELECT pr_id FROM requests WHERE id = ?").get(request_id) as
          | { pr_id: number | null }
          | null;
        if (!row) return Response.json({ error: "unknown request" }, { status: 404 });
        db.query(
          "UPDATE requests SET status = 'answered', response = ?, answered_at = ? WHERE id = ?",
        ).run(response, now(), request_id);
        logEvent("respond", `request #${request_id} answered`, row.pr_id, "agent");
        publish("queue", "overview");
        if (row.pr_id !== null) publish(`pr-${row.pr_id}`);
        return Response.json({ ok: true });
      },
    },

    // The agent's work order, printed by scripts/wait-for-work.ts at wake-up:
    // the human's verdicts and concern flips past the watermark, the concerns
    // still standing, and any queued requests — so the agent starts with the
    // batch already framed. Agent events are excluded: the agent's own ingests
    // and answers must not wake it.
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
          .query(
            `SELECT e.*, p.number AS pr_number
             FROM events e LEFT JOIN prs p ON p.id = e.pr_id
             WHERE e.id > ? AND e.actor = 'human' ORDER BY e.id`,
          )
          .all(last_event_id),
        open_concerns: db
          .query(
            `SELECT c.id, c.pr_id, p.number AS pr_number, c.severity, c.title, c.path
             FROM concerns c JOIN prs p ON p.id = c.pr_id
             WHERE c.resolved = 0
             ORDER BY CASE c.severity WHEN 'blocker' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, c.id`,
          )
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

    // The agent's read-back: which files are contested, so an analysis run can
    // order its work by merge risk instead of by PR number.
    "/claude/collisions": () => Response.json(db.query(COLLISIONS_SQL).all()),
  },
});

console.log(`pr workbench up at ${server.url} — disposable, 127.0.0.1, this session only — state in ${DB_PATH}`);
