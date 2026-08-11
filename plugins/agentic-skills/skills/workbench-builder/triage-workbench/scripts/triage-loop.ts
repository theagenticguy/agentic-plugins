/**
 * The agent side of the loop: read the human's triage decisions, then answer
 * whatever they queued up.
 *
 * Pulling /claude/queue CLAIMS requests (queued → working), so the badge flips
 * in the browser the moment this runs. /claude/decisions is the read-back
 * channel — every item the human gave a status, so the agent knows what to act
 * on next (draft the `respond` replies, hand off the `delegate` items, set
 * reminders for the `defer` ones).
 *
 * Zero dependencies: global fetch. Run:
 *   bun run scripts/triage-loop.ts          # one pass, then exit
 *   bun run scripts/triage-loop.ts --watch  # poll every 3s
 */
const BASE = "http://127.0.0.1:5065";

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

type Decision = {
  id: number;
  source: string;
  status: string;
  title: string;
  human_note: string;
  priority: number;
};

async function pass(): Promise<void> {
  const decisions: Decision[] = await get("/claude/decisions");
  console.log(`${decisions.length} decision(s) on file:`);
  for (const d of decisions) {
    const note = d.human_note === "" ? "" : ` — "${d.human_note}"`;
    console.log(`  #${d.id} ${d.source.padEnd(8)} p${d.priority} ${d.status.padEnd(8)} ${d.title.slice(0, 52)}${note}`);
  }

  const { requests } = await get("/claude/queue");
  for (const req of requests) {
    console.log(`request #${req.id}: ${req.body}`);
    // Replace with real work: read the item, draft the reply, call the MCP tool,
    // then mark-handled if the action closed the loop upstream.
    const byStatus = decisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    }, {});
    const shape =
      Object.entries(byStatus)
        .map(([s, n]) => `${n} ${s}`)
        .join(", ") || "nothing triaged yet";
    await post("/claude/respond", {
      request_id: req.id,
      response: `ack — queue reads: ${shape}. Re: ${req.body.slice(0, 60)}`,
    });
    console.log(`  answered #${req.id}`);
  }
}

if (process.argv.includes("--watch")) {
  console.log(`watching ${BASE}/claude/queue — ctrl-c to stop`);
  while (true) {
    await pass();
    await new Promise((res) => setTimeout(res, 3000));
  }
} else {
  await pass();
}
