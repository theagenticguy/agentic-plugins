import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { EventLog } from "./components/EventLog";
import { InboxList } from "./components/InboxList";
import { Queue } from "./components/Queue";
import { SourceSummary } from "./components/SourceSummary";
import { TodayRail } from "./components/TodayRail";
import { useSseStatus } from "./useRegion";

export function App() {
  const sse = useSseStatus();
  return (
    <VStack as="main" gap={3} padding={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>Triage</Heading>
        {/* The dot carries the colour, the word beside it carries the meaning —
            a stream that has dropped must be legible without colour vision. The
            visible word is aria-hidden so the dot's aria-label stays the single
            announcement instead of doubling it. */}
        <HStack gap={1} vAlign="center">
          <StatusDot
            variant={sse === "live" ? "success" : "error"}
            label={`event stream ${sse}`}
            isPulsing={sse === "live"}
          />
          <span aria-hidden="true">
            <Text size="sm" color="secondary">
              {sse}
            </Text>
          </span>
        </HStack>
        <Text size="sm" color="secondary">
          email · slack · calendar · asana — only what still needs you
        </Text>
      </HStack>

      {/* Asymmetric split needs plain CSS grid (Astryx Grid is numeric-columns
          only). minWidth:0 stops long subject lines and bodies from refusing to
          shrink and blowing the column open. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <InboxList />
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <SourceSummary />
            <TodayRail />
            {/* Every panel title is an h2: the page has one h1 and four sibling
                sections, so the outline must not skip a rung. */}
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
