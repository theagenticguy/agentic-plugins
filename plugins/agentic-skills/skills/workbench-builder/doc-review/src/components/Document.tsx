import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
 * The reviewed document's own headings announce two levels below the workbench
 * shell's outline (h1 page, h2 pane), so "Agent queue" and "Annotations" stay
 * siblings of the document instead of reading as subsections of it. `aria-level`
 * moves the announced level only: the tag keeps the visual weight the document
 * asked for, which is what a reviewer needs to see.
 */
const HEADING_ARIA_LEVEL: Record<string, number> = { h1: 3, h2: 4, h3: 5 };

/**
 * Takes an element out of the visual layout while leaving it in the
 * accessibility tree — the clip-rect technique, not `display: none`.
 */
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * A block tag only reaches the DOM when it is valid standing alone. The parser
 * flattens tables to their cell text, so a cell renders as a paragraph rather
 * than a <td> stranded outside any <table>.
 */
const STANDALONE_TAG: Record<string, string> = { td: "p", th: "p", caption: "p" };

/**
 * Groups a consecutive run of `li` blocks under one list. A bare <li> is invalid
 * markup and costs a screen-reader user the list semantics — "list, 3 items" —
 * that make an enumerated document navigable.
 */
function groupBlocks(blocks: Block[]): Array<{ isList: boolean; blocks: Block[] }> {
  const groups: Array<{ isList: boolean; blocks: Block[] }> = [];
  for (const block of blocks) {
    const isList = block.tag === "li";
    const tail = groups[groups.length - 1];
    if (isList && tail?.isList === true) tail.blocks.push(block);
    else groups.push({ isList, blocks: [block] });
  }
  return groups;
}

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
  readonly onSelect: (sel: Draft) => void;
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
      yTop: rect.top,
    });
  }, [block, onSelect]);

  const tag = STANDALONE_TAG[block.tag] ?? block.tag;
  const Tag = tag as keyof JSX.IntrinsicElements;
  return (
    <Tag
      ref={ref as never}
      data-block={block.id}
      aria-level={HEADING_ARIA_LEVEL[tag]}
      onMouseUp={handleMouseUp}
    >
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

/** A pending annotation plus the selection rect that positions the popover:
 *  `x` is the selection's horizontal centre, `y` its bottom, `yTop` its top. */
type Draft = {
  block_id: number;
  start: number;
  end: number;
  quote: string;
  x: number;
  y: number;
  yTop: number;
};

const POPOVER_MARGIN = 8;

/** The document pane: server-parsed blocks, selection → compose popover. */
export function Document() {
  const doc = useRegion<{ title: string; blocks: Block[] }>("document");
  const annotations = useRegion<Annotation[]>("annotations") ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "redline">("comment");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popover, setPopover] = useState<{ left: number; top: number } | null>(null);

  /** Abandons the draft. Clearing the body too keeps a discarded note from
   *  reappearing pre-filled under the next selection. */
  const dismiss = useCallback(() => {
    setDraft(null);
    setBody("");
  }, []);

  // Dismiss the compose popover on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  // The popover is position:fixed, so a viewport edge CLIPS it — there is no
  // scroll that brings it back. Measure the card once it has rendered and keep
  // it inside the viewport on both axes, flipping above the selection when
  // there is no room below. Its height tracks the body type ramp, so a
  // selection in the lower third of the window puts Save out of reach without
  // this. Until the measurement lands the card is laid out but not painted,
  // which a layout effect keeps within a single frame.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (draft === null || el === null) {
      setPopover(null);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = Math.max(POPOVER_MARGIN, window.innerWidth - width - POPOVER_MARGIN);
    const below = draft.y + POPOVER_MARGIN;
    setPopover({
      left: Math.min(Math.max(POPOVER_MARGIN, draft.x - width / 2), maxLeft),
      top: below + height + POPOVER_MARGIN <= window.innerHeight
        ? below
        : Math.max(POPOVER_MARGIN, draft.yTop - height - POPOVER_MARGIN),
    });
  }, [draft]);

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
    dismiss();
    window.getSelection()?.removeAllRanges();
  };

  if (doc === null) return null;
  return (
    <div data-testid="document" style={{ position: "relative", minWidth: 0 }}>
      <VStack gap={2}>
        {/* The pane's level-2 outline anchor. Hidden visually because the
            document renders its own title one level below at full weight;
            keeping it in the tree means a document that opens on any heading
            level still nests under the page h1 with no skipped level. */}
        <h2 style={SR_ONLY}>{doc.title}</h2>
        {groupBlocks(doc.blocks).map((group) =>
          group.isList ? (
            // Margin zeroed and the marker gutter set explicitly: the VStack
            // owns vertical rhythm, and the UA's 40px indent would push list
            // text out of alignment with the surrounding paragraphs. The list
            // style is restated because core's reset drops markers from every
            // ul, and a reviewed document's bullets are content.
            <ul
              key={`list-${group.blocks[0].id}`}
              style={{ margin: 0, paddingInlineStart: 24, listStyleType: "disc" }}
            >
              {group.blocks.map((b) => (
                <BlockView key={b.id} block={b} annotations={annotations} onSelect={setDraft} />
              ))}
            </ul>
          ) : (
            <BlockView
              key={group.blocks[0].id}
              block={group.blocks[0]}
              annotations={annotations}
              onSelect={setDraft}
            />
          ),
        )}
      </VStack>
      {draft && (
        <div
          ref={popoverRef}
          data-testid="compose"
          role="group"
          aria-label={`Annotate “${draft.quote}”`}
          style={{
            position: "fixed",
            left: popover?.left ?? draft.x,
            top: popover?.top ?? draft.y + POPOVER_MARGIN,
            // Never wider than the viewport it is pinned inside.
            width: `min(320px, calc(100vw - ${POPOVER_MARGIN * 2}px))`,
            visibility: popover === null ? "hidden" : "visible",
            zIndex: 10,
          }}
        >
          <Card elevation="high">
            <VStack gap={1}>
              {/* aria-pressed carries the choice programmatically: the two
                  buttons distinguish selected from unselected by fill alone. */}
              <HStack gap={1}>
                <Button
                  size="sm"
                  variant={kind === "comment" ? "primary" : "ghost"}
                  label="Comment"
                  aria-pressed={kind === "comment"}
                  onClick={() => setKind("comment")}
                />
                <Button
                  size="sm"
                  variant={kind === "redline" ? "primary" : "ghost"}
                  label="Redline"
                  aria-pressed={kind === "redline"}
                  onClick={() => setKind("redline")}
                />
              </HStack>
              <TextArea
          {...{ autoComplete: "off", "data-lpignore": "true" }}
                label="Annotation"
                isLabelHidden
                placeholder={kind === "redline" ? "Proposed replacement…" : "Your note…"}
                rows={2}
                value={body}
                changeAction={(v) => setBody(v)}
              />
              <HStack gap={1}>
                <Button size="sm" label="Save" onClick={save} />
                <Button size="sm" variant="ghost" label="Cancel" onClick={dismiss} />
              </HStack>
            </VStack>
          </Card>
        </div>
      )}
    </div>
  );
}
