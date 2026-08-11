import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";
import type { Item, Source, Status } from "../types";

// One non-semantic Badge colour per work surface. Semantic variants (success /
// error / warning) are reserved for state that demands attention — a source is
// a category tag, not a status, so it takes a colour variant.
const SOURCE_BADGE: Record<Source, "blue" | "purple" | "teal" | "orange"> = {
  email: "blue",
  slack: "purple",
  calendar: "teal",
  asana: "orange",
};

// Priority is the thing the eye should catch first, so it gets the StatusDot's
// semantic ramp: urgent reads as error, low recedes to neutral.
const PRIORITY_DOT: Record<number, "error" | "warning" | "accent" | "neutral"> = {
  1: "error",
  2: "warning",
  3: "accent",
  4: "neutral",
};
const PRIORITY_LABEL: Record<number, string> = {
  1: "urgent",
  2: "high",
  3: "normal",
  4: "low",
};

const TRIAGE_BADGE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  respond: "success",
  delegate: "info",
  defer: "warning",
  done: "neutral",
  ignore: "neutral",
};

/** "in 4h" / "3h overdue" — a due date only matters as distance from now. */
function dueChip(dueAt: string): string {
  const deltaH = Math.round((Date.parse(dueAt) - Date.now()) / 3_600_000);
  if (deltaH < 0) return `${Math.abs(deltaH)}h overdue`;
  if (deltaH === 0) return "due now";
  if (deltaH < 48) return `due in ${deltaH}h`;
  return `due in ${Math.round(deltaH / 24)}d`;
}

const ACTIONS: ReadonlyArray<{ status: Status; label: string }> = [
  { status: "respond", label: "Respond" },
  { status: "delegate", label: "Delegate" },
  { status: "defer", label: "Defer" },
  { status: "done", label: "Done" },
  { status: "ignore", label: "Ignore" },
];

/**
 * One queue item. The triage row stays visible without a click — a triage queue
 * is a one-decision-per-item surface, so hiding the verbs behind disclosure
 * would cost a click on every row. The optional note is what collapses.
 */
function ItemCard({ item }: { readonly item: Item }) {
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const triage = (status: Status) =>
    post(`/api/items/${item.id}/triage`, { status, human_note: note });

  return (
    <Card data-testid="inbox-item" data-source={item.source}>
      <VStack gap={1}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Badge
            variant={SOURCE_BADGE[item.source]}
            label={item.source}
            data-testid={`source-badge-${item.source}`}
          />
          <StatusDot
            variant={PRIORITY_DOT[item.priority] ?? "neutral"}
            label={PRIORITY_LABEL[item.priority] ?? "normal"}
          />
          {item.due_at !== null && (
            <Text size="sm" color="secondary" hasTabularNumbers>
              {dueChip(item.due_at)}
            </Text>
          )}
          {item.status !== "new" && (
            <Badge
              variant={TRIAGE_BADGE[item.status] ?? "neutral"}
              label={item.status}
              data-testid="triage-badge"
            />
          )}
        </HStack>

        <Text weight="semibold">{item.title}</Text>
        <Text size="sm" color="secondary">
          {item.sender}
          {item.kind !== "" ? ` · ${item.kind}` : ""}
        </Text>
        {item.body !== "" && <Text size="sm">{item.body}</Text>}
        {item.human_note !== "" && (
          <Text size="sm" color="accent">
            you: {item.human_note}
          </Text>
        )}
        {item.agent_note !== "" && (
          <Text size="sm" color="secondary">
            agent: {item.agent_note}
          </Text>
        )}

        <HStack gap={1} wrap="wrap">
          {ACTIONS.map((a) => (
            <Button
              key={a.status}
              size="sm"
              variant={a.status === "respond" ? "secondary" : "ghost"}
              label={a.label}
              data-testid={`triage-${a.status}`}
              onClick={() => triage(a.status)}
            />
          ))}
        </HStack>

        <Collapsible trigger="note" isOpen={noteOpen} onOpenChange={setNoteOpen}>
          {noteOpen && (
            <TextArea
              label={`Note for ${item.title}`}
              isLabelHidden
              placeholder="Optional note — posts with the next action…"
              rows={2}
              value={note}
              changeAction={(v) => setNote(v)}
            />
          )}
        </Collapsible>
      </VStack>
    </Card>
  );
}

/**
 * The queue, filtered by work surface.
 *
 * The filter drives a PARAMETERIZED region: useRegion("inbox", {source}) fetches
 * /api/regions/inbox?source=slack, while the SSE event name stays plain "inbox".
 * One publish("inbox") therefore invalidates every filtered view — a filtered
 * page refetches with its own params and stays live without the server tracking
 * who is looking at what.
 *
 * "All" passes `undefined` rather than {source: ""} so the request carries no
 * query string at all; the server treats absent and empty identically, and the
 * hook's cache key stays stable.
 */
export function InboxList() {
  const [source, setSource] = useState("");
  const items = useRegion<Item[]>("inbox", source === "" ? undefined : { source });

  return (
    <VStack gap={2} data-testid="inbox">
      <SegmentedControl
        value={source}
        onChange={setSource}
        label="Work surface"
        size="sm"
      >
        <SegmentedControlItem value="" label="All" />
        <SegmentedControlItem value="email" label="Email" />
        <SegmentedControlItem value="slack" label="Slack" />
        <SegmentedControlItem value="calendar" label="Calendar" />
        <SegmentedControlItem value="asana" label="Asana" />
      </SegmentedControl>

      {items !== null && items.length === 0 && (
        <EmptyState
          title="Queue clear"
          description="Nothing needs attention on this surface. Ingest more from the terminal: bun run scripts/ingest.ts"
        />
      )}
      {(items ?? []).map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </VStack>
  );
}
