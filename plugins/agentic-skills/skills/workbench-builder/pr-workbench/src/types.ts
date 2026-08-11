/** Shapes returned by the region endpoints in server.ts. One place, so a
 *  schema change breaks compilation instead of rendering `undefined`. */

export type PrState = "open" | "draft" | "approved" | "changes";
export type Risk = "high" | "medium" | "low";
export type Severity = "blocker" | "warn" | "nit";

export type Overview = {
  n_prs: number;
  additions: number;
  deletions: number;
  blockers: number;
  n_collisions: number;
  open_requests: number;
};

export type FleetPr = {
  id: number;
  number: number;
  title: string;
  author: string;
  branch: string;
  state: PrState;
  risk: Risk;
  additions: number;
  deletions: number;
  updated_at: string;
  n_files: number;
  n_blocker: number;
  n_warn: number;
  n_nit: number;
};

/** `prs` arrives as GROUP_CONCAT'd `number|risk|state` triples — one query for
 *  the whole rail instead of one per hot file. */
export type Collision = {
  path: string;
  n: number;
  churn: number;
  prs: string;
};

export type PrFile = {
  id: number;
  pr_id: number;
  path: string;
  additions: number;
  deletions: number;
  kind: string;
};

export type Concern = {
  id: number;
  pr_id: number;
  severity: Severity;
  title: string;
  body: string;
  path: string;
  resolved: number;
};

export type Overlap = {
  path: string;
  number: number;
  title: string;
  risk: Risk;
  state: PrState;
  their_churn: number;
};

export type Request = {
  id: number;
  kind: string;
  body: string;
  pr_id: number | null;
  pr_number: number | null;
  status: "queued" | "working" | "answered";
  response: string;
  created_at: string;
};

export type PrDetail = {
  pr: {
    id: number;
    number: number;
    title: string;
    author: string;
    branch: string;
    summary: string;
    state: PrState;
    risk: Risk;
    additions: number;
    deletions: number;
    updated_at: string;
  };
  files: PrFile[];
  concerns: Concern[];
  overlap: Overlap[];
  requests: Request[];
};

/** Semantic scale for severity — these demand attention, per Astryx's own
 *  Badge guidance. Categorical hues for `state` so a reader never confuses the
 *  "is this contested" axis with the "where is this in review" axis. */
export const SEVERITY_BADGE: Record<Severity, "error" | "warning" | "neutral"> = {
  blocker: "error",
  warn: "warning",
  nit: "neutral",
};

export const STATE_BADGE: Record<PrState, "blue" | "neutral" | "green" | "orange"> = {
  open: "blue",
  draft: "neutral",
  approved: "green",
  changes: "orange",
};

export const RISK_BADGE: Record<Risk, "red" | "yellow" | "teal"> = {
  high: "red",
  medium: "yellow",
  low: "teal",
};

/** Parses one GROUP_CONCAT chip triple. */
export function parseChips(
  concat: string,
): Array<{ number: number; risk: Risk; state: PrState }> {
  return concat
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => {
      const [number, risk, state] = s.split("|");
      return { number: Number(number), risk: risk as Risk, state: state as PrState };
    })
    .sort((a, b) => a.number - b.number);
}
