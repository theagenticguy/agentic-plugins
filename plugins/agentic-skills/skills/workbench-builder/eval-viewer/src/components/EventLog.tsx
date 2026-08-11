import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";

type Event = { id: number; kind: string; detail: string; created_at: string };

/** Append-only activity feed — newest 25 events, every actor visible. */
export function EventLog() {
  const events = useRegion<Event[]>("event-log");
  return (
    <VStack gap={1} data-testid="event-log">
      {(events ?? []).map((e) => (
        <Text key={e.id} size="sm" color="secondary" hasTabularNumbers>
          {e.created_at.slice(11, 19)} · {e.kind} · {e.detail}
        </Text>
      ))}
    </VStack>
  );
}
