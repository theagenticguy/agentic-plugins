/**
 * Patch one cell as the agent. The edit lands in cells_log with actor 'agent',
 * so the open browser repaints the cell AND the edit log with no reload.
 *
 * Run: bun run scripts/patch-cell.ts <row_id> <column> <value>
 * e.g. bun run scripts/patch-cell.ts 6 category conferences
 */
const BASE = "http://127.0.0.1:5062";

const [rowId, column, ...rest] = process.argv.slice(2);
const value = rest.join(" ");

if (rowId === undefined || column === undefined) {
  console.error("usage: bun run scripts/patch-cell.ts <row_id> <column> <value>");
  console.error("columns: name | category | amount | date | notes");
  process.exit(2);
}

const r = await fetch(`${BASE}/claude/patch-cell`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ row_id: Number(rowId), column, value }),
});
if (!r.ok) throw new Error(`patch-cell → ${r.status} ${await r.text()}`);

console.log(`patched row ${rowId}.${column} = ${JSON.stringify(value)}`);
