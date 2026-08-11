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

  return (
    <Card data-testid="source-summary">
      <Heading level={3}>Load by surface</Heading>
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
        />
      )}
    </Card>
  );
}
