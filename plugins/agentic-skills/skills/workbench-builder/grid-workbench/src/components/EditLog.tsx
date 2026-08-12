import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";
import type { CellEdit } from "../types";

/** Actor attribution is the whole point of this panel, so the two actors get
 *  visually distinct badges rather than a shared neutral one. */
const ACTOR_VARIANT = { human: "teal", agent: "purple" } as const;

/** Newest 25 cell edits from either actor. This is what makes the two-way loop
 *  legible: the human sees the agent's patches land here in real time and the
 *  agent's read of the same table sees the human's. */
export function EditLog() {
  const edits = useRegion<CellEdit[]>("edit-log");

  if (edits !== null && edits.length === 0) {
    return (
      <div data-testid="edit-log">
        <EmptyState title="No cell edits yet" description="Click a cell to edit it." isCompact />
      </div>
    );
  }

  return (
    // role="log" + aria-live="polite" is what makes an SSE repaint audible: the
    // agent's patches land here without any user action, and an append-only feed
    // announces just the new entries instead of re-reading the whole list.
    <VStack gap={1} role="log" aria-live="polite" data-testid="edit-log">
      {(edits ?? []).map((e) => (
        <HStack key={e.id} gap={1} vAlign="center" wrap="wrap">
          <Badge variant={ACTOR_VARIANT[e.actor]} label={e.actor} />
          {/* Timestamp, coordinates, and both values are the record itself, so
              they stay at body size; colour alone carries the hierarchy. */}
          <Text color="secondary" hasTabularNumbers>
            {e.created_at.slice(11, 19)}
          </Text>
          <Text>
            #{e.row_id} · {e.column}
          </Text>
          <Text type="code" color="secondary" hasStrikethrough={e.old_value !== ""}>
            {e.old_value === "" ? "∅" : e.old_value}
          </Text>
          <Text color="secondary">→</Text>
          <Text type="code">{e.new_value === "" ? "∅" : e.new_value}</Text>
        </HStack>
      ))}
    </VStack>
  );
}
