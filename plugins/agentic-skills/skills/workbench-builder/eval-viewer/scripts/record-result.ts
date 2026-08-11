/**
 * Record one eval result (upsert by name) and optionally a run summary.
 * Zero dependencies — global fetch. Run:
 *   bun run scripts/record-result.ts <name> <pass|fail> [actual] [note]
 *   bun run scripts/record-result.ts --run <label> <passed> <failed> [seconds]
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

const args = process.argv.slice(2);
if (args[0] === "--run") {
  const [, label, passed, failed, seconds] = args;
  await post("/claude/run", {
    label,
    passed: Number(passed),
    failed: Number(failed),
    duration_s: Number(seconds ?? 0),
  });
  console.log(`run recorded: ${label} ${passed}/${Number(passed) + Number(failed)}`);
} else {
  const [name, outcome, actual = "", note = ""] = args;
  if (!name || !["pass", "fail", "pending"].includes(outcome)) {
    console.log("usage: record-result.ts <name> <pass|fail|pending> [actual] [note]");
    process.exit(1);
  }
  const { id } = await post("/claude/eval-result", {
    name,
    outcome,
    actual,
    claude_note: note,
  });
  console.log(`recorded #${id}: ${name} → ${outcome}`);
}
