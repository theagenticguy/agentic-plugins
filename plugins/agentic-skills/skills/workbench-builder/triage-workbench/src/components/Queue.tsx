import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";

type Req = {
  id: number;
  kind: string;
  body: string;
  status: "queued" | "working" | "answered";
  response: string;
};

const STATUS_BADGE: Record<Req["status"], "neutral" | "warning" | "success"> = {
  queued: "neutral",
  working: "warning",
  answered: "success",
};

/** Human→agent channel: ask inserts queued; the agent's pull claims (queued →
 *  working, so the badge moves the moment it picks up); respond completes.
 *  "Hand batch to agent" is the same channel with kind 'process-edits' — the
 *  wake-on-work watcher (scripts/wait-for-work.ts) exits on it immediately,
 *  skipping the debounce wait on a batch of triage decisions. */
export function Queue() {
  const requests = useRegion<Req[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim() });
    setDraft("");
  };

  const handBatch = async () => {
    await post("/api/ask", { body: "Process my batched triage decisions", kind: "process-edits" });
  };

  return (
    <VStack gap={2} data-testid="queue">
      <Button label="Hand batch to agent" clickAction={handBatch} data-testid="hand-to-agent" />
      <HStack gap={1} vAlign="end">
        <TextArea
          {...{ autoComplete: "off", "data-lpignore": "true" }}
          label="Ask the agent"
          isLabelHidden
          placeholder="Ask the agent about an item…"
          rows={2}
          value={draft}
          changeAction={(v) => setDraft(v)}
        />
        <Button label="Ask" data-testid="ask-button" clickAction={ask} />
      </HStack>
      {/* An agent answer lands here without the reader asking again, so the rows
          are a log: polite so the announcement waits its turn, keyed by request
          id so a status flip or an arriving response announces that one row. The
          question and the answer are the content, hence body size. */}
      <div role="log" aria-live="polite" aria-label="Agent request log">
        <VStack gap={2}>
          {(requests ?? []).map((r) => (
            <Card key={r.id} data-testid="queue-row">
              <VStack gap={1}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
                  <Text>{r.body}</Text>
                </HStack>
                {r.response !== "" && (
                  <Text color="secondary" data-testid="queue-response">
                    {r.response}
                  </Text>
                )}
              </VStack>
            </Card>
          ))}
        </VStack>
      </div>
    </VStack>
  );
}
