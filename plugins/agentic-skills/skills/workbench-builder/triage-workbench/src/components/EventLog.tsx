import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";
import type { Event } from "../types";

/**
 * Append-only activity feed — newest 25 events, both actors visible in one
 * column so a human decision and the agent's mark-handled interleave.
 *
 * role="log" plus aria-live="polite" is the right shape for an append-only feed:
 * a screen reader hears each arriving entry once, after whatever the reader is
 * doing, instead of being interrupted. The rows are keyed by event id, so an
 * invalidation inserts one node at the top and leaves the rest of the DOM
 * untouched — the announcement is the new entry, not a replay of all 25.
 *
 * A log entry is the record of what happened, not a caption on something else,
 * so it reads at body size.
 */
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
