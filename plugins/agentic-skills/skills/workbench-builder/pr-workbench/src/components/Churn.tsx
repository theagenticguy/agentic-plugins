import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";

/**
 * `+adds / −dels` with a proportional two-tone bar.
 *
 * A CSS bar rather than a chart: it needs no chart-type registration and — the
 * load-bearing reason — it does not measure itself, so it renders correctly
 * inside a Dialog that was closed when the component first mounted. An ECharts
 * bar in that position draws into a 0-height box.
 *
 * `max` scales every bar in a list against the same denominator, so the bars
 * are comparable down a column instead of each self-normalizing to 100%.
 */
export function Churn({
  additions,
  deletions,
  max,
  width = 120,
}: {
  readonly additions: number;
  readonly deletions: number;
  readonly max?: number;
  readonly width?: number;
}) {
  const total = additions + deletions;
  const scale = max && max > 0 ? Math.min(1, total / max) : 1;
  const filled = Math.max(total === 0 ? 0 : 2, Math.round(width * scale));
  const addShare = total === 0 ? 0 : additions / total;

  return (
    <HStack gap={1} vAlign="center">
      <Text size="xsm" color="secondary" hasTabularNumbers>
        +{additions}
      </Text>
      <Text size="xsm" color="secondary" hasTabularNumbers>
        −{deletions}
      </Text>
      {/* Theme tokens, not literals — this is a DOM element, not a canvas, so it
          can read custom properties and there is no pairing to maintain. A
          hardcoded hex would be the one element on this dark page that ignores
          the mode. Graphite supplies all three: --color-success is --status-done
          teal (#2fb6a4 in dark), --color-error is --neg (#e0635a),
          --color-border is --line (#303b47). */}
      <div
        aria-hidden
        style={{
          display: "flex",
          width: filled,
          minWidth: total === 0 ? 0 : 2,
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--color-border)",
        }}
      >
        <div
          style={{ width: `${addShare * 100}%`, background: "var(--color-success)" }}
        />
        <div
          style={{ width: `${(1 - addShare) * 100}%`, background: "var(--color-error)" }}
        />
      </div>
    </HStack>
  );
}
