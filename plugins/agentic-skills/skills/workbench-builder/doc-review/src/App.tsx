import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { AnnotationRail } from "./components/AnnotationRail";
import { Document } from "./components/Document";
import { Queue } from "./components/Queue";
import { useSseStatus } from "./useRegion";

/**
 * The workbench shell owns the top of the heading outline: h1 for the page, h2
 * for each pane. Document content headings render below that (see Document.tsx),
 * so the panes read as siblings of the reviewed document rather than as
 * subsections of whatever section the document happens to be showing.
 *
 * The three panes are named <section> landmarks, so a screen-reader user jumps
 * between document, queue, and annotations without walking the whole page.
 */
export function App() {
  const sse = useSseStatus();
  return (
    <VStack as="main" gap={3} padding={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>Doc review</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse === "live" ? "Live updates connected" : "Live updates disconnected"}
          isPulsing={sse === "live"}
        />
        <Text size="sm" color="secondary">
          select text to annotate · disposable · 127.0.0.1
        </Text>
      </HStack>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>
        <section aria-label="Document under review" style={{ minWidth: 0, maxWidth: 720 }}>
          <Document />
        </section>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <VStack as="section" gap={1} aria-label="Agent queue">
              <Heading level={2}>Agent queue</Heading>
              <Queue />
            </VStack>
            <VStack as="section" gap={1} aria-label="Annotations">
              <Heading level={2}>Annotations</Heading>
              <AnnotationRail />
            </VStack>
          </VStack>
        </div>
      </div>
    </VStack>
  );
}
