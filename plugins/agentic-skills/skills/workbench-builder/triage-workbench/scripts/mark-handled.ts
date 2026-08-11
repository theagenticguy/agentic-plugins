/**
 * Flip an item to `handled` — the agent's reply-detection verdict.
 *
 * The human already dealt with this upstream (sent the reply, reacted in the
 * thread, closed the task), so it should leave the queue without them clicking
 * anything. In a real session the detection is a follow-up MCP read: an
 * email_search for an outbound message in the same conversation, a
 * get_reactions on the Slack ts, a get_task on the Asana gid.
 *
 * Accepts a numeric local id or an upstream source_ref — the agent usually holds
 * the latter, since that is what the MCP tool returned.
 *
 * Zero dependencies: global fetch. Run:
 *   bun run scripts/mark-handled.ts 5 "replied 12 min after receipt"
 *   bun run scripts/mark-handled.ts 1754531200.481 "you reacted with :white_check_mark:"
 */
const BASE = "http://127.0.0.1:5065";

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const [ref, ...noteParts] = process.argv.slice(2);
if (ref === undefined) {
  console.log('usage: bun run scripts/mark-handled.ts <id|source_ref> "<note>"');
  process.exit(1);
}
const agent_note = noteParts.join(" ") || "detected as already handled upstream";

// A bare integer is a local id; anything else (a Slack ts, an Outlook message
// id, an Asana gid) is a source_ref. Slack timestamps contain a dot, so the
// test is "all digits", not "parses as a number".
const body = /^\d+$/.test(ref) ? { id: Number(ref), agent_note } : { source_ref: ref, agent_note };

const { id } = await post("/claude/mark-handled", body);
console.log(`#${id} → handled · ${agent_note}`);
console.log("it has left the inbox; the summary chart still counts it.");
