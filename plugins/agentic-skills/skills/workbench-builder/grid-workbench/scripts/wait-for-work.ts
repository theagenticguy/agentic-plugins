/**
 * Wake-on-work watcher — the agent's ear on the workbench.
 *
 * An LLM agent cannot be pushed to; it can only block on a wait. This script
 * IS that wait: the agent launches it as a background command, and the exit
 * re-invokes the agent with the printed digest as its work order.
 *
 * Listens to the server's own SSE invalidation stream and exits (printing a
 * JSON digest to stdout) when EITHER:
 *   - a request is queued ("Hand batch to agent" button or a typed question)
 *     → reason "request", immediate — human intent skips the debounce;
 *   - grid edits go quiet for DEBOUNCE_MS and human edits sit past the
 *     watermark → reason "debounce" — the edit-free buffer.
 *
 * The script only listens and reports. Judgment — what the edits mean, how to
 * fix a flagged row — belongs to the agent it wakes.
 *
 * Run: bun run scripts/wait-for-human.ts   (WATCH_DEBOUNCE_MS to tune, default 20s)
 */
const BASE = "http://127.0.0.1:5062";
const DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE_MS ?? 20_000);

type Digest = {
  watermark: number;
  latest_log_id: number;
  edits: unknown[];
  fix_rows: unknown[];
  queued_requests: unknown[];
};

async function digest(): Promise<Digest> {
  const r = await fetch(`${BASE}/claude/digest`);
  if (!r.ok) throw new Error(`/claude/digest → ${r.status}`);
  return (await r.json()) as Digest;
}

function finish(reason: "request" | "debounce", d: Digest): never {
  console.log(JSON.stringify({ reason, ...d }, null, 2));
  process.exit(0);
}

/** A queued request always wakes the agent; quiet-period edits wake it only
 *  when the debounce timer (not a mid-burst queue event) asked the question. */
async function check(trigger: "debounce" | "queue"): Promise<void> {
  const d = await digest();
  if (d.queued_requests.length > 0) finish("request", d);
  if (trigger === "debounce" && d.edits.length > 0) finish("debounce", d);
}

let timer: ReturnType<typeof setTimeout> | null = null;
function arm() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void check("debounce"), DEBOUNCE_MS);
}

// Startup sweep: work that landed while nothing was listening. A queued
// request exits now; pending edits get one debounce period in case the human
// is mid-burst.
const d0 = await digest();
if (d0.queued_requests.length > 0) finish("request", d0);
if (d0.edits.length > 0) arm();
console.error(`listening on ${BASE}/events — debounce ${DEBOUNCE_MS}ms, watermark ${d0.watermark}`);

const res = await fetch(`${BASE}/events`);
if (!res.ok || res.body === null) throw new Error(`/events → ${res.status}`);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line.startsWith("event:")) continue;
    const event = line.slice("event:".length).trim();
    if (event === "queue") {
      await check("queue");
    } else if (event === "grid" || event === "edit-log" || event === "column-stats") {
      arm();
    }
  }
}
console.error("SSE stream closed — is the server down?");
process.exit(1);
