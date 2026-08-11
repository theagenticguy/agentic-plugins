import { useEffect, useId, useRef } from "react";
import mermaid from "mermaid";

/**
 * Mermaid renders to SVG with its own palette, not the page's, so Graphite has
 * to be handed to it as `themeVariables` literals — same pairing rule as the
 * chart palette in charts.ts: the values exist twice, and both copies move in one
 * edit. `theme: "base"` is the only mermaid theme that honours themeVariables;
 * the named themes ("neutral", "dark", …) ignore them.
 *
 * Light-mode Graphite pairs, matching main.tsx's mode="light".
 * Dark: primaryColor #232c37, primaryTextColor #eef3f8, lineColor #46545f,
 * background #1a212a, tertiaryColor #10151b.
 */
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    background: "#fcfdfe", // --bg-1, the raised sheet the diagram sits on
    primaryColor: "#dadfe5", // --bg-2, node fill — a recess, not a colour
    primaryBorderColor: "#a9b4bf", // --line-strong
    primaryTextColor: "#0b0f14", // --ink
    secondaryColor: "#e8edf1", // --bg-0
    tertiaryColor: "#fcfdfe", // --bg-1, cluster/subgraph fill
    lineColor: "#586471", // --ink-low, edges read as structure not data
    textColor: "#0b0f14", // --ink
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px", // Graphite --text-sm
  },
});

/** Renders one mermaid source string as inline SVG. Render is async; the id
 *  must be unique per instance or concurrent renders clobber each other. */
export function Mermaid({ source }: { readonly source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    let alive = true;
    mermaid
      .render(`mm-${id}`, source)
      .then(({ svg }) => {
        if (alive && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e) => {
        if (alive && ref.current) ref.current.textContent = `mermaid: ${e}`;
      });
    return () => {
      alive = false;
    };
  }, [source, id]);
  // min-width:0 lets the SVG shrink inside grid/flex parents instead of
  // forcing the panel wide.
  return <div ref={ref} data-testid="mermaid" style={{ minWidth: 0, overflowX: "auto" }} />;
}
