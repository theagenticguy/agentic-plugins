import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { type Collision, parseChips, RISK_BADGE } from "../types";
import { useRegion } from "../useRegion";
import { Path } from "./Path";

/**
 * The collisions rail — the reason this room exists.
 *
 * Each row is a file more than one PR touches, which is a fact about the SET
 * of PRs: no per-PR page can produce it, and it is the merge-order risk. The
 * server's `GROUP BY path HAVING n > 1` already ranked the rows by contention
 * then churn, so the hottest file is the first thing read.
 *
 * Chips are clickable: from "api/routes.py is touched by four PRs" the next
 * question is always "which four, and what is #415 doing in there" — so the
 * chip opens that PR's detail rather than making the reader hunt the fleet
 * board for the number.
 */
export function Collisions({ onOpen }: { readonly onOpen: (number: number) => void }) {
  const rows = useRegion<Collision[]>("collisions");
  if (rows === null) return null;

  return (
    <Card data-testid="collisions" style={{ minWidth: 0 }}>
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={2}>Collisions</Heading>
          <Text type="supporting" as="div">
            files touched by more than one PR — merge-order risk
          </Text>
        </VStack>

        {rows.length === 0 ? (
          <EmptyState
            title="No collisions"
            description="Every PR in the set touches a disjoint file list."
            isCompact
          />
        ) : (
          rows.map((row) => (
            <VStack key={row.path} gap={1} data-testid="collision-row">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Badge variant="orange" label={`${row.n} PRs`} />
                <Path>{row.path}</Path>
              </HStack>
              <HStack gap={1} vAlign="center" wrap="wrap">
                <Text type="supporting" hasTabularNumbers>
                  {row.churn} churn
                </Text>
                {parseChips(row.prs).map((chip) => (
                  <button
                    key={chip.number}
                    type="button"
                    data-testid="collision-chip"
                    // The Badge reads "#412 changes", which names a PR but not
                    // what the chip does with it.
                    aria-label={`Review detail for pull request #${chip.number}, ${chip.state}, ${chip.risk} risk, touching ${row.path}`}
                    // data-wb-chip is the focus-ring hook: index.html paints the
                    // themed :focus-visible outline these bare buttons inherit
                    // from no Astryx control.
                    data-wb-chip
                    onClick={() => onOpen(chip.number)}
                    // A bare button reset: the Badge carries all the visual
                    // weight, this only supplies the click target and focus
                    // ring. Wrapping a Badge is the lightest path to a
                    // clickable chip — Badge has no onClick of its own.
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <Badge
                      variant={RISK_BADGE[chip.risk]}
                      label={`#${chip.number} ${chip.state}`}
                    />
                  </button>
                ))}
              </HStack>
            </VStack>
          ))
        )}
      </VStack>
    </Card>
  );
}
