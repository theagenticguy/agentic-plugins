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
 */
export function Queue() {
  const requests = useRegion<Req[]>("queue");
  const [draft, setDraft] = useState("");

  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim() });
    setDraft("");
  };

  return (
    <VStack gap={2} data-testid="queue">
      <HStack gap={1}>
        <TextArea
          label="Ask the agent"
          isLabelHidden
          placeholder="Ask the agent…"
          rows={2}
          value={draft}
          changeAction={(v) => setDraft(v)}
        />
        <Button label="Ask" onClick={ask} />
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
