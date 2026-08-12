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

/**
 * The human→agent channel. Asking inserts a queued request; the agent's pull
 * flips it to working (pulling IS claiming — the badge moves the moment the
 * agent picks up); /claude/respond completes it. All three transitions arrive
 * as SSE repaints of this one region.
 *
 * "Hand batch to agent" is the same channel with kind 'process-edits': the
 * wake-on-work watcher (templates/wait-for-work.ts) exits on it immediately,
 * skipping the debounce wait.
 */
export function Queue() {
  const requests = useRegion<Req[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim() });
    setDraft("");
  };

  const handBatch = async () => {
    await post("/api/ask", { body: "Process my batched edits", kind: "process-edits" });
  };

  return (
    <VStack gap={2} data-testid="queue">
      <Button label="Hand batch to agent" clickAction={handBatch} data-testid="hand-to-agent" />
      <HStack gap={1}>
        <TextArea
          {...{ autoComplete: "off", "data-lpignore": "true" }}
          label="Ask the agent"
          isLabelHidden
          placeholder="Ask the agent…"
          rows={2}
          value={draft}
          changeAction={(v) => setDraft(v)}
        />
        <Button label="Ask" clickAction={ask} />
      </HStack>
      {(requests ?? []).map((r) => (
        <Card key={r.id}>
          <VStack gap={1}>
            <HStack gap={2}>
              <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
              <Text>{r.body}</Text>
            </HStack>
            {r.response !== "" && <Text color="secondary">{r.response}</Text>}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
