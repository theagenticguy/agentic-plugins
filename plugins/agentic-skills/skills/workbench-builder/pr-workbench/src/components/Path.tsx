import { Text } from "@astryxdesign/core/Text";

/**
 * A repository path in mono, sized as primary data and free to wrap inside
 * whatever column it lands in.
 *
 * The wrapper span carries the two properties Astryx `Text` cannot express:
 *
 * - `minWidth: 0` — every call site puts a path in an `HStack` beside a churn
 *   bar or a badge, and a flex item defaults to `min-width: auto`. Without this
 *   the row refuses to shrink below the path's min-content width and widens the
 *   whole column, which in the detail dialog means a horizontal scrollbar.
 * - `overflowWrap: anywhere` — `break-word` and `break-all` leave min-content
 *   at the longest unbreakable run, so `min-width: 0` alone still overflows.
 *   `anywhere` is the one value that also shrinks min-content, and it inherits
 *   into the Text. Text's own `wordBreak` prop only applies when `maxLines` is
 *   set, and truncating a path hides the filename — the part being reviewed.
 */
export function Path({
  children,
  color,
}: {
  readonly children: string;
  readonly color?: "primary" | "secondary";
}) {
  return (
    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <Text type="code" color={color}>
        {children}
      </Text>
    </span>
  );
}
