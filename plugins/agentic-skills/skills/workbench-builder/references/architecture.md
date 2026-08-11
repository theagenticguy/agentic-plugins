# Workbench architecture — Bun + bun:sqlite + React 19 + SSE invalidation

The stack is deliberately small: one `server.ts` (Bun.serve + bun:sqlite + the SSE fan-out), one `index.html` fullstack entry, a `src/` of React components on Astryx, and zero-dependency terminal scripts. "Small" means no bundler config, no ORM, no deploy — it does **not** mean no capability. The whole point is a live, two-way visual surface for a Claude Code session that boots with `bun --hot server.ts` and gets thrown away with its `.db` file.

Every claim below is grounded in the browser-verified implementations:

- Eval viewer: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/eval-viewer/` (port 5050, Graphite light, teal accent)
- Document review / redline: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/doc-review/` (port 5057, Graphite light, navy accent)
- Multi-PR review room: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/pr-workbench/` (port 5051, Graphite **dark**, dark-teal accent)
- Grid / spreadsheet triage: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/grid-workbench/` (port 5062, Graphite light, amber accent)
- Multi-surface triage: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/triage-workbench/` (port 5065, Graphite light, plum accent)
- Generalized skeletons: `${CLAUDE_PLUGIN_ROOT}/skills/workbench-builder/templates/`

Port note: 5060 and 5061 sit on Chrome's unsafe-port blocklist (`ERR_UNSAFE_PORT` — the browser refuses before the request reaches Bun). Pick ports outside that list; the five above are safe.

## Contents

- The stack, row by row
- Database: one module-level connection
- SSE is an invalidation signal, not data transport
- The publish() fan-out
- The useRegion hook
- Region endpoints: one query, every caller
- One mutation path — browser and terminal share it
- The two-way loop
- Per-item events for write bursts
- Seed data doctrine
- Security posture
- Gotchas

## The stack, row by row

| Piece             | Choice                                    | Why                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime + server  | `Bun.serve` with `routes`                 | One process serves the JSON API, the SSE stream, AND the transpiled React app — `import homepage from "./index.html"` makes Bun bundle TSX/CSS on demand. `bun --hot` gives HMR while the UI is reshaped mid-session.                                                            |
| Database          | `bun:sqlite`                              | Native, synchronous, better-sqlite3-shaped. No ORM: the SQL *is* the design.                                                                                                                                                                                                     |
| UI                | React 19 + Astryx (`@astryxdesign/core`)  | Real composable components (Card, Badge, Collapsible, Dialog, Table, TextArea…) instead of hand-rolled CSS per page. Astryx needs no build plugin — prebuilt CSS imports. One theme across the catalog, Graphite, built from the design system's own tokens (`dependencies.md`). |
| Live updates      | SSE + `useRegion`                         | Named invalidation events; each region refetches its own JSON.                                                                                                                                                                                                                   |
| Charts / diagrams | ECharts + mermaid (piecewise npm imports) | See `rendering.md`.                                                                                                                                                                                                                                                              |
| Terminal side     | `bun run scripts/*.ts`                    | Global `fetch`, zero dependencies — not even a dependency header.                                                                                                                                                                                                                |

Versions are pinned exact in each workbench's `package.json` (see `dependencies.md`). One `bun install` per workbench; after that `bun --hot server.ts` is the only command.

## Database: one module-level connection

`bun:sqlite` is synchronous and the server is a single process, so ONE module-level connection serves every request — no pooling, no request-scoped open/close ceremony:

```ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Runtime state lives outside the skill dir (XDG state dir; override with WORKBENCH_DB).
const stateDir = process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? ".", ".local", "state");
const DB_PATH = process.env.WORKBENCH_DB ?? join(stateDir, "workbench-builder", "workbench.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");   // terminal writes while the browser reads
db.exec("PRAGMA busy_timeout = 5000");  // don't 500 on a momentary lock
db.exec("PRAGMA foreign_keys = ON");    // child tables use ON DELETE CASCADE
```

Query idioms (`eval-viewer/server.ts`):

```ts
db.query("SELECT * FROM evals ORDER BY id DESC").all();   // rows as objects
db.query("SELECT COUNT(*) AS n FROM evals").get();        // one row
const r = db.query("INSERT INTO evals (name) VALUES (?)").run(name);
Number(r.lastInsertRowid);                                 // new id
```

The `.db` file lives under `$XDG_STATE_HOME/workbench-builder/` (default `~/.local/state/workbench-builder/`, override with `WORKBENCH_DB`) — never inside the skill directory — and regenerates from the seed on first boot. The server logs the resolved path at startup; delete the file to reset the session.

## SSE is an invalidation signal, not data transport

A state change emits a tiny NAMED event: `event: <region>\ndata: stale`. The browser refetches that region's JSON and re-renders. The payload is never read. The instant you serialize state into the event you have a second source of truth and a client-side sync problem; on loopback, the refetch costs about a millisecond.

**The contract** (server in `templates/server.ts` `sseResponse()`, client in `templates/src/useRegion.ts`):

- One `EventSource("/events")` per page, module-level.
- On connect the server sends `retry: 1000` (reconnect delay) then `event: hello` (lights the LED).
- A change emits `event: <region>\ndata: stale\n\n` to every subscriber.
- Every 15s of silence: a `: keep-alive\n\n` comment frame.
- The `/events` route calls `server.timeout(req, 0)` — without it Bun idle-times-out the stream.
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

**The three-strings-match rule.** A region name must be identical in three places: `publish("board")` on the server, the `event: board` frame on the wire, and `useRegion("board")` in the browser. Nothing enforces this but convention; drift renders as a silently frozen panel. When a panel loads once but never updates, check these three strings first.

## The publish() fan-out

```ts
type Subscriber = { write: (chunk: string) => void };
const subscribers = new Set<Subscriber>();

function publish(...regions: string[]) {
  for (const region of regions) {
    const frame = `event: ${region}\ndata: stale\n\n`;
    for (const sub of subscribers) {
      try { sub.write(frame); } catch { subscribers.delete(sub); }
    }
  }
}
```

Each `/events` connection wraps its `ReadableStream` controller in a subscriber; the stream's `cancel()` (fires on tab close) removes it and clears the keep-alive interval. A write to a dead pipe throws — drop that subscriber, never the frame. Full shape in `templates/server.ts`.

Every mutation endpoint ends with `publish(...)` naming the regions its write affected. An endpoint that forgets to publish produces the "acts but nothing repaints" bug.

## The useRegion hook

The client half of the contract, ~40 lines, copied verbatim into each workbench (`templates/src/useRegion.ts`):

```tsx
const es = new EventSource("/events");            // module singleton — one per page

export function useRegion<T>(name: string, params?: Record<string, string>): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const refetch = () => fetch(`/api/regions/${name}${qs}`)
      .then((r) => r.json()).then(setData).catch(() => {});
    refetch();                                    // fill on mount
    es.addEventListener(name, refetch);           // invalidation → refetch
    es.addEventListener("open", refetch);         // reconnect → heal missed events
    return () => { /* remove both listeners */ };
  }, [name, qs]);
  return data;
}
```

- Returns `null` while the first fetch is in flight — components render nothing or an `EmptyState`, never crash.
- The `open` listener heals disconnects: any invalidation that fired while the tab was offline is covered by the reconnect refetch.
- `useSseStatus()` (same file) drives the live LED from `open`/`hello`/`error`.
- The `EventSource` is module-level on purpose: one hook instance per region, one stream per page. A per-component `new EventSource` multiplies server subscribers and reconnect storms.

## Region endpoints: one query, every caller

One function per live region, one JSON route serving them all:

```ts
const regions: Record<string, (url: URL) => unknown> = {
  board:       () => db.query("SELECT * FROM evals ORDER BY id DESC").all(),
  summary:     () => db.query("SELECT COUNT(*) AS total, ... FROM evals").get(),
  "event-log": () => db.query("SELECT * FROM events ORDER BY id DESC LIMIT 25").all(),
};
// route: "/api/regions/:name" → regions[req.params.name](new URL(req.url))
```

The region query is the single source of truth for that panel: the mount fetch, every SSE refetch, and any terminal read hit the same SQL. Query params pass through the `URL` for filtered regions — `doc-review/server.ts` serves `annotations` with an optional `?status=open`.

## One mutation path — browser and terminal share it

Mutations are JSON POST endpoints returning `{ok: true}`; the browser and the terminal hit the **same** routes. There is no HTML-fragment response type. The browser does not update optimistically — it waits for the SSE round-trip, so the UI always shows what SQLite holds:

```ts
// browser side (templates/src/useRegion.ts)
export async function post(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
}
```

The canonical endpoint table (rename `items` to your domain):

| Endpoint                | Method | Caller            | Body → Response                                 |
| ----------------------- | ------ | ----------------- | ----------------------------------------------- |
| `/api/regions/:name`    | GET    | browser, terminal | → region JSON                                   |
| `/api/items/:id/status` | POST   | browser           | `{status, human_note}` → `{ok}` + publish       |
| `/api/items/ingest`     | POST   | terminal          | full object → `{ok, id}` + publish              |
| `/api/ask`              | POST   | browser           | `{body, kind}` → `{ok}` + publish               |
| `/claude/queue`         | GET    | terminal          | → `{requests}`; flips queued→working, publishes |
| `/claude/respond`       | POST   | terminal          | `{request_id, response}` → `{ok}` + publish     |
| `/events`               | GET    | browser           | the SSE stream                                  |

Validate server-side and reject bad writes with a real status code — `doc-review/server.ts` returns `409` when an annotation's quote doesn't match what its offsets slice out of the stored block text, instead of storing a drifted anchor.

## The two-way loop

The loop is what makes it a workbench, not a dashboard. Human acts in the browser (React `post()` → SQLite → publish); agent acts from the terminal (`bun run scripts/*.ts` → the same endpoints → SQLite → publish); both watch the same state repaint live.

The human→agent channel is the `requests` table (`queued → working → answered`) plus the queue/respond pair:

- `GET /claude/queue` returns queued requests AND flips them to `working` in the same call. **Pulling is claiming** — the human sees the badge move the moment the agent picks up.
- `POST /claude/respond` writes the answer, flips to `answered`, publishes.
- The agent reads back the human's decisions through a read endpoint (`/claude/feedback` in the eval viewer) or a filtered region (`/api/regions/annotations?status=open` in doc-review).

Trace one full round trip on paper before calling the loop closed: human clicks → row changes + SSE fires → terminal reads the change → terminal writes a response → SSE fires → browser shows it. If any leg is missing, you built a dashboard.

Terminal helpers are plain TypeScript run with `bun run` — global `fetch`, no dependency declarations of any kind (`eval-viewer/scripts/record-result.ts`, `doc-review/scripts/review.ts`). One-line confirmation per action; throw on non-2xx.

## Per-item events for write bursts

When the agent writes N rows in a burst, publishing the whole-board region N times refetches an entire list N times. For big boards, publish parameterized per-item events alongside the coarse ones:

```ts
publish(`item-${id}`);   // the row that changed — subscribe with useRegion(`item-${id}`)
publish("summary");      // cheap aggregates
```

Most workbenches never need this — a 25-row board refetch is ~2ms on loopback. Reach for it when a region's JSON runs to hundreds of KB.

## Seed data doctrine

Seed like a session in progress, not a cold start. Flat seed data makes the workbench look dead and leaves render paths unexercised. The eval viewer seeds mixed outcomes, one case whose note carries a fenced mermaid block (so the diagram path renders on first boot), and two prior runs so both charts draw (`eval-viewer/server.ts`). Seed at least one row that demonstrates every render capability the UI has. Guard the seed with a count check so `--hot` restarts don't duplicate.

## Security posture

Bind `hostname: "127.0.0.1"` explicitly. No auth, no TLS, no deploy story — the surface exists for one human at one terminal during one session, then gets deleted with its `.db` file. That disposability is also why `--hot` is safe: Claude reshapes the UI while you watch.

## Gotchas

- **`server.timeout(req, 0)` on `/events`** — without it Bun idle-times-out the stream and the page reconnect-storms.
- **Region name drift** (three-strings-match rule) renders as a silently frozen panel.
- **A mutation that forgets `publish()`** works but never repaints.
- **One `Database`, module-level.** A per-request connection is wasted work and defeats the WAL setup.
- **`useRegion` returns `null` first.** Components must tolerate the first paint having no data.
- **Anything that measures itself (mermaid, ECharts) must mount into a visible box.** Rendering into a collapsed or hidden container yields 0×0 output — mount detail content only while open (`Detail` in `eval-viewer/src/components/EvalBoard.tsx` conditionally renders the Collapsible body).
- **`bun --hot` re-runs module top-level code on every file save.** `CREATE TABLE IF NOT EXISTS` plus count-guarded seeds make that harmless; everything else top-level must be idempotent too.
