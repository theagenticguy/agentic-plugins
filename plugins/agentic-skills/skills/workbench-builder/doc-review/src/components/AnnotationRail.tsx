import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";
import type { Annotation } from "../types";

const STATUS_BADGE: Record<Annotation["status"], "warning" | "success" | "neutral"> = {
  open: "warning",
  resolved: "success",
  wontfix: "neutral",
};

/** The annotation rail: every note with its quote, status, and agent reply.
 *  Resolution usually arrives from the terminal (scripts/review.ts); the
 *  reopen button is the human override. */
export function AnnotationRail() {
  const annotations = useRegion<Annotation[]>("annotations");
  if (annotations === null) return null;
  if (annotations.length === 0) {
    return (
      <EmptyState
        title="No annotations yet"
        description="Select text in the document to leave the first comment or redline."
      />
    );
  }
  return (
    <VStack gap={2} data-testid="annotations">
      {annotations.map((a) => (
        <Card key={a.id} data-testid="annotation-card">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center">
              <Badge variant={STATUS_BADGE[a.status]} label={a.status} />
              <Badge variant={a.kind === "redline" ? "error" : "neutral"} label={a.kind} />
            </HStack>
            <Text size="sm" color="secondary">
              “{a.quote}”
            </Text>
            <Text size="sm">{a.body}</Text>
            {a.reply !== "" && (
              <Text size="sm" color="accent">
                agent: {a.reply}
              </Text>
            )}
            {a.status !== "open" && (
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Reopen"
                  onClick={() => post(`/api/annotations/${a.id}/status`, { status: "open" })}
                />
              </HStack>
            )}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
