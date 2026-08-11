/**
 * Ingest a batch of rows as the agent. Each non-empty cell of each new row logs
 * a cells_log entry with actor 'agent', so an ingest reads as agent work in the
 * edit log instead of rows appearing from nowhere.
 *
 * The payload below is seed-shaped demo data with the same planted dirt as the
 * boot seed — an empty category and a malformed date — so the grid's badge paths
 * light up on ingested rows too. Replace it with real data in a live session.
 *
 * Run: bun run scripts/ingest-rows.ts
 */
const BASE = "http://127.0.0.1:5062";

const rows = [
  {
    name: "Rideshare to airport",
    category: "travel",
    amount: 38.75,
    date: "2026-07-20",
    notes: "ingested from the terminal",
  },
  {
    name: "Booth carpet rental",
    category: "",
    amount: 620.0,
    date: "2026-07-21",
    notes: "category unknown — needs triage",
  },
  {
    name: "Breakfast — hotel",
    category: "meals",
    amount: 22.4,
    date: "21/07/2026",
    notes: "date arrived day-first",
  },
];

const r = await fetch(`${BASE}/claude/ingest-rows`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ rows }),
});
if (!r.ok) throw new Error(`ingest-rows → ${r.status} ${await r.text()}`);

const { ids } = (await r.json()) as { ids: number[] };
console.log(`ingested ${ids.length} rows: ${ids.join(", ")}`);
