import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useRegion } from "../useRegion";
import type { Item, Source } from "../types";

const SOURCE_BADGE: Record<Source, "blue" | "purple" | "teal" | "orange"> = {
  email: "blue",
  slack: "purple",
  calendar: "teal",
  asana: "orange",
};

/** HH:MM in local time — the rail is a clock view, not an audit trail. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Everything still open and due inside 24h, plus anything overdue — ordered by
 * due time so the rail reads as a schedule. Same `items` table as the inbox,
 * different question, so it is its own region rather than a client-side filter
 * of the inbox JSON: the filter belongs in SQL where the sort can use an index,
 * and it keeps working when the inbox is filtered to one surface.
 */
export function TodayRail() {
  const items = useRegion<Item[]>("today");

  return (
    <Card data-testid="today">
      <Heading level={3}>Next 24 hours</Heading>
      {items !== null && items.length === 0 ? (
        <EmptyState title="Nothing due" description="No open item lands today." isCompact />
      ) : (
        <VStack gap={1}>
          {(items ?? []).map((item) => (
            <HStack key={item.id} gap={2} vAlign="center" wrap="wrap">
              <Text size="sm" color="secondary" hasTabularNumbers>
                {item.due_at === null ? "--:--" : clock(item.due_at)}
              </Text>
              <Badge variant={SOURCE_BADGE[item.source]} label={item.source} />
              <Text size="sm" maxLines={2}>
                {item.title}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Card>
  );
}
