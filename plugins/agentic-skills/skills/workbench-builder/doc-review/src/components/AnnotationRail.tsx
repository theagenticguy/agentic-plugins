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
 *  reopen button is the human override.
 *
 *  The rail is a `role="log"` / `aria-live="polite"` region, and the empty state
 *  renders INSIDE it: cards arrive over SSE while the user is reading elsewhere,
 *  so the region must already exist for the first arrival to be announced.
 *
 *  Quote, note, and agent reply are body-size text. They are the payload of this
 *  pane, not caption metadata about it, and supporting size buries them. */
export function AnnotationRail() {
  const annotations = useRegion<Annotation[]>("annotations");
  if (annotations === null) return null;
  return (
    <VStack
      gap={2}
      data-testid="annotations"
      role="log"
      aria-live="polite"
      aria-label="Annotations on this document"
    >
      {annotations.length === 0 && (
        <EmptyState
          title="No annotations yet"
          description="Select text in the document to leave the first comment or redline."
        />
      )}
      {annotations.map((a) => (
        <Card key={a.id} data-testid="annotation-card">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Badge variant={STATUS_BADGE[a.status]} label={a.status} />
              <Badge variant={a.kind === "redline" ? "error" : "neutral"} label={a.kind} />
            </HStack>
            <Text color="secondary">“{a.quote}”</Text>
            <Text>{a.body}</Text>
            {a.reply !== "" && <Text color="accent">agent: {a.reply}</Text>}
            {a.status !== "open" && (
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Reopen"
                  // Every card offers the same word; the label names which note.
                  aria-label={`Reopen ${a.kind} on “${a.quote}”`}
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
