/**
 * Answer the human's queued questions, grounding each answer in the triage
 * verdicts the human has already set. Pulling /claude/queue CLAIMS the requests
 * (queued → working), so the badge flips in the browser the moment this runs.
 *
 * Drains the queue once and exits. Pass --watch to poll every 3s instead.
 *
 * Run: bun run scripts/review-loop.ts [--watch]
 */
const BASE = "http://127.0.0.1:5062";

type Decided = {
  id: number;
  name: string;
  category: string;
  amount: number | null;
  date: string;
  decision: string;
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

async function post(path: string, body: unknown): Promise<void> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
}

/** The return leg of the loop: read back what the human decided in the browser.
 *  A real agent would act on these (fix the rows marked `fix`, delete the
 *  `drop`s); here the tally goes into the answer so the human can see the read
 *  actually happened. */
async function decisionTally(): Promise<string> {
  const decided = await get<Decided[]>("/claude/decisions");
  const counts = new Map<string, number>();
  for (const row of decided) counts.set(row.decision, (counts.get(row.decision) ?? 0) + 1);
  if (counts.size === 0) return "no decisions set yet";
  return [...counts].map(([d, n]) => `${n} ${d}`).join(", ");
}

async function drain(): Promise<number> {
  const { requests } = await get<{ requests: Array<{ id: number; body: string }> }>(
    "/claude/queue",
  );
  for (const req of requests) {
    console.log(`request #${req.id}: ${req.body}`);
    const tally = await decisionTally();
    await post("/claude/respond", {
      request_id: req.id,
      response: `read /claude/decisions — ${tally}. re: ${req.body.slice(0, 60)}`,
    });
    console.log(`  answered #${req.id}`);
  }
  return requests.length;
}

if (process.argv.includes("--watch")) {
  console.log(`watching ${BASE}/claude/queue — ctrl-c to stop`);
  for (;;) {
    await drain();
    await new Promise((res) => setTimeout(res, 3000));
  }
} else {
  const n = await drain();
  console.log(n === 0 ? "queue empty" : `answered ${n} request(s)`);
}
