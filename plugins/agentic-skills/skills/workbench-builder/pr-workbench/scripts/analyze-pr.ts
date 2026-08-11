/**
 * POST one whole analyzed PR into the room.
 *
 * The agent reads a real diff, classifies it, and posts the *structure* —
 * number, title, author, branch, summary markdown, files[], concerns[]. The
 * server upserts by number (children replaced through the CASCADE) and
 * recomputes collisions on every ingest, so re-analyzing a PR never leaves
 * stale files behind and never double-counts it in the collisions rail.
 *
 * Zero dependencies: global fetch, no dependency header of any kind.
 * Run: bun run scripts/analyze-pr.ts
 *      bun run scripts/analyze-pr.ts ./analysis.json    (a PR object, or an array)
 */
const BASE = "http://127.0.0.1:5051";

type PrPayload = {
  number: number;
  title: string;
  author?: string;
  branch?: string;
  summary?: string;
  state?: "open" | "draft" | "approved" | "changes";
  risk?: "high" | "medium" | "low";
  files?: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    kind?: "added" | "modified" | "deleted" | "renamed";
  }>;
  concerns?: Array<{
    severity?: "blocker" | "warn" | "nit";
    title: string;
    body?: string;
    path?: string;
  }>;
};

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
 * The demo payload. It deliberately collides on api/routes.py and
 * app/models.py — the two files the seeded set already contends over — so
 * running this script with the page open moves the collisions rail, not just
 * the fleet board.
 */
const DEMO: PrPayload = {
  number: 421,
  title: "Retry budget per acquirer",
  author: "kenji",
  branch: "feat/retry-budget",
  risk: "high",
  state: "open",
  summary: `Caps retries per acquirer per minute so a single degraded provider
cannot consume the whole worker pool. Budget is refilled on a leaky bucket and
exposed as \`payments_retry_budget_remaining\`.

- Budget lives beside the rate limiter, not in the charge path
- Exhausted budget parks the charge as \`retry_deferred\` instead of failing it
- Deferred charges drain oldest-first when the budget refills

\`\`\`python
if not budget.take(acquirer):
    return defer_charge(charge, reason="retry_budget_exhausted")
\`\`\``,
  files: [
    { path: "app/models.py", additions: 41, deletions: 8, kind: "modified" },
    { path: "api/routes.py", additions: 19, deletions: 5, kind: "modified" },
    { path: "app/retry_budget.py", additions: 143, deletions: 0, kind: "added" },
    { path: "config/limits.yaml", additions: 12, deletions: 0, kind: "modified" },
    { path: "tests/test_retry_budget.py", additions: 118, deletions: 0, kind: "added" },
  ],
  concerns: [
    {
      severity: "blocker",
      title: "Deferred charges have no drain worker",
      path: "app/retry_budget.py",
      body:
        "`defer_charge` writes the row but nothing consumes `retry_deferred`. "
        + "As written a budget exhaustion silently strands the charge.",
    },
    {
      severity: "warn",
      title: "Budget shares config/limits.yaml with #415",
      path: "config/limits.yaml",
      body: "Both PRs add top-level keys to the same file; the merge will conflict.",
    },
    {
      severity: "nit",
      title: "Metric name lacks a unit suffix",
      path: "app/retry_budget.py",
      body: "`payments_retry_budget_remaining` — remaining what? Name the unit.",
    },
  ],
};

const arg = process.argv[2];
let payloads: PrPayload[] = [DEMO];
if (arg) {
  const parsed = JSON.parse(await Bun.file(arg).text());
  payloads = Array.isArray(parsed) ? parsed : [parsed];
}

for (const pr of payloads) {
  const { id, created } = await post("/pr/ingest", pr);
  console.log(
    `${created ? "ingested" : "updated"} #${pr.number} "${pr.title}" `
      + `(id ${id}, ${pr.files?.length ?? 0} files, ${pr.concerns?.length ?? 0} concerns)`,
  );
}

// Read the contested files back: with the set now larger, this is what an
// analysis run should order its next pass by.
const collisions = (await (await fetch(`${BASE}/claude/collisions`)).json()) as Array<{
  path: string;
  n: number;
  churn: number;
}>;
console.log(`\n${collisions.length} contested file(s):`);
for (const c of collisions) {
  console.log(`  ${c.path} — ${c.n} PRs, ${c.churn} churn`);
}
