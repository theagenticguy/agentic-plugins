import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { Overview as OverviewData } from "../types";
import { useRegion } from "../useRegion";

/** One stat. `hasTabularNumbers` keeps the digits from reflowing the row when a
 *  number changes width mid-ingest (4 → 12 collisions). */
function Stat({
  label,
  value,
  tone = "primary",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "primary" | "accent" | "secondary";
}) {
  return (
    <VStack gap={0.5}>
      <Text size="2xl" weight="bold" color={tone} hasTabularNumbers as="div">
        {value}
      </Text>
      <Text type="supporting" as="div">
        {label}
      </Text>
    </VStack>
  );
}

/**
 * The overview strip: one aggregate query, six scalars.
 *
 * These numbers exist to be cross-checked against the panels below them —
 * `n_collisions` is computed from the same `HAVING n > 1` subquery the
 * collisions rail runs, so the strip and the rail cannot disagree even
 * mid-ingest.
 */
export function Overview() {
  const o = useRegion<OverviewData>("overview");
  return (
    <Card data-testid="overview" variant="muted">
      {o === null ? (
        <Text type="supporting">loading…</Text>
      ) : (
        <HStack gap={6} vAlign="center" wrap="wrap">
          <Stat label="pull requests" value={String(o.n_prs)} />
          <Stat label="lines added" value={`+${o.additions}`} />
          <Stat label="lines removed" value={`−${o.deletions}`} />
          <Stat
            label="open blockers"
            value={String(o.blockers)}
            tone={o.blockers > 0 ? "accent" : "secondary"}
          />
          <Stat
            label="colliding files"
            value={String(o.n_collisions)}
            tone={o.n_collisions > 0 ? "accent" : "secondary"}
          />
          <Stat label="open asks" value={String(o.open_requests)} tone="secondary" />
        </HStack>
      )}
    </Card>
  );
}
