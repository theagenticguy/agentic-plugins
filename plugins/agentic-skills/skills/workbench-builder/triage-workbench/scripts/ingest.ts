/**
 * Push a batch of normalized items into the triage queue.
 *
 * In a real session the payload comes from MCP tools — aws-outlook-mcp
 * email_inbox / calendar_view, slack-mcp get_unreads, asana-mcp list_tasks —
 * normalized to the shape below. The demo payload here carries believable
 * content so the surface exercises every render path on first run.
 *
 * Zero dependencies: global fetch. Run:
 *   bun run scripts/ingest.ts            # the full demo batch
 *   bun run scripts/ingest.ts slack      # only the slack items
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

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

type Incoming = {
  source: "email" | "slack" | "calendar" | "asana";
  source_ref: string;
  kind: string;
  title: string;
  body: string;
  sender: string;
  due_at: string | null;
  priority: 1 | 2 | 3 | 4;
  agent_note?: string;
};

const BATCH: Incoming[] = [
  {
    source: "email",
    source_ref: "AAMkAG-77",
    kind: "thread",
    title: "Security questionnaire — 14 open rows before signature",
    body: "Their vendor-risk team needs the residency and key-management rows filled before the MSA can be signed. They flagged rows 4 and 9 as blockers.",
    sender: "vendor.risk@northwind.example",
    due_at: inHours(26),
    priority: 1,
    agent_note: "Rows 4 and 9 map to answers already written in the last questionnaire.",
  },
  {
    source: "slack",
    source_ref: "1754540311.204",
    kind: "mention",
    title: "@laith the gym-builder kappa floor — 0.6 or 0.7?",
    body: "In #ai-eng-namer: the panel judge is landing at 0.63 and they want to know whether that ships or blocks.",
    sender: "sanjana.k",
    due_at: inHours(3),
    priority: 2,
  },
  {
    source: "calendar",
    source_ref: "AAMkCal-45",
    kind: "meeting",
    title: "Customer workshop dry-run — you present section 2",
    body: "90 min. Section 2 is the eval-gym walkthrough; the deck placeholder is still empty.",
    sender: "team-namer@example",
    due_at: inHours(14),
    priority: 1,
  },
  {
    source: "asana",
    source_ref: "1209887766559012",
    kind: "task",
    title: "Write the non-inferiority test for the cost-at-iso-quality run",
    body: "Sprint commitment; blocked on nothing. Workstream: AI Engineering.",
    sender: "laith (self-assigned)",
    due_at: inHours(60),
    priority: 3,
  },
];

const only = process.argv[2];
const items = only === undefined ? BATCH : BATCH.filter((i) => i.source === only);
if (items.length === 0) {
  console.log(`no demo items for source ${JSON.stringify(only)}`);
  console.log("usage: bun run scripts/ingest.ts [email|slack|calendar|asana]");
  process.exit(1);
}

const { ids } = await post("/claude/ingest", { items });
console.log(`ingested ${ids.length} item(s) → ids ${ids.join(", ")}`);
for (const i of items) console.log(`  ${i.source.padEnd(8)} p${i.priority}  ${i.title}`);
