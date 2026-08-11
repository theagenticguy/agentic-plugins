/** Shapes returned by the region endpoints in server.ts. */

export type Source = "email" | "slack" | "calendar" | "asana";

export type Status =
  | "new"
  | "respond"
  | "delegate"
  | "defer"
  | "done"
  | "ignore"
  | "handled";

export type Item = {
  id: number;
  source: Source;
  source_ref: string;
  kind: string;
  title: string;
  body: string;
  sender: string;
  due_at: string | null;
  priority: 1 | 2 | 3 | 4;
  status: Status;
  human_note: string;
  agent_note: string;
  ingested_at: string;
  handled_at: string | null;
};

/** One row per (source, status) pair with a count — the stacked bar's input. */
export type SummaryRow = { source: Source; status: Status; n: number };

export type Event = { id: number; kind: string; detail: string; created_at: string };
