import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { STATUS_ORDER, stackedCountOption } from "../charts";
import { Chart } from "./Chart";
import { useRegion } from "../useRegion";
import type { SummaryRow } from "../types";

const SURFACES = ["email", "slack", "calendar", "asana"] as const;

/**
 * Source × status stacked bar.
 *
 * The region returns sparse (source, status, n) rows — SQL GROUP BY emits no row
 * for a pair with zero items — so the builder input is densified here: every
 * surface gets a bar, every status present anywhere gets a series with 0 where
 * it does not apply. Without that, ECharts would misalign the stacks against the
 * category axis.
 */
export function SourceSummary() {
  const rows = useRegion<SummaryRow[]>("source-summary");

  // The canvas has no readable text, so the counts it draws are spelled out for
  // the chart's aria-label — one clause per surface, statuses inline.
  const spoken = SURFACES.map((surface) => {
    const parts = (rows ?? [])
      .filter((r) => r.source === surface)
      .map((r) => `${r.n} ${r.status}`);
    return `${surface}: ${parts.length === 0 ? "none" : parts.join(", ")}`;
  }).join("; ");

  return (
    <Card data-testid="source-summary">
      <Heading level={2}>Load by surface</Heading>
      {rows === null || rows.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Ingest from the terminal to draw the chart."
          isCompact
        />
      ) : (
        <Chart
          option={stackedCountOption(
            [...SURFACES],
            Object.fromEntries(
              STATUS_ORDER.filter((status) => rows.some((r) => r.status === status)).map(
                (status) => [
                  status,
                  SURFACES.map(
                    (surface) =>
                      rows.find((r) => r.source === surface && r.status === status)?.n ?? 0,
                  ),
                ],
              ),
            ),
          )}
          height={240}
          testid="summary-chart"
          ariaLabel={`Item count by work surface and triage status. ${spoken}`}
        />
      )}
    </Card>
  );
}
