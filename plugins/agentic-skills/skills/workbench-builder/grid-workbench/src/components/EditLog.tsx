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
    <VStack gap={1} data-testid="edit-log">
      {(edits ?? []).map((e) => (
        <HStack key={e.id} gap={1} vAlign="center" wrap="wrap">
          <Badge variant={ACTOR_VARIANT[e.actor]} label={e.actor} />
          <Text type="supporting" hasTabularNumbers>
            {e.created_at.slice(11, 19)}
          </Text>
          <Text type="supporting">
            #{e.row_id} · {e.column}
          </Text>
          <Text type="code" color="secondary" hasStrikethrough={e.old_value !== ""}>
            {e.old_value === "" ? "∅" : e.old_value}
          </Text>
          <Text type="supporting">→</Text>
          <Text type="code">{e.new_value === "" ? "∅" : e.new_value}</Text>
        </HStack>
      ))}
    </VStack>
  );
}
