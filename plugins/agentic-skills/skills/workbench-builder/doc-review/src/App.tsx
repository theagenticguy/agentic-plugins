import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { AnnotationRail } from "./components/AnnotationRail";
import { Document } from "./components/Document";
import { useSseStatus } from "./useRegion";

export function App() {
  const sse = useSseStatus();
  return (
    <VStack gap={3} padding={4}>
      <HStack gap={2} vAlign="center">
        <Heading level={1}>Doc review</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse}
          isPulsing={sse === "live"}
        />
        <Text size="sm" color="secondary">
          select text to annotate · disposable · 127.0.0.1
        </Text>
      </HStack>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>
        <div style={{ minWidth: 0, maxWidth: 720 }}>
          <Document />
        </div>
        <div style={{ minWidth: 0 }}>
          <Heading level={3}>Annotations</Heading>
          <AnnotationRail />
        </div>
      </div>
    </VStack>
  );
}
