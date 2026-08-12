import { Fragment } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
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
      <Heading level={2}>Next 24 hours</Heading>
      {items !== null && items.length === 0 ? (
        <EmptyState title="Nothing due" description="No open item lands today." isCompact />
      ) : (
        // One grid across every row, not a stack of wrapping rows: the clock and
        // the badge get their own columns, so a title too long for one line wraps
        // inside its own cell instead of dropping below the time it belongs to.
        // `minmax(0, 1fr)` is what lets that cell shrink; `1fr` alone floors at
        // the longest title and pushes the rail past the column.
        // The clock is the schedule and the title is the commitment — both are
        // the row's data, so both read at body size, and the title wraps
        // unbounded: a line cap would hide the rest of a subject behind a hover
        // tooltip, which a keyboard or screen-reader user never reaches. The rail
        // only ever holds what is due inside 24h, so it cannot run long.
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "max-content max-content minmax(0, 1fr)",
            columnGap: 8,
            rowGap: 6,
            alignItems: "baseline",
          }}
        >
          {(items ?? []).map((item) => (
            <Fragment key={item.id}>
              <Text color="secondary" hasTabularNumbers>
                {item.due_at === null ? "--:--" : clock(item.due_at)}
              </Text>
              <Badge variant={SOURCE_BADGE[item.source]} label={item.source} />
              <Text>{item.title}</Text>
            </Fragment>
          ))}
        </div>
      )}
    </Card>
  );
}
