import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Table, pixel, proportional } from "@astryxdesign/core/Table";
import type { TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { post, useRegion } from "../useRegion";
import type { Decision, Row } from "../types";
import { EditableCell } from "./EditableCell";

const DECISIONS: readonly Decision[] = ["pending", "keep", "fix", "drop"];

/** ISO-8601 date-only. Anything else in the date column is dirt worth flagging. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Above this an expense is almost certainly cents-vs-dollars, not a real charge.
 *  A fixed threshold beats a computed one here: the point is to flag the planted
 *  outlier deterministically, not to do statistics in the browser. */
const OUTLIER_AMOUNT = 10_000;

const money = (v: number | null) =>
  v === null ? "" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Per-row triage verdict. A radio group, not three buttons: one tab stop per
 *  row instead of three, and the selected state is announced. */
function DecisionCell({ row }: { readonly row: Row }) {
  return (
    <SegmentedControl
      label={`Decision for ${row.name}`}
      size="sm"
      layout="fill"
      value={row.decision}
      onChange={(next) => {
        void post(`/api/rows/${row.id}/decision`, { decision: next }).catch(() => {});
      }}
      data-testid={`decision-${row.id}`}
    >
      {DECISIONS.map((d) => (
        <SegmentedControlItem key={d} value={d} label={d} />
      ))}
    </SegmentedControl>
  );
}

/**
 * The grid region: Astryx Table in data-driven mode, one renderCell per column.
 *
 * Every column carries an explicit width via proportional()/pixel() — a raw
 * number is a type error, and omitting width drops the 120px minimum that keeps
 * a column from squishing to nothing. Table wraps itself in an overflow-x: auto
 * scroll container, so the region root never overflows no matter how wide the
 * resolved table gets.
 */
export function Grid() {
  const rows = useRegion<Row[]>("grid");

  const columns: TableColumn<Row>[] = [
    {
      key: "id",
      header: "#",
      width: pixel(44),
      align: "end",
      renderCell: (row) => (
        <Text type="supporting" hasTabularNumbers>
          {row.id}
        </Text>
      ),
    },
    {
      key: "name",
      header: "Name",
      width: proportional(2),
      renderCell: (row) => (
        <EditableCell rowId={row.id} column="name" value={row.name} />
      ),
    },
    {
      key: "category",
      header: "Category",
      width: proportional(1),
      renderCell: (row) => (
        <HStack gap={1} vAlign="center">
          <EditableCell rowId={row.id} column="category" value={row.category} />
          {row.category === "" && <Badge variant="warning" label="empty" />}
        </HStack>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: pixel(140),
      align: "end",
      renderCell: (row) => (
        <HStack gap={1} vAlign="center" hAlign="end">
          {row.amount !== null && row.amount > OUTLIER_AMOUNT && (
            <Badge variant="error" label="outlier" />
          )}
          <EditableCell rowId={row.id} column="amount" value={money(row.amount)} align="end" />
        </HStack>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: pixel(150),
      renderCell: (row) => (
        <HStack gap={1} vAlign="center">
          <EditableCell rowId={row.id} column="date" value={row.date} />
          {row.date !== "" && !ISO_DATE.test(row.date) && (
            <Badge variant="warning" label="format" />
          )}
        </HStack>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      width: proportional(2),
      renderCell: (row) => (
        <EditableCell rowId={row.id} column="notes" value={row.notes} />
      ),
    },
    {
      key: "decision",
      header: "Decision",
      width: pixel(260),
      renderCell: (row) => <DecisionCell row={row} />,
    },
  ];

  // useRegion returns null until the first fetch lands — render the empty state,
  // never crash on a missing array.
  return (
    <div data-testid="grid" style={{ minWidth: 0 }}>
      <Table<Row>
        data={rows ?? []}
        columns={columns}
        idKey="id"
        density="compact"
        dividers="rows"
        hasHover
        verticalAlign="middle"
        emptyState={
          <EmptyState
            title={rows === null ? "Loading rows…" : "No rows yet"}
            description="Ingest with: bun run scripts/ingest-rows.ts"
            isCompact
          />
        }
      />
    </div>
  );
}
