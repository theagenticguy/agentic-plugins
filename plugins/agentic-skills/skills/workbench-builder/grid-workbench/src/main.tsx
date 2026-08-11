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
// mode="light" rather than "system": the page is designed against Graphite's
// light surfaces, and a canvas colour cannot follow a media query. Graphite's
// dark pairs are in the same built theme — flipping this line and the
// data-theme attribute in index.html switches the whole page.
createRoot(document.getElementById("root")!).render(
  <Theme theme={graphiteTheme} mode="light">
    <App />
  </Theme>,
);
