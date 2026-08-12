import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { ColumnStats } from "./components/ColumnStats";
import { EditLog } from "./components/EditLog";
import { Grid } from "./components/Grid";
import { Queue } from "./components/Queue";
import { useSseStatus } from "./useRegion";

export function App() {
  const sse = useSseStatus();
  return (
    // as="main" gives the page its one landmark, so AT can skip straight to the
    // grid. Section headings are level 2 directly under the level-1 title —
    // skipping a level breaks the outline screen readers navigate by.
    <VStack as="main" gap={3} padding={4}>
      <HStack gap={2} vAlign="center">
        <Heading level={1}>Grid workbench</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse}
          isPulsing={sse === "live"}
        />
        <Text type="supporting">disposable · 127.0.0.1 · this session only</Text>
      </HStack>
      {/* Asymmetric split: the grid needs the room, the rails are fixed-purpose.
          Astryx Grid is numeric-columns only, so an fr-ratio split is plain CSS
          grid. minWidth:0 on both columns keeps a wide table from forcing the
          page wider than the viewport — grid items default to min-width:auto and
          refuse to shrink below their content. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            {/* padding={0} on purpose. Astryx Table's scroll wrapper bleeds
                outward by the container's --container-padding-inline-* vars so a
                table spans a padded Card edge-to-edge; with any padding here the
                bleed overshoots the region root inside it and the root reports a
                horizontal overflow. Zero padding zeroes the bleed. */}
            <Card padding={0}>
              <Grid />
            </Card>
            <Card>
              <Heading level={2}>Cell edits</Heading>
              <EditLog />
            </Card>
          </VStack>
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <Card>
              <Heading level={2}>Ask the agent</Heading>
              <Queue />
            </Card>
            <VStack gap={2}>
              <Heading level={2}>Column stats</Heading>
              <ColumnStats />
            </VStack>
          </VStack>
        </div>
      </div>
    </VStack>
  );
}
