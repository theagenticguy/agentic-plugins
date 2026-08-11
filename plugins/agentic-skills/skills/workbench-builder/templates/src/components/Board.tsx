import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";

export type Item = {
  id: number;
  title: string;
  body: string;
  status: "open" | "accepted" | "rejected";
  human_note: string;
  result: string;
  agent_note: string;
  created_at: string;
};

const STATUS_BADGE: Record<Item["status"], "success" | "error" | "neutral"> = {
  accepted: "success",
  rejected: "error",
  open: "neutral",
};

/**
 * The main live region. Split ownership on each row: the human sets status
 * from here; result/agent_note arrive from the terminal. Both repaint through
 * the same SSE round-trip — no optimistic state.
 */
export function Board() {
  const items = useRegion<Item[]>("board");
  if (items === null) return null; // first fetch in flight
  if (items.length === 0) {
    return <EmptyState title="No items yet" description="Ingest from the terminal to populate the board." />;
  }
  return (
    <VStack gap={2} data-testid="board">
      {items.map((item) => (
        <Card key={item.id} data-testid="board-row">
          <VStack gap={1}>
            <HStack gap={2}>
              <Badge variant={STATUS_BADGE[item.status]} label={item.status} />
              <Text weight="semibold">{item.title}</Text>
            </HStack>
            {item.body !== "" && <Markdown headingLevelStart={3}>{item.body}</Markdown>}
            {item.result !== "" && (
              <Text color="secondary">agent: {item.result}</Text>
            )}
            <HStack gap={1}>
              <Button
                size="sm"
                variant="secondary"
                label="Accept"
                onClick={() => post(`/api/items/${item.id}/status`, { status: "accepted" })}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Reject"
                onClick={() => post(`/api/items/${item.id}/status`, { status: "rejected" })}
              />
            </HStack>
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
