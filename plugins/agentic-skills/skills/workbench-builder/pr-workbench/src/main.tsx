// Theme CSS loads once here, before any component renders. index.html declares
// the `reset, astryx-base, astryx-theme` layer order, which these imports rely
// on — Bun emits the links in reverse import order.
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
// The metric-adjusted local @font-face fallback. It is a sibling of the theme CSS
// rather than part of it: `astryx theme build` wraps its output in
// `@layer … { @scope … }`, and @font-face is a top-level at-rule that cannot be
// scoped. Without this file the stack's 'IBM Plex Sans fallback' entry is an
// undefined family, silently skipped, and the webfont swap reflows body copy.
import "./theme/graphite-fonts.css";
import "./theme/graphite.css";

import { Theme } from "@astryxdesign/core/theme";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { graphiteTheme } from "./theme/graphite";

// graphite.css only styles elements under `[data-astryx-theme="graphite"]`.
// index.html sets that attribute for the first paint; <Theme> is what registers
// the theme object, and registration is what `useTheme().token()` resolves
// through. The built module carries `__built: true`, so the provider skips
// runtime style injection and defers to the stylesheet above.
// mode="dark" rather than "system": Graphite dark is a first-class mode with its
// own token pairs (--bg-0 #10151b, --accent #2fb6a4), and this workbench is
// designed against them. OS preference must not be able to flip a page whose
// chart and highlight literals are the dark-mode hexes.
createRoot(document.getElementById("root")!).render(
  <Theme theme={graphiteTheme} mode="dark">
    <App />
  </Theme>,
);
