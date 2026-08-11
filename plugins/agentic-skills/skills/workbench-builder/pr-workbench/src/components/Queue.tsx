import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
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
 */
export function Queue() {
  const requests = useRegion<Request[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim(), kind: "merge-check" });
    setDraft("");
  };

  return (
    <Card data-testid="queue" style={{ minWidth: 0 }}>
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Text weight="semibold" as="div">
            Ask the agent
          </Text>
          <Text size="xsm" color="secondary" as="div">
            merge order, cross-PR risk, anything about the set
          </Text>
        </VStack>

        <TextArea
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
        </HStack>

        {(requests ?? []).map((r) => (
          <Card key={r.id} variant="muted" padding={2} data-testid="queue-row">
            <VStack gap={1}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
                <Text size="xsm" color="secondary">
                  {r.kind}
                </Text>
                {r.pr_number !== null && (
                  <Text size="xsm" color="secondary" hasTabularNumbers>
                    #{r.pr_number}
                  </Text>
                )}
              </HStack>
              <Text size="sm">{r.body}</Text>
              {r.response !== "" && (
                <Text size="xsm" color="secondary" data-testid="queue-response">
                  {r.response}
                </Text>
              )}
            </VStack>
          </Card>
        ))}
      </VStack>
    </Card>
  );
}
