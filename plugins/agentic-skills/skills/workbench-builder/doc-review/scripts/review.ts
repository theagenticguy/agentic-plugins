/**
 * Terminal side of the doc-review loop. Zero dependencies — global fetch.
 *
 *   bun run scripts/review.ts list [open|resolved|wontfix]
 *   bun run scripts/review.ts show <id>
 *   bun run scripts/review.ts resolve <id> "<reply>"
 *   bun run scripts/review.ts wontfix <id> "<reply>"
 *   bun run scripts/review.ts reopen <id>
 *   bun run scripts/review.ts json            # raw dump for programmatic use
 *
 * Workflow: `list` the open annotations, edit the real source document to
 * address each, then `resolve` with a reply — the reviewer's page updates
 * live and the highlight clears.
 *
 * Transitions go through /claude, which logs them as agent work: an agent
 * resolve must not wake the wake-on-work watcher.
 */
const BASE = "http://127.0.0.1:5057";

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

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "list": {
    const status = args[0];
    const anns = await get(
      `/api/regions/annotations${status ? `?status=${status}` : ""}`,
    );
    for (const a of anns) {
      console.log(`#${a.id} [${a.status}] ${a.kind} on block ${a.block_id}: “${a.quote}”`);
      console.log(`    ${a.body}`);
      if (a.reply) console.log(`    ↳ ${a.reply}`);
    }
    if (anns.length === 0) console.log("(none)");
    break;
  }
  case "show": {
    const anns = await get("/api/regions/annotations");
    const a = anns.find((x: any) => x.id === Number(args[0]));
    console.log(JSON.stringify(a ?? null, null, 2));
    break;
  }
  case "resolve":
  case "wontfix": {
    const [id, reply = ""] = args;
    const status = cmd === "resolve" ? "resolved" : "wontfix";
    await post(`/claude/annotations/${id}/status`, { status, reply });
    console.log(`#${id} → ${status}`);
    break;
  }
  case "reopen": {
    await post(`/claude/annotations/${args[0]}/status`, { status: "open" });
    console.log(`#${args[0]} → open`);
    break;
  }
  case "json": {
    console.log(JSON.stringify(await get("/api/regions/annotations")));
    break;
  }
  default:
    console.log("usage: review.ts <list|show|resolve|wontfix|reopen|json> [args]");
}
