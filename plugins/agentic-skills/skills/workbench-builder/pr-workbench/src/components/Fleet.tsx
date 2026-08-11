import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { type FleetPr, RISK_BADGE, STATE_BADGE } from "../types";
import { useRegion } from "../useRegion";
import { Churn } from "./Churn";

/**
 * The fleet board — one Card per PR, sorted risk-then-churn by the server
 * (`FLEET_SQL`), never re-sorted here. Keeping the order in SQL means the
 * board, the terminal's `/claude/collisions` read, and any future export
 * agree on "which PR is scariest" without a second ranking rule to keep in
 * sync.
 */
export function Fleet({ onOpen }: { readonly onOpen: (id: number) => void }) {
  const prs = useRegion<FleetPr[]>("fleet");
  if (prs === null) return null;
  if (prs.length === 0) {
    return (
      <EmptyState
        title="No pull requests yet"
        description="Ingest one from the terminal: bun run scripts/analyze-pr.ts"
      />
    );
  }
  // Shared denominator so the churn bars are comparable down the column.
  const maxChurn = Math.max(...prs.map((p) => p.additions + p.deletions), 1);

  return (
    // minWidth:0 — a grid item defaults to min-width:auto and would refuse to
    // shrink below its longest branch name, pushing the whole board wide.
    <VStack gap={2} data-testid="fleet" style={{ minWidth: 0 }}>
      {prs.map((pr) => (
        <Card key={pr.id} data-testid="fleet-card">
          <VStack gap={1.5}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Badge variant={RISK_BADGE[pr.risk]} label={`${pr.risk} risk`} />
              <Badge variant={STATE_BADGE[pr.state]} label={pr.state} />
              <Text weight="semibold" hasTabularNumbers>
                #{pr.number}
              </Text>
              <Text maxLines={1}>{pr.title}</Text>
            </HStack>

            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text size="xsm" color="secondary">
                {pr.author} · {pr.branch}
              </Text>
              <Text size="xsm" color="secondary" hasTabularNumbers>
                {pr.n_files} file{pr.n_files === 1 ? "" : "s"}
              </Text>
              <Churn
                additions={pr.additions}
                deletions={pr.deletions}
                max={maxChurn}
              />
            </HStack>

            <HStack gap={1} vAlign="center" wrap="wrap">
              {/* Severity counts, not one badge per concern: a PR with 9 nits
                  should not out-shout a PR with 1 blocker. Zero counts are
                  omitted so a clean PR reads as clean. */}
              {pr.n_blocker > 0 && (
                <Badge variant="error" label={`${pr.n_blocker} blocker`} />
              )}
              {pr.n_warn > 0 && <Badge variant="warning" label={`${pr.n_warn} warn`} />}
              {pr.n_nit > 0 && <Badge variant="neutral" label={`${pr.n_nit} nit`} />}
              {pr.n_blocker + pr.n_warn + pr.n_nit === 0 && (
                <Text size="xsm" color="secondary">
                  no open concerns
                </Text>
              )}
              <Button
                size="sm"
                variant="ghost"
                label="detail"
                onClick={() => onOpen(pr.id)}
              />
            </HStack>
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
