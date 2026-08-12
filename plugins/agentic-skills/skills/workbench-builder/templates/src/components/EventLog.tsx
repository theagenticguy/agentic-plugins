import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";

type Event = { id: number; kind: string; detail: string; created_at: string };

/** Append-only activity feed — the newest 25 events, every actor visible.
 *
 *  role="log" + aria-live="polite" is what makes an SSE repaint audible: entries
 *  arrive without any user action, and an append-only feed announces just the new
 *  ones instead of re-reading the whole list. Each entry stays on the body ramp —
 *  it is the record itself, not a caption on something else. */
export function EventLog() {
  const events = useRegion<Event[]>("event-log");
  return (
    <VStack gap={1} role="log" aria-live="polite" data-testid="event-log">
      {(events ?? []).map((e) => (
        <Text key={e.id} hasTabularNumbers>
          {e.created_at.slice(11, 19)} · {e.kind} · {e.detail}
        </Text>
      ))}
    </VStack>
  );
}
