import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";
import type { Event } from "../types";

/** Append-only activity feed — newest 25 events, both actors visible in one
 *  column so a human decision and the agent's mark-handled interleave. */
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
