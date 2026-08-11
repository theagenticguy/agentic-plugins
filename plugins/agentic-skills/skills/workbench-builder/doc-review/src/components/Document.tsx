import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { post, useRegion } from "../useRegion";
import type { Annotation, Block } from "../types";

/**
 * Highlight colours for the two annotation kinds, as Graphite literals.
 *
 * These are literals rather than `var(--color-*)` for the same reason the chart
 * palettes are: they must PAIR with a value the theme also carries. A <mark>
 * needs a wash light enough to read black body copy through, and the theme's
 * `-muted` tokens are alpha overlays that composite differently on each surface
 * a block can sit on. So the wash is computed once here — the Graphite hue at
 * Graphite's own accent-soft alpha over --bg-1 #fcfdfe — and pinned. Keep this
 * block and the theme import in main.tsx in the same edit.
 *
 * comment → --warn amber   #7a5512 (light) / #d6a23f (dark)
 * redline → --neg  redline #9a3b33 (light) / #e0635a (dark)
 * Light mode is what ships (index.html and main.tsx pin mode="light"); the dark
 * pairs are named so a mode flip is a two-line change.
 */
const MARK_STYLE = {
  comment: {
    // #7a5512 composited at 12% over --bg-1 #fcfdfe. --ink reads 15.84:1 through
    // it and the underline clears the 3:1 non-text floor at 5.52:1.
    // Dark: #34332d (#d6a23f at 14% over #1a212a), --ink 11.33:1.
    background: "#ece9e2",
    borderBottomColor: "#7a5512", // --warn (dark: #d6a23f)
  },
  redline: {
    // #9a3b33 composited at 12% over --bg-1 #fcfdfe. --ink 15.69:1, underline
    // 5.62:1. Dark: #362a31 (#e0635a at 14% over #1a212a), --ink 12.26:1.
    background: "#f0e6e6",
    borderBottomColor: "#9a3b33", // --neg (dark: #e0635a)
  },
} as const;

/**
 * Renders one block as alternating text/<mark> segments computed from its
 * open annotations. Because the block renders EXACTLY the server's stored
 * string, a selection's offsets — measured by walking the block's text nodes —
 * index into the same string the server validates against.
 */
function BlockView({
  block,
  annotations,
  onSelect,
}: {
  readonly block: Block;
  readonly annotations: Annotation[];
  readonly onSelect: (sel: { block_id: number; start: number; end: number; quote: string; x: number; y: number }) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  // Segment the text on open-annotation boundaries.
  const marks = annotations
    .filter((a) => a.block_id === block.id && a.status === "open")
    .sort((a, b) => a.start - b.start);
  const segments: Array<{ text: string; ann: Annotation | null }> = [];
  let cursor = 0;
  for (const ann of marks) {
    if (ann.start > cursor) segments.push({ text: block.text.slice(cursor, ann.start), ann: null });
    segments.push({ text: block.text.slice(ann.start, ann.end), ann });
    cursor = ann.end;
  }
  if (cursor < block.text.length) segments.push({ text: block.text.slice(cursor), ann: null });

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ref.current) return;
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return;
    // Walk the block's text nodes to convert the DOM range into character
    // offsets within the block's full text.
    const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let start = -1;
    let end = -1;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === range.startContainer) start = offset + range.startOffset;
      if (node === range.endContainer) end = offset + range.endOffset;
      offset += node.textContent?.length ?? 0;
    }
    if (start < 0 || end < 0 || end <= start) return;
    const rect = range.getBoundingClientRect();
    onSelect({
      block_id: block.id,
      start,
      end,
      quote: block.text.slice(start, end),
      x: rect.left + rect.width / 2,
      y: rect.bottom,
    });
  }, [block, onSelect]);

  const Tag = block.tag as keyof JSX.IntrinsicElements;
  return (
    <Tag ref={ref as never} data-block={block.id} onMouseUp={handleMouseUp}>
      {segments.map((seg, i) =>
        seg.ann ? (
          <mark
            key={i}
            data-ann={seg.ann.id}
            style={{
              // borderBottomStyle/Width rather than the `borderBottom` shorthand:
              // the shorthand resets border-color, so listing it after the spread
              // would paint a black underline over the Graphite hue.
              borderBottomStyle: "solid",
              borderBottomWidth: 2,
              ...MARK_STYLE[seg.ann.kind === "redline" ? "redline" : "comment"],
            }}
          >
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </Tag>
  );
}

type Draft = { block_id: number; start: number; end: number; quote: string; x: number; y: number };

/** The document pane: server-parsed blocks, selection → compose popover. */
export function Document() {
  const doc = useRegion<{ title: string; blocks: Block[] }>("document");
  const annotations = useRegion<Annotation[]>("annotations") ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "redline">("comment");

  // Dismiss the compose popover on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = async () => {
    if (!draft || body.trim() === "") return;
    await post("/api/annotations", {
      block_id: draft.block_id,
      start: draft.start,
      end: draft.end,
      quote: draft.quote,
      kind,
      body: body.trim(),
    });
    setDraft(null);
    setBody("");
    window.getSelection()?.removeAllRanges();
  };

  if (doc === null) return null;
  return (
    <div data-testid="document" style={{ position: "relative", minWidth: 0 }}>
      <VStack gap={2}>
        {doc.blocks.map((b) => (
          <BlockView key={b.id} block={b} annotations={annotations} onSelect={setDraft} />
        ))}
      </VStack>
      {draft && (
        <div
          data-testid="compose"
          style={{
            position: "fixed",
            left: Math.max(8, draft.x - 160),
            top: draft.y + 8,
            width: 320,
            zIndex: 10,
          }}
        >
          <Card elevation="high">
            <VStack gap={1}>
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant={kind === "comment" ? "primary" : "ghost"}
                  label="Comment"
                  onClick={() => setKind("comment")}
                />
                <Button
                  size="sm"
                  variant={kind === "redline" ? "primary" : "ghost"}
                  label="Redline"
                  onClick={() => setKind("redline")}
                />
              </HStack>
              <TextArea
                label="Annotation"
                isLabelHidden
                placeholder={kind === "redline" ? "Proposed replacement…" : "Your note…"}
                rows={2}
                value={body}
                changeAction={(v) => setBody(v)}
              />
              <HStack gap={1}>
                <Button size="sm" label="Save" onClick={save} />
                <Button size="sm" variant="ghost" label="Cancel" onClick={() => setDraft(null)} />
              </HStack>
            </VStack>
          </Card>
        </div>
      )}
    </div>
  );
}
