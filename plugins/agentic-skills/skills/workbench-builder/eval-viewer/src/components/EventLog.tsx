import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";

type Event = { id: number; kind: string; detail: string; created_at: string };

/** Append-only activity feed — newest 25 events, every actor visible.
 *
 *  Wrapped in role="log" with aria-live="polite": SSE appends rows with no
 *  reload, and a screen reader has no other way to learn that the agent just
 *  acted. Rows are body size, not supporting — an event line is the primary
 *  record of what happened, not a caption on something else. */
export function EventLog() {
  const events = useRegion<Event[]>("event-log");
  return (
    <div role="log" aria-live="polite" aria-label="Activity log">
      <VStack gap={1} data-testid="event-log">
        {(events ?? []).map((e) => (
          <Text key={e.id} color="secondary" hasTabularNumbers>
            {e.created_at.slice(11, 19)} · {e.kind} · {e.detail}
          </Text>
        ))}
      </VStack>
    </div>
  );
}
