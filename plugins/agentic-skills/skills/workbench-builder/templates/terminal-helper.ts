/**
 * Terminal side of the two-way loop. Zero dependencies — global fetch only.
 * Run: `bun run scripts/terminal-helper.ts <command>`
 *
 * Two patterns every workbench wants:
 *   1. One-shot ingest/update — push analyzed work into the board.
 *   2. Queue loop — pull the human's questions, answer them.
 *
 * The browser repaints on every call via the server's publish(); nothing here
 * touches the DOM or the database directly.
 */
const BASE = "http://127.0.0.1:5050";

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// --- Pattern 1: one-shot ingest ---------------------------------------------
async function ingest(title: string, body: string) {
  const { id } = await post("/api/items/ingest", { title, body });
  console.log(`ingested #${id}: ${title}`);
}

// --- Pattern 2: queue loop ---------------------------------------------------
// Pulling /claude/queue CLAIMS the requests (queued → working); the human sees
// the badge flip the moment this runs. Answer each, then poll again.
async function queueLoop(pollMs = 3000) {
  console.log(`watching ${BASE}/claude/queue — ctrl-c to stop`);
  while (true) {
    const { requests } = await get("/claude/queue");
    for (const req of requests) {
      console.log(`request #${req.id}: ${req.body}`);
      // Replace with real work: read the DB via a region endpoint, run an
      // analysis, then respond. The demo answer keeps the loop testable.
      const response = `ack: ${req.body.slice(0, 60)}`;
      await post("/claude/respond", { request_id: req.id, response });
      console.log(`  answered #${req.id}`);
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
}

// --- CLI ---------------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "ingest":
    await ingest(args[0] ?? "Untitled", args[1] ?? "");
    break;
  case "loop":
    await queueLoop();
    break;
  case "status": {
    const summary = await get("/api/regions/summary");
    console.log(JSON.stringify(summary));
    break;
  }
  default:
    console.log("usage: bun run terminal-helper.ts <ingest|loop|status> [args]");
}
