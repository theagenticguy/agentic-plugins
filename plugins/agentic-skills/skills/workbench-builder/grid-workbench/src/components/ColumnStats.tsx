import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";
import type { ColumnStat } from "../types";

const num = (v: number | null) =>
  v === null
    ? "—"
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One label/value pair. Tabular numbers so the values align down the rail.
 *  Both halves are body-size: the label names a real statistic and the value is
 *  the statistic, neither is a caption on something else. */
function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <HStack gap={2} hAlign="between" vAlign="center">
      <Text color="secondary">{label}</Text>
      <Text hasTabularNumbers>{value}</Text>
    </HStack>
  );
}

/**
 * Per-column stats, one Card per column. Every number here comes from the
 * column-stats SQL region — the client does no counting, so the rail cannot
 * disagree with the grid it describes.
 */
export function ColumnStats() {
  const stats = useRegion<ColumnStat[]>("column-stats");

  return (
    <VStack gap={2} data-testid="column-stats">
      {(stats ?? []).map((s) => (
        <Card key={s.column} padding={2} variant={s.empties > 0 ? "muted" : "default"}>
          <VStack gap={1}>
            <HStack gap={1} vAlign="center" hAlign="between">
              <Text weight="semibold">{s.column}</Text>
              {s.empties > 0 && (
                <Badge
                  variant="warning"
                  label={`${s.empties} ${s.kind === "number" ? "null" : "empty"}`}
                />
              )}
            </HStack>
            <Stat label="rows" value={num(s.n)} />
            <Stat label="distinct" value={num(s.distinct_n)} />
            {s.kind === "number" && (
              <>
                <Stat label="min" value={num(s.min_v)} />
                <Stat label="max" value={num(s.max_v)} />
                <Stat label="avg" value={num(s.avg_v)} />
              </>
            )}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
