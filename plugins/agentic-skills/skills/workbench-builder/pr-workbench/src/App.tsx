import { useState } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Collisions } from "./components/Collisions";
import { Fleet } from "./components/Fleet";
import { Overview } from "./components/Overview";
import { PrDetailDialog } from "./components/PrDetail";
import { Queue } from "./components/Queue";
import type { FleetPr } from "./types";
import { useRegion, useSseStatus } from "./useRegion";

export function App() {
  const sse = useSseStatus();
  const [openPrId, setOpenPrId] = useState<number | null>(null);
  // The fleet rows are already in memory here, so a collision chip's PR
  // *number* resolves to its *id* client-side — no extra endpoint just to
  // translate one integer into another. The chip carries the number because
  // that is what a reviewer says out loud; the region key is the id because
  // that is the primary key.
  const fleet = useRegion<FleetPr[]>("fleet");
  const openByNumber = (number: number) => {
    const match = (fleet ?? []).find((p) => p.number === number);
    if (match) setOpenPrId(match.id);
  };

  return (
    // as="main" rather than a wrapper <div>: the whole page is the review room,
    // so the single landmark is the page shell itself.
    <VStack as="main" gap={3} padding={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>PR review room</Heading>
        <StatusDot
          variant={sse === "live" ? "success" : "error"}
          label={sse}
          isPulsing={sse === "live"}
        />
        <Text type="supporting">disposable · 127.0.0.1 · this session only</Text>
      </HStack>

      <Overview />

      {/* Asymmetric split needs plain CSS grid — Astryx Grid takes numeric
          columns only. minWidth:0 on both columns keeps long file paths and
          the GFM tables from blowing the layout open. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Fleet onOpen={setOpenPrId} />
        </div>
        <div style={{ minWidth: 0 }}>
          <VStack gap={3}>
            <Collisions onOpen={openByNumber} />
            <Queue />
          </VStack>
        </div>
      </div>

      {/* Mounted only while a PR is selected: the dialog subscribes to the
          parameterized region `pr-<id>`, so keeping a hidden instance around
          would hold an extra subscription and a stale id. */}
      {openPrId !== null && (
        <PrDetailDialog prId={openPrId} onClose={() => setOpenPrId(null)} />
      )}
    </VStack>
  );
}
