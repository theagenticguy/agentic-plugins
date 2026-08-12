import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";
import type { Request } from "../types";

const STATUS_BADGE: Record<Request["status"], "neutral" | "warning" | "success"> = {
  queued: "neutral",
  working: "warning",
  answered: "success",
};

/** Human→agent channel. Asking inserts a queued row; the agent's pull CLAIMS it
 *  (queued → working, so the badge moves the moment the loop script runs);
 *  responding completes it. "Hand batch to agent" is the same channel with
 *  kind 'process-edits' — the wake-on-work watcher exits on it immediately,
 *  skipping the debounce wait on a review still in progress. */
export function Queue() {
  const requests = useRegion<Request[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    const body = draft.trim();
    if (body === "") return;
    await post("/api/ask", { body });
    setDraft("");
  };

  const handBatch = async () => {
    await post("/api/ask", { body: "Process my annotations", kind: "process-edits" });
  };

  return (
    <VStack gap={2} data-testid="queue">
      <Button
        label="Hand batch to agent"
        size="sm"
        clickAction={handBatch}
        data-testid="hand-to-agent"
      />
      <HStack gap={1}>
        <TextArea
          {...{ autoComplete: "off", "data-lpignore": "true" }}
          label="Ask the agent"
          isLabelHidden
          size="sm"
          placeholder="Ask the agent about an annotation…"
          rows={2}
          value={draft}
          changeAction={(v) => setDraft(v)}
          data-testid="ask-input"
        />
        <Button label="Ask" size="sm" clickAction={ask} data-testid="ask-button" />
      </HStack>
      {/* Rows appear and change status under the user as the agent claims and
          answers them, so the list is a polite live region. It wraps only the
          rows: the ask controls above are static and must not be re-announced.
          Request and response are body-size — they are this pane's content. */}
      <VStack
        gap={2}
        role="log"
        aria-live="polite"
        aria-label="Agent request activity"
        data-testid="queue-log"
      >
        {(requests ?? []).map((r) => (
          <Card key={r.id} padding={2}>
            <VStack gap={1}>
              <HStack gap={2} vAlign="start" wrap="wrap">
                <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
                <Text>{r.body}</Text>
              </HStack>
              {r.response !== "" && <Text color="secondary">{r.response}</Text>}
            </VStack>
          </Card>
        ))}
      </VStack>
    </VStack>
  );
}
