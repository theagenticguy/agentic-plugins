import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { donutOption, stackedShareOption } from "./charts";
import { Chart } from "./components/Chart";
import { EvalBoard } from "./components/EvalBoard";
import { EventLog } from "./components/EventLog";
import { Queue } from "./components/Queue";
import { useRegion, useSseStatus } from "./useRegion";

type Summary = { total: number; pass: number; fail: number; pending: number };
type Run = { id: number; label: string; passed: number; failed: number; duration_s: number };

function OutcomeDonut() {
  const s = useRegion<Summary>("summary");
  if (s === null || s.total === 0) return null;
  return (
    <Card data-testid="summary">
      <Heading level={3}>Outcomes</Heading>
      <Chart
        option={donutOption({ pass: s.pass ?? 0, fail: s.fail ?? 0, pending: s.pending ?? 0 })}
        height={200}
        testid="summary-chart"
      />
    </Card>
  );
}

function RunHistory() {
  const runs = useRegion<Run[]>("run-history");
  if (runs === null || runs.length === 0) return null;
  const labels = runs.map((r) => r.label);
  const toPct = (n: number, r: Run) =>
    r.passed + r.failed === 0 ? 0 : Math.round((n / (r.passed + r.failed)) * 1000) / 10;
  return (
    <Card data-testid="run-history">
      <Heading level={3}>Run history</Heading>
      <Chart
        option={stackedShareOption(labels, {
          passed: runs.map((r) => toPct(r.passed, r)),
          failed: runs.map((r) => toPct(r.failed, r)),
        })}
        height={200}
        testid="run-chart"
      />
    </Card>
  );
}

export function App() {
  const sse = useSseStatus();
  return (
    <VStack gap={3} padding={4}>
      <HStack gap={2} vAlign="center">
        <Heading level={1}>Eval viewer</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse}
          isPulsing={sse === "live"}
        />
        <Text size="sm" color="secondary">
          disposable · 127.0.0.1 · this session only
        </Text>
      </HStack>
      {/* Asymmetric split needs plain CSS grid (Astryx Grid is numeric-columns
          only). minWidth:0 keeps wide markdown from blowing the layout open. */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <EvalBoard />
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <OutcomeDonut />
            <RunHistory />
            <Card>
              <Heading level={3}>Ask the agent</Heading>
              <Queue />
            </Card>
            <Card>
              <Heading level={3}>Activity</Heading>
              <EventLog />
            </Card>
          </VStack>
        </div>
      </div>
    </VStack>
  );
}
