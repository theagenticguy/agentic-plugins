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
  const counts = { pass: s.pass ?? 0, fail: s.fail ?? 0, pending: s.pending ?? 0 };
  return (
    <Card data-testid="summary">
      <Heading level={2}>Outcomes</Heading>
      <Chart
        option={donutOption(counts)}
        label={`Outcomes across ${s.total} evals: ${counts.pass} pass, ${counts.fail} fail, ${counts.pending} pending.`}
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
      <Heading level={2}>Run history</Heading>
      <Chart
        option={stackedShareOption(labels, {
          passed: runs.map((r) => toPct(r.passed, r)),
          failed: runs.map((r) => toPct(r.failed, r)),
        })}
        label={`Pass share per run: ${runs
          .map((r) => `${r.label} ${toPct(r.passed, r)}%`)
          .join(", ")}.`}
        height={200}
        testid="run-chart"
      />
    </Card>
  );
}

export function App() {
  const sse = useSseStatus();
  return (
    // One `main` landmark wraps the whole surface: a workbench page has no nav
    // or sidebar, so every region a screen reader jumps to lives in here.
    <VStack as="main" gap={3} padding={4}>
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
          {/* Every column is a titled H2 section under the H1, so the outline
              never jumps a level and the board is reachable by heading. */}
          <VStack gap={2}>
            <Heading level={2}>Evals</Heading>
            <EvalBoard />
          </VStack>
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <OutcomeDonut />
            <RunHistory />
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
