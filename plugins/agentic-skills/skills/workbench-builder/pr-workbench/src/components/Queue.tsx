import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import type { Request } from "../types";
import { post, useRegion } from "../useRegion";

const STATUS_BADGE: Record<Request["status"], "neutral" | "warning" | "success"> = {
  queued: "neutral",
  working: "warning",
  answered: "success",
};

/**
 * The global queue — whole-set questions ("what order should these land in?")
 * alongside the per-PR asks raised from the detail dialog, which is why rows
 * show their PR number when they have one.
 *
 * Human→agent channel: ask inserts `queued`; the agent's `/claude/queue` pull
 * claims it (`queued → working`, the badge moves the moment `review-loop.ts`
 * picks up); `/claude/respond` completes it.
 *
 * "Hand batch to agent" is the same channel with kind `process-edits` and no
 * typing: it says "the verdicts I just set are ready", and
 * `scripts/wait-for-work.ts` exits on it immediately instead of waiting out
 * the quiet-period debounce.
 */
export function Queue() {
  const requests = useRegion<Request[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim(), kind: "merge-check" });
    setDraft("");
  };

  const handBatch = async () => {
    await post("/api/ask", {
      body: "Process the review verdicts I just set",
      kind: "process-edits",
    });
  };

  return (
    <Card data-testid="queue" style={{ minWidth: 0 }}>
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={2}>Ask the agent</Heading>
          <Text type="supporting" as="div">
            merge order, cross-PR risk, anything about the set
          </Text>
        </VStack>

        <TextArea
          {...{ autoComplete: "off", "data-lpignore": "true" }}
          label="Ask the agent"
          isLabelHidden
          placeholder="e.g. which of these can land today?"
          rows={2}
          value={draft}
          changeAction={(v) => setDraft(v)}
        />
        <HStack gap={1}>
          <Button
            label="Ask"
            data-testid="queue-submit"
            onClick={ask}
            isDisabled={draft.trim() === ""}
          />
          {/* clickAction, not onClick: the POST's promise drives the button's
              own spinner, so the hand-off reads as sent before the queue row
              arrives over SSE. */}
          <Button
            label="Hand batch to agent"
            variant="secondary"
            data-testid="hand-to-agent"
            clickAction={handBatch}
          />
        </HStack>

        {/* role="log" + aria-live="polite" — rows arrive over SSE while the
            reader is elsewhere on the page (the status badge moves queued →
            working → answered on its own), and a log announces additions in
            order without stealing focus. */}
        <VStack
          gap={2}
          role="log"
          aria-live="polite"
          aria-label="Agent request queue"
        >
          {(requests ?? []).map((r) => (
            <Card key={r.id} variant="muted" padding={2} data-testid="queue-row">
              <VStack gap={1}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
                  <Text type="supporting">{r.kind}</Text>
                  {r.pr_number !== null && (
                    <Text type="supporting" hasTabularNumbers>
                      #{r.pr_number}
                    </Text>
                  )}
                </HStack>
                <Text>{r.body}</Text>
                {r.response !== "" && (
                  <Text color="secondary" data-testid="queue-response">
                    {r.response}
                  </Text>
                )}
              </VStack>
            </Card>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}
