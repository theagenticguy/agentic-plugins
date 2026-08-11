/**
 * Region JSON shapes. `Row` extends Record<string, unknown> because Astryx
 * Table constrains `T extends Record<string, unknown>` — a plain object type is
 * a compile error at the Table<Row> instantiation.
 */

export type Decision = "pending" | "keep" | "fix" | "drop";

/** One editable data column. `decision` is excluded: it has its own endpoint and
 *  never enters cells_log, so it is not a cell in the editing sense. */
export type EditableColumn = "name" | "category" | "amount" | "date" | "notes";

export interface Row extends Record<string, unknown> {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly amount: number | null;
  readonly date: string;
  readonly notes: string;
  readonly decision: Decision;
  readonly updated_at: string;
}

/** One UNION ALL branch of the column-stats query. Numeric fields are null on
 *  text columns — the server decides what is measurable, not the client. */
export type ColumnStat = {
  readonly column: string;
  readonly kind: "text" | "number";
  readonly n: number;
  readonly empties: number;
  readonly distinct_n: number;
  readonly min_v: number | null;
  readonly max_v: number | null;
  readonly avg_v: number | null;
};

export type CellEdit = {
  readonly id: number;
  readonly row_id: number;
  readonly column: string;
  readonly old_value: string;
  readonly new_value: string;
  readonly actor: "human" | "agent";
  readonly created_at: string;
  readonly row_name: string | null;
};

export type Request = {
  readonly id: number;
  readonly kind: string;
  readonly body: string;
  readonly status: "queued" | "working" | "answered";
  readonly response: string;
};
