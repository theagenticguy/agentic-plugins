import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { donutOption } from "./charts";
import { Board } from "./components/Board";
import { Chart } from "./components/Chart";
import { EventLog } from "./components/EventLog";
import { Queue } from "./components/Queue";
import { useRegion, useSseStatus } from "./useRegion";

type Summary = { total: number; open: number; accepted: number; rejected: number };

function SummaryPanel() {
  const s = useRegion<Summary>("summary");
  if (s === null || s.total === 0) return null;
  return (
    <Card data-testid="summary">
      <Heading level={2}>Status</Heading>
      <Chart
        option={donutOption({
          open: s.open ?? 0,
          accepted: s.accepted ?? 0,
          rejected: s.rejected ?? 0,
        })}
        height={220}
        testid="summary-chart"
      />
    </Card>
  );
}

export function App() {
  const sse = useSseStatus();
  return (
    // as="main" gives the page its one landmark, so AT can skip the chrome and
    // land on the board. Section headings are level 2 directly under the level-1
    // title — skipping a level breaks the outline screen readers navigate by.
    <VStack as="main" gap={3} padding={4}>
      <HStack gap={2} vAlign="center">
        <Heading level={1}>Workbench</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse}
          isPulsing={sse === "live"}
        />
        {/* A real caption about the page, so the supporting ramp fits. Data uses
            the body ramp — `type` carries size, weight, and colour together. */}
        <Text type="supporting">disposable · 127.0.0.1 · this session only</Text>
      </HStack>
      {/* Asymmetric two-column layout: Astryx Grid takes numeric columns only,
          so fr-ratio splits use plain CSS grid. minWidth:0 on the children
          keeps wide markdown/tables from blowing the layout open. */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          {/* The board's own heading. Item bodies render Markdown from
              headingLevelStart={3}, which needs a level 2 above it for the
              outline to descend one level at a time. */}
          <VStack gap={2}>
            <Heading level={2}>Items</Heading>
            <Board />
          </VStack>
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <SummaryPanel />
            <Card>
              <Heading level={2}>Ask the agent</Heading>
              <Queue />
            </Card>
            <Card>
              <Heading level={2}>Activity</Heading>
              <EventLog />
            </Card>
          </VStack>
        </div>
      </div>
    </VStack>
  );
}
