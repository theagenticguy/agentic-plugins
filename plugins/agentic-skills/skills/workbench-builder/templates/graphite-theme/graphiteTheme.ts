/**
 * Graphite — the canonical Astryx theme for every workbench in this catalog.
 *
 * This file is the token source of truth for the theme: light/dark colour
 * vars, the MONO/SANS/SERIF font stacks and scale, the 5-step categorical
 * data palette (GRAPHITE_SERIES), the 7-hue status ramp (--status-open …
 * --status-closed), and the metric-adjusted local @font-face fallback
 * strategy (graphite-fonts.css).
 *
 * REBUILD (from the directory holding this file):
 *   bunx astryx theme build graphiteTheme.ts --out graphite.css
 *
 * Graphite's own discipline, carried through the mapping: surfaces stay quiet,
 * colour is rationed to the accent (teal) and accent-2 (navy), and the accent
 * doubles as the positive/success hue because --status-done is the teal. A
 * workbench that wants a louder signal reaches for a status hue, never a new one.
 *
 * Every hex below is transcribed verbatim from the files above. Where Astryx
 * needs a slot Graphite does not define — the green and cyan categorical hues,
 * the two dark text stops that miss AA on their own tint — the derivation is
 * stated inline with the OKLCH arithmetic and the measured contrast ratio.
 */

import {defineSyntaxTheme, defineTheme} from '@astryxdesign/core/theme';

/*
 * No icon registry. Graphite defines no icon set, and every Astryx icon slot has
 * an inline-SVG default in `@astryxdesign/core/Icon/defaultIcons` — the chevrons,
 * close, and sort arrows that Collapsible / Dialog / SegmentedControl / Table
 * draw. Declaring `icons:` would pull `lucide-react` into every workbench for a
 * set of glyphs the pages never reference directly, and a disposable workbench
 * pays for its dependencies at every `bun install`.
 */

/**
 * Graphite font stacks, split verbatim from `graphite.ts:170-174` into the
 * `{family, fallbacks}` shape Astryx's typography config takes. Concatenating
 * family + fallbacks reproduces each SANS/SERIF/MONO_STACK literal exactly.
 *
 * `'IBM Plex Sans fallback'` is a metric-adjusted LOCAL face defined by
 * `@font-face` in `graphite-fonts.css` — the only stack entry that is not a real
 * webfont or a system family. Graphite defines no such face for the serif or mono
 * stacks (probed the source repo 2026-08-07: the only metric-adjusted serif
 * fallbacks are keyed to Fraunces and Source Serif 4, faces the app-sans stack
 * does not name), so those stacks degrade straight to their system entries —
 * Iowan Old Style / Charter / Georgia for serif, ui-monospace for mono. Astryx
 * does not load fonts; a family that is neither installed nor network-loaded is
 * skipped silently and the next entry wins.
 */
const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const SANS_FAMILY = 'IBM Plex Sans';
const SANS_FALLBACKS =
  "'IBM Plex Sans fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
const SERIF_FAMILY = 'Tiempos Headline';
const SERIF_FALLBACKS = "'Iowan Old Style', 'Charter', Georgia, 'Times New Roman', serif";

/**
 * Graphite → Astryx syntax palette.
 *
 * Astryx has 14 syntax slots; Graphite names none of them. Each slot maps to the
 * Graphite hue whose semantic role already matches, so a code block reads in the
 * same rationed palette as the rest of the page: structure in the accents, values
 * in the warm hues, punctuation in the ink ladder. `property` is the derived cyan
 * (see the categorical block below) — it needs to be distinguishable from
 * `string` (teal) at a glance.
 *
 * Every pair clears WCAG AA on the Graphite code surface (--bg-1 #fcfdfe light /
 * #1a212a dark); measured range 4.71:1 (dark tag) – 15.57:1 (light variable).
 */
const graphiteSyntax = defineSyntaxTheme({
  name: 'graphite',
  tokens: {
    keyword: ['#6a3f76', '#b482cc'], // plum — GRAPHITE_SERIES[2]
    string: ['#0a6961', '#2fb6a4'], // teal — --accent
    comment: ['#586471', '#8593a0'], // --ink-low
    number: ['#9a5b16', '#d6a23f'], // ochre — GRAPHITE_SERIES[3]
    function: ['#274d7a', '#7aa6e0'], // navy — --accent-2
    type: ['#6a3f76', '#b482cc'], // plum, same family as keyword
    variable: ['#1c232b', '#cdd7e0'], // --ink-soft
    operator: ['#3b4753', '#9aa7b4'], // --ink-mute
    constant: ['#9a5b16', '#d6a23f'], // ochre, same family as number
    tag: ['#a3341f', '#e0635a'], // brick — GRAPHITE_SERIES[4]
    attribute: ['#7a5512', '#d6a23f'], // --warn amber
    property: ['#19647c', '#3aadd5'], // derived cyan
    punctuation: ['#586471', '#8593a0'], // --ink-low
    background: ['#fcfdfe', '#1a212a'], // --bg-1, the raised surface
  },
});

export const graphiteTheme = defineTheme({
  name: 'graphite',

  /**
   * Type. The scale config keeps Graphite's ratio; the reading sizes are pinned
   * one step above Graphite's print-dense ramp in the explicit tokens below
   * (base 1rem, sm 0.875rem, xs 0.75rem). Graphite's 14px base is sized for
   * marketing pages read at arm's length; a workbench is a data surface the
   * human stares at for a session, and 12px supporting text on a retina laptop
   * reads as fine print. WCAG 1.4.4 aside, the floor of the pinned ramp is
   * 12px. Sans carries body and code is the mono stack; headings ride the
   * serif display face, which is where Graphite spends its one typographic
   * flourish.
   */
  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {family: SANS_FAMILY, fallbacks: SANS_FALLBACKS},
    heading: {
      family: SERIF_FAMILY,
      fallbacks: SERIF_FALLBACKS,
      // Graphite headings are quiet: the serif face and the size step do the
      // work, so no level gets bolder than medium.
      weight: 'medium',
      weights: {1: 'medium', 2: 'medium', 3: 'medium', 4: 'medium', 5: 'medium', 6: 'medium'},
    },
    code: {family: 'JetBrains Mono', fallbacks: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"},
  },

  /**
   * Motion, from Graphite's SCALE durations. fast=200ms is --duration-fast,
   * medium=320ms is --duration-base (the theme-bar slide), slow=600ms is
   * --duration-slow. ratio 0.5 makes the min/max variants land on the neighbours
   * Graphite already names — fast-min 100ms is --duration-instant, medium-max
   * 640ms brackets --duration-slow, slow-max 1200ms is --duration-slower.
   * easing is --ease-standard verbatim.
   */
  motion: {fast: 200, medium: 320, slow: 600, ratio: 0.5, easing: 'cubic-bezier(0.4, 0, 0.2, 1)'},

  /**
   * Radius. Graphite's --radius is 0.25rem = 4px and the ladder above it tops out
   * at 8px, so base=2 (element 4px, container 6px) keeps corners restrained
   * without collapsing them. Astryx's default base=4 would put cards at 12px and
   * pages at 28px — visibly rounder than any Graphite surface. The exact Graphite
   * radius set is pinned in the explicit tokens below; this config only sets the
   * ladder the components read.
   */
  radius: {base: 2, multiplier: 1},

  syntax: graphiteSyntax,

  tokens: {
    // =======================================================================
    // Surfaces. Graphite's three-step surface ladder maps one-to-one:
    //   --bg-0 page canvas    → background-body
    //   --bg-1 raised sheet   → background-surface / card / popover
    //   --bg-2 quiet recess   → background-muted, accent-muted (hover tint)
    // Graphite lifts a card with a hairline --line border plus a low shadow, not
    // with tone, so card and popover share --bg-1 rather than stepping further.
    // =======================================================================
    '--color-background-body': ['#e8edf1', '#10151b'], // --bg-0
    '--color-background-surface': ['#fcfdfe', '#1a212a'], // --bg-1
    '--color-background-card': ['#fcfdfe', '#1a212a'], // --bg-1
    '--color-background-popover': ['#fcfdfe', '#1a212a'], // --bg-1
    '--color-background-muted': ['#dadfe5', '#232c37'], // --bg-2
    '--color-background-inverted': ['#0b0f14', '#eef3f8'], // --ink / --ink flipped

    // =======================================================================
    // Accent. --accent teal is the brand and the interactive colour;
    // --accent-soft is Graphite's own accent wash, so accent-muted reads as the
    // hover/selected tint without inventing an alpha.
    // =======================================================================
    '--color-accent': ['#0a6961', '#2fb6a4'], // --accent
    '--color-accent-muted': ['rgba(10,105,97,0.12)', 'rgba(47,182,164,0.14)'], // --accent-soft
    // --color-neutral is the low-key chip/wash. Derived from --ink-low
    // (#586471 / #8593a0) at 12%/14% — the same alpha Graphite uses for
    // --accent-soft, applied to the neutral rung so the two washes weigh alike.
    '--color-neutral': ['rgba(88,100,113,0.12)', 'rgba(133,147,160,0.14)'],

    // Overlays. The scrim is the darkest ink at 60%/80% so a dialog reads over
    // either canvas; hover/pressed tints follow Graphite's grid-line alpha
    // convention (a wash of the ink ladder, never a colour).
    '--color-overlay': ['rgba(11,15,20,0.60)', 'rgba(8,14,22,0.80)'],
    '--color-overlay-hover': ['rgba(88,100,113,0.08)', 'rgba(133,147,160,0.08)'],
    '--color-overlay-pressed': ['rgba(88,100,113,0.16)', 'rgba(133,147,160,0.16)'],

    // =======================================================================
    // Text — the Graphite ink ladder, one rung per Astryx role.
    //   --ink      primary body and headings   (18.87:1 light / 14.53:1 dark on --bg-1)
    //   --ink-mute secondary / supporting      ( 9.32:1 / 6.61:1)
    //   --ink-low  disabled and placeholder    ( 5.93:1 / 5.16:1)
    // --ink-soft (#1c232b / #cdd7e0) has no Astryx text slot; it is spent on the
    // syntax `variable` token, where Graphite also uses it for code identifiers.
    // =======================================================================
    '--color-text-primary': ['#0b0f14', '#eef3f8'], // --ink
    '--color-text-secondary': ['#3b4753', '#9aa7b4'], // --ink-mute
    '--color-text-disabled': ['#586471', '#8593a0'], // --ink-low
    '--color-text-accent': ['#0a6961', '#2fb6a4'], // --accent — links ride the brand
    '--color-on-dark': '#eef3f8', // dark-mode --ink
    '--color-on-light': '#0b0f14', // light-mode --ink
    // Text ON a filled accent/status surface. --bg-1 in light (6.43:1 on the
    // teal) and --bg-0 in dark (7.29:1 on the brighter teal) — the ink flips
    // because the dark-mode fills are the bright end of each hue.
    '--color-on-accent': ['#fcfdfe', '#10151b'],
    '--color-on-success': ['#fcfdfe', '#10151b'],
    '--color-on-error': ['#fcfdfe', '#10151b'], // 6.77:1 / 5.33:1
    '--color-on-warning': ['#fcfdfe', '#10151b'], // 6.58:1 / 7.95:1

    // Icons track the text ladder — Graphite draws icons in ink, not in a
    // separate grey.
    '--color-icon-accent': ['#0a6961', '#2fb6a4'],
    '--color-icon-primary': ['#0b0f14', '#eef3f8'],
    '--color-icon-secondary': ['#3b4753', '#9aa7b4'],
    '--color-icon-disabled': ['#586471', '#8593a0'],

    // =======================================================================
    // Status / sentiment, from bridge.css's status ramp:
    //   success ← --status-done       teal   (Graphite rations colour; the
    //                                         accent IS the positive hue)
    //   warning ← --status-in-progress amber (= --warn)
    //   error   ← --status-blocked     brick (= --neg)
    // The -muted slots are each hue at Graphite's own accent-soft alpha, so a
    // banner surface composites onto whatever sits behind it instead of reading
    // as a hard colour panel. Every text stop clears AA on its own tint
    // (measured 4.52:1 – 7.00:1 over --bg-1).
    // =======================================================================
    '--color-success': ['#0a6961', '#2fb6a4'], // --status-done
    '--color-success-muted': ['rgba(10,105,97,0.12)', 'rgba(47,182,164,0.14)'],
    '--color-warning': ['#7a5512', '#d6a23f'], // --warn / --status-in-progress
    '--color-warning-muted': ['rgba(122,85,18,0.12)', 'rgba(214,162,63,0.14)'],
    '--color-error': ['#9a3b33', '#e0635a'], // --neg / --status-blocked
    '--color-error-muted': ['rgba(154,59,51,0.12)', 'rgba(224,99,90,0.14)'],
    // Inverted error surface (destructive toast): the deeper brick from
    // GRAPHITE_SERIES[4] in light, --neg in dark. Both take --bg-1 as ink.
    '--color-background-error-inverted': ['#a3341f', '#e0635a'],

    // =======================================================================
    // Lines. Graphite's hairline is --line and its emphasized sibling is
    // --line-strong. Astryx --color-border is used for hairlines everywhere, so
    // it takes --line literally rather than an alpha — the whole point of the
    // Graphite hairline is that it is a defined value, not a wash.
    // =======================================================================
    '--color-border': ['#c7cfd7', '#303b47'], // --line
    '--color-border-emphasized': ['#a9b4bf', '#46545f'], // --line-strong
    '--color-skeleton': ['#dadfe5', '#232c37'], // --bg-2, a quiet pulse
    '--color-track': ['#dadfe5', '#232c37'], // --bg-2, the progress channel
    // Shadow tint. Graphite's shadow set is cool blue-black rgba(8,14,22,·) —
    // never a warm grey — deepened in dark mode where the canvas absorbs more.
    '--color-shadow': ['rgba(8,14,22,0.12)', 'rgba(8,14,22,0.40)'],
    '--color-tint-hover': ['#0b0f14', '#eef3f8'], // ink, both directions

    // =======================================================================
    // Categorical hues. Astryx wants 10 (blue, cyan, gray, green, orange, pink,
    // purple, red, teal, yellow); Graphite names 8 usable ones between
    // GRAPHITE_SERIES, --accent-2, --warn, --neg, and the status ramp's plum and
    // magenta. Green and cyan have no Graphite source, so each is the ACCENT
    // rotated in OKLCH to the target hue with L and C held — the accent's exact
    // lightness and chroma, only the hue moved, so it sits in the palette as an
    // equal rather than a louder import:
    //   green  H→148  #0a6961 → #396741   |  #2fb6a4 → #6ab376
    //   cyan   H→225  #0a6961 → #19647c   |  #2fb6a4 → #3aadd5
    //
    // Per-slot tone choice, uniform across all 10 hues:
    //   background  the hue at Graphite's accent-soft alpha (12% light / 14% dark)
    //   border      the hue at full strength — a hairline needs to be a value
    //   icon        the hue at full strength
    //   text        the hue at full strength, unless that misses AA on its own
    //               background tint, in which case it is lifted in OKLCH L
    // =======================================================================

    // Teal — --accent / GRAPHITE_SERIES[0]. text 5.38:1 light / 5.09:1 dark on tint.
    '--color-background-teal': ['rgba(10,105,97,0.12)', 'rgba(47,182,164,0.14)'],
    '--color-border-teal': ['#0a6961', '#2fb6a4'],
    '--color-icon-teal': ['#0a6961', '#2fb6a4'],
    '--color-text-teal': ['#0a6961', '#2fb6a4'],

    // Blue — --accent-2 navy / GRAPHITE_SERIES[1]. text 7.00:1 / 5.05:1 on tint.
    '--color-background-blue': ['rgba(39,77,122,0.12)', 'rgba(122,166,224,0.14)'],
    '--color-border-blue': ['#274d7a', '#7aa6e0'],
    '--color-icon-blue': ['#274d7a', '#7aa6e0'],
    '--color-text-blue': ['#274d7a', '#7aa6e0'],

    // Purple — plum, GRAPHITE_SERIES[2] / --status-review.
    // Dark text is the plum lifted +0.04 OKLCH L (#b482cc → #c18ed9): the
    // unlifted plum reads 4.38:1 on its own dark tint, under AA. The background,
    // border, and icon slots keep the Graphite hex.
    '--color-background-purple': ['rgba(106,63,118,0.12)', 'rgba(180,130,204,0.14)'],
    '--color-border-purple': ['#6a3f76', '#b482cc'],
    '--color-icon-purple': ['#6a3f76', '#b482cc'],
    '--color-text-purple': ['#6a3f76', '#c18ed9'], // 6.61:1 / 5.09:1 on tint

    // Orange — ochre, GRAPHITE_SERIES[3]. text 4.52:1 / 5.48:1 on tint.
    '--color-background-orange': ['rgba(154,91,22,0.12)', 'rgba(214,162,63,0.14)'],
    '--color-border-orange': ['#9a5b16', '#d6a23f'],
    '--color-icon-orange': ['#9a5b16', '#d6a23f'],
    '--color-text-orange': ['#9a5b16', '#d6a23f'],

    // Red — brick, GRAPHITE_SERIES[4].
    // Dark text is the brick lifted +0.04 OKLCH L (#e0635a → #ee7066): the
    // unlifted brick reads 3.98:1 on its own dark tint, under AA. Note this is
    // the CATEGORICAL red; --color-error stays on --neg #9a3b33 / #e0635a.
    '--color-background-red': ['rgba(163,52,31,0.12)', 'rgba(224,99,90,0.14)'],
    '--color-border-red': ['#a3341f', '#e0635a'],
    '--color-icon-red': ['#a3341f', '#e0635a'],
    '--color-text-red': ['#a3341f', '#ee7066'], // 5.56:1 / 4.66:1 on tint

    // Yellow — --warn amber / --status-in-progress. text 5.52:1 / 5.48:1 on tint.
    '--color-background-yellow': ['rgba(122,85,18,0.12)', 'rgba(214,162,63,0.14)'],
    '--color-border-yellow': ['#7a5512', '#d6a23f'],
    '--color-icon-yellow': ['#7a5512', '#d6a23f'],
    '--color-text-yellow': ['#7a5512', '#d6a23f'],

    // Pink — --status-needs-human magenta, the carved-out human-in-the-loop hue.
    // text 5.84:1 / 4.69:1 on tint.
    '--color-background-pink': ['rgba(143,47,134,0.12)', 'rgba(255,61,240,0.14)'],
    '--color-border-pink': ['#8f2f86', '#ff3df0'],
    '--color-icon-pink': ['#8f2f86', '#ff3df0'],
    '--color-text-pink': ['#8f2f86', '#ff3df0'],

    // Green — DERIVED: --accent rotated to OKLCH H=148, L and C held.
    // text 5.44:1 / 5.05:1 on tint.
    '--color-background-green': ['rgba(57,103,65,0.12)', 'rgba(106,179,118,0.14)'],
    '--color-border-green': ['#396741', '#6ab376'],
    '--color-icon-green': ['#396741', '#6ab376'],
    '--color-text-green': ['#396741', '#6ab376'],

    // Cyan — DERIVED: --accent rotated to OKLCH H=225, L and C held.
    // text 5.48:1 / 4.96:1 on tint.
    '--color-background-cyan': ['rgba(25,100,124,0.12)', 'rgba(58,173,213,0.14)'],
    '--color-border-cyan': ['#19647c', '#3aadd5'],
    '--color-icon-cyan': ['#19647c', '#3aadd5'],
    '--color-text-cyan': ['#19647c', '#3aadd5'],

    // Gray — --status-closed, which is --ink-low. The categorical neutral, so
    // text steps up to --ink-soft for a readable chip (13.22:1 / 9.02:1 on tint).
    '--color-background-gray': ['rgba(88,100,113,0.12)', 'rgba(133,147,160,0.14)'],
    '--color-border-gray': ['#a9b4bf', '#46545f'], // --line-strong
    '--color-icon-gray': ['#586471', '#8593a0'], // --ink-low
    '--color-text-gray': ['#1c232b', '#cdd7e0'], // --ink-soft

    // =======================================================================
    // Type ramp — pinned on top of the scale ladder, same mechanism as the
    // radius set below. One step above Graphite's print-dense ramp: body data
    // reads at 16px, labels at 14px, and nothing on the page renders below
    // 12px. Heading steps (lg and up) stay on the built ladder.
    // =======================================================================
    '--font-size-base': '1rem',
    '--font-size-sm': '0.875rem',
    '--font-size-xs': '0.75rem',

    // =======================================================================
    // Radius — Graphite's exact set from SCALE, pinned on top of the base=2
    // ladder so --radius-inner is --radius-sm (2px), --radius-element is
    // --radius (4px), --radius-container is --radius-lg (6px). The page/chat
    // steps have no Graphite counterpart; they land on --radius-xl (8px), the
    // top of Graphite's ladder, rather than the 14px the multiplier would give.
    // =======================================================================
    '--radius-none': '0px',
    '--radius-inner': '0.125rem', // --radius-sm
    '--radius-element': '0.25rem', // --radius / --radius-md
    '--radius-container': '0.375rem', // --radius-lg
    '--radius-page': '0.5rem', // --radius-xl
    '--radius-chat': '0.5rem', // --radius-xl
    '--radius-full': '9999px',

    // =======================================================================
    // Shadows — Graphite's calm set from SCALE, verbatim, with the cool
    // blue-black tint. Astryx has three elevations to Graphite's three, so the
    // mapping is direct: low←--shadow-sm, med←--shadow-md, high←--shadow-lg.
    // Dark mode deepens the same geometry (the canvas absorbs a 12% drop).
    // No rim highlight: Graphite lifts with a hairline border, not a bezel.
    // =======================================================================
    '--shadow-low': ['0 1px 2px rgba(8, 14, 22, 0.06)', '0 1px 2px rgba(8, 14, 22, 0.30)'],
    '--shadow-med': ['0 2px 8px rgba(8, 14, 22, 0.08)', '0 2px 8px rgba(8, 14, 22, 0.40)'],
    '--shadow-high': ['0 6px 22px rgba(8, 14, 22, 0.12)', '0 6px 22px rgba(8, 14, 22, 0.55)'],
    // Input state rings — each hue at 30%, the alpha Astryx uses for rings, on
    // the Graphite hue rather than a stock blue/green/red.
    '--shadow-inset-hover': 'inset 0 0 0 2px rgba(88,100,113,0.20)',
    '--shadow-inset-selected': 'inset 0 0 0 2px rgba(10,105,97,0.40)',
    '--shadow-inset-success': 'inset 0 0 0 2px rgba(10,105,97,0.30)',
    '--shadow-inset-warning': 'inset 0 0 0 2px rgba(122,85,18,0.30)',
    '--shadow-inset-error': 'inset 0 0 0 2px rgba(154,59,51,0.30)',

    // =======================================================================
    // Graphite tokens with no Astryx home, published here so a workbench can
    // read one system rather than re-deriving. The builder emits any custom
    // property in this map verbatim into the theme's `:scope` block, so these
    // resolve as `var(--wb-…)` inside any themed subtree.
    // =======================================================================
    // Header accent — the per-workbench identity hook. Each workbench sets this
    // ONE property in a :root override; nothing else about the theme changes.
    // Defaults to the Graphite accent (see dependencies.md).
    '--wb-header-accent': ['#0a6961', '#2fb6a4'],
    // Graphite's atmospheric grid + accent glows — used by page backgrounds.
    '--wb-grid-line': ['rgba(120,134,150,0.20)', 'rgba(120,140,160,0.12)'],
    '--wb-glow-1': ['rgba(10,105,97,0.07)', 'rgba(47,182,164,0.10)'],
    '--wb-glow-2': ['rgba(39,77,122,0.06)', 'rgba(122,166,224,0.08)'],
    // Graphite's tracking voice: labels/tags/captions ride --track-label, the
    // wider --track-eyebrow is for section eyebrows. Astryx has no tracking
    // token at all, so both live here and the Badge override below consumes one.
    '--wb-track-label': '0.08em',
    '--wb-track-eyebrow': '0.14em',
    // --line-strong as a standalone hairline, for a rule that must outrank the
    // ordinary --color-border without becoming ink.
    '--wb-line-strong': ['#a9b4bf', '#46545f'],
    // The mono stack as a token, so a workbench can set a mono column without
    // reaching for the code font role.
    '--wb-font-mono': MONO_STACK,
  } as never, // the --wb-* keys are outside Astryx's TokenName union by design

  components: {
    /**
     * The h1 carries the per-workbench identity: a 3px rule in
     * --wb-header-accent. One custom property per workbench is the whole
     * differentiation mechanism — the token defaults to the Graphite accent, so
     * a workbench that sets nothing still reads correctly.
     */
    heading: {
      'level:1': {
        borderInlineStartWidth: '3px',
        borderInlineStartStyle: 'solid',
        borderInlineStartColor: 'var(--wb-header-accent)',
        paddingInlineStart: 'var(--spacing-3)',
      },
    },

    /**
     * Badges are Graphite's label voice: mono, uppercase-adjacent tracking, and
     * the type-scale's smallest step. Graphite's --track-label exists precisely
     * so surfaces stop scattering near-identical letter-spacing literals.
     */
    badge: {
      base: {
        fontFamily: 'var(--wb-font-mono)',
        letterSpacing: 'var(--wb-track-label)',
        // Core locks Badge to a 20px box; the pinned type ramp needs the label
        // to grow with its text or the glyphs clip.
        height: 'auto',
        minHeight: 'var(--spacing-5)',
      },
    },

    /**
     * Cards. Graphite's --spacing-card is 1.25rem = 20px, which is Astryx
     * --spacing-5. The hairline is explicit because a Graphite card is defined by
     * its --line edge, not by a tonal step away from the canvas — card and body
     * are both quiet surfaces, so without the border the edge disappears.
     */
    card: {
      base: {
        padding: 'var(--spacing-5)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'var(--color-border)',
      },
    },

    /** Sections take the same interior rhythm as cards. */
    section: {
      base: {padding: 'var(--spacing-5)'},
    },

    /**
     * StatusDot. The component's `accent` variant means "attention", which in
     * Graphite is the navy --accent-2, not the teal brand. success/warning/error
     * already resolve through the semantic tokens mapped above, which are the
     * status ramp — no override needed.
     */
    statusdot: {
      'variant:accent': {backgroundColor: 'light-dark(#274d7a, #7aa6e0)'},
    },
  },
});
