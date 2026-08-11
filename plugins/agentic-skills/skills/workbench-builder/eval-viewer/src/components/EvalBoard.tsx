import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { Mermaid } from "./Mermaid";
import { post, useRegion } from "../useRegion";

export type Eval = {
  id: number;
  name: string;
  prompt: string;
  expected: string;
  actual: string;
  claude_note: string;
  outcome: "pending" | "pass" | "fail";
  status: "unreviewed" | "approved" | "flagged";
  human_note: string;
};

const OUTCOME_BADGE: Record<Eval["outcome"], "success" | "error" | "neutral"> = {
  pass: "success",
  fail: "error",
  pending: "neutral",
};

/** Splits a note into markdown and mermaid segments so fenced mermaid blocks
 *  render as diagrams instead of code. */
function NoteBody({ note }: { readonly note: string }) {
  const parts = note.split(/```mermaid\n([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Mermaid key={i} source={part} />
        ) : part.trim() !== "" ? (
          <Markdown key={i} headingLevelStart={4} density="compact">
            {part}
          </Markdown>
        ) : null,
      )}
    </>
  );
}

function VerdictBar({ ev }: { readonly ev: Eval }) {
  const [note, setNote] = useState("");
  const verdict = (status: string) =>
    post(`/api/evals/${ev.id}/status`, { status, human_note: note });
  return (
    <VStack gap={1}>
      <TextArea
        label={`Note for ${ev.name}`}
        isLabelHidden
        placeholder="Optional verdict note…"
        rows={1}
        value={note}
        changeAction={(v) => setNote(v)}
      />
      <HStack gap={1}>
        <Button size="sm" variant="secondary" label="Approve" onClick={() => verdict("approved")} />
        <Button size="sm" variant="ghost" label="Flag" onClick={() => verdict("flagged")} />
      </HStack>
    </VStack>
  );
}

/** Detail mounts only while open: mermaid (and anything else that measures
 *  itself) must render into a visible box, not a collapsed 0-height one. */
function Detail({ ev }: { readonly ev: Eval }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible trigger="detail" isOpen={isOpen} onOpenChange={setIsOpen}>
      {isOpen && (
        <VStack gap={1}>
          <Text size="sm" color="secondary">prompt: {ev.prompt}</Text>
          <Text size="sm" color="secondary">expected: {ev.expected}</Text>
          <Text size="sm">actual: {ev.actual}</Text>
          {ev.claude_note !== "" && <NoteBody note={ev.claude_note} />}
          {ev.human_note !== "" && (
            <Text size="sm" color="accent">you: {ev.human_note}</Text>
          )}
          <VerdictBar ev={ev} />
        </VStack>
      )}
    </Collapsible>
  );
}

/**
 * The eval board. Split ownership per row: outcome/actual/claude_note arrive
 * from the terminal, status/human_note from the verdict bar here. Both paint
 * through the same SSE round-trip.
 */
export function EvalBoard() {
  const evals = useRegion<Eval[]>("board");
  if (evals === null) return null;
  if (evals.length === 0) {
    return (
      <EmptyState
        title="No evals yet"
        description="Record results from the terminal: bun run scripts/record-result.ts"
      />
    );
  }
  return (
    <VStack gap={2} data-testid="board">
      {evals.map((ev) => (
        <Card key={ev.id} data-testid="board-row">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Badge variant={OUTCOME_BADGE[ev.outcome]} label={ev.outcome} />
              <Text weight="semibold">{ev.name}</Text>
              {ev.status !== "unreviewed" && (
                <Badge
                  variant={ev.status === "approved" ? "success" : "warning"}
                  label={ev.status}
                />
              )}
            </HStack>
            <Detail ev={ev} />
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
