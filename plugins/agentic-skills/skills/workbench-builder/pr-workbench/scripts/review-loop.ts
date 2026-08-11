/**
 * Answer the human's review questions.
 *
 * Pulling /claude/queue CLAIMS requests (queued → working), so the badge flips
 * in the browser the moment this runs — the human sees pickup before the
 * answer exists. Replace the canned answer with real work: read the regions,
 * inspect the diff, then respond.
 *
 * Zero dependencies: global fetch.
 * Run: bun run scripts/review-loop.ts          (drain once and exit)
 *      bun run scripts/review-loop.ts --watch  (poll every 3s)
 */
const BASE = "http://127.0.0.1:5051";

type Req = {
  id: number;
  kind: string;
  body: string;
  pr_id: number | null;
  pr_number: number | null;
};

type Collision = { path: string; n: number; churn: number; prs: string };

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

/**
 * Ground the answer in the room's own state instead of restating the question.
 * A per-PR ask gets that PR's overlap; a whole-set ask gets the contested
 * files — the same data the human is looking at, which is what makes the
 * answer checkable.
 */
async function answer(req: Req): Promise<string> {
  const collisions = (await get("/claude/collisions")) as Collision[];

  if (req.pr_id !== null) {
    const detail = await get(`/api/regions/pr-${req.pr_id}`);
    const contested: string[] = [
      ...new Set((detail.overlap as Array<{ path: string }>).map((o) => o.path)),
    ];
    const blockers = (detail.concerns as Array<{ severity: string; resolved: number }>).filter(
      (c) => c.severity === "blocker" && c.resolved === 0,
    ).length;
    return (
      `#${detail.pr.number}: ${detail.files.length} files, ${blockers} open blocker(s). `
      + (contested.length > 0
        ? `Contested with other PRs on ${contested.join(", ")} — rebase risk is there, not in the new files.`
        : "No file overlap with the rest of the set; it can land independently.")
    );
  }

  const hottest = collisions[0];
  return (
    `${collisions.length} contested file(s) across the set. `
    + (hottest
      ? `Hottest is ${hottest.path} (${hottest.n} PRs, ${hottest.churn} churn) — `
        + `land the smallest of those first so the rest rebase onto it.`
      : "No overlap: merge order is free.")
  );
}

async function drain(): Promise<number> {
  const { requests } = (await get("/claude/queue")) as { requests: Req[] };
  for (const req of requests) {
    console.log(`request #${req.id} (${req.kind}): ${req.body}`);
    await post("/claude/respond", { request_id: req.id, response: await answer(req) });
    console.log(`  answered #${req.id}`);
  }
  return requests.length;
}

if (process.argv.includes("--watch")) {
  console.log(`watching ${BASE}/claude/queue — ctrl-c to stop`);
  while (true) {
    await drain();
    await new Promise((res) => setTimeout(res, 3000));
  }
} else {
  const n = await drain();
  console.log(n === 0 ? "queue empty" : `drained ${n} request(s)`);
}
