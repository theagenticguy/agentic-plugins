/**
 * Watch the human's request queue and answer each request; also read back
 * verdicts via /claude/feedback. Pulling /claude/queue CLAIMS requests
 * (queued → working) — the badge flips in the browser the moment this runs.
 * Run: bun run scripts/review-loop.ts
 */
const BASE = "http://127.0.0.1:5050";

async function get(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

console.log(`watching ${BASE}/claude/queue — ctrl-c to stop`);
while (true) {
  const { requests } = await get("/claude/queue");
  for (const req of requests) {
    console.log(`request #${req.id}: ${req.body}`);
    // Replace with real work: inspect regions, re-run an eval, then respond.
    const feedback = await get("/claude/feedback");
    const response = `ack (${feedback.length} verdicts on file): ${req.body.slice(0, 50)}`;
    await post("/claude/respond", { request_id: req.id, response });
    console.log(`  answered #${req.id}`);
  }
  await new Promise((res) => setTimeout(res, 3000));
}
