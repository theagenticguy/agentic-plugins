import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
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
 *  responding completes it. */
export function Queue() {
  const requests = useRegion<Request[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    const body = draft.trim();
    if (body === "") return;
    await post("/api/ask", { body });
    setDraft("");
  };

  return (
    <VStack gap={2} data-testid="queue">
      <HStack gap={1} vAlign="end">
        <TextInput
          label="Ask the agent"
          isLabelHidden
          size="sm"
          placeholder="Ask the agent about a row…"
          value={draft}
          onChange={(v) => setDraft(v)}
          onEnter={() => void ask()}
          data-testid="ask-input"
        />
        <Button label="Ask" size="sm" clickAction={ask} data-testid="ask-button" />
      </HStack>
      {(requests ?? []).map((r) => (
        <Card key={r.id} padding={2}>
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Badge variant={STATUS_BADGE[r.status]} label={r.status} />
              <Text type="supporting" color="primary">
                {r.body}
              </Text>
            </HStack>
            {r.response !== "" && <Text type="supporting">{r.response}</Text>}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
