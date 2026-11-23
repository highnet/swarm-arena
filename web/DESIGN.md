---
name: Swarm Arena
description: A dense, quiet dark dashboard where four game engines climb their Elo ladders together and every number traces to a played match.
colors:
  bg: "oklch(0.155 0.006 265)"
  panel: "oklch(0.185 0.006 265)"
  panel-raised: "oklch(0.215 0.007 265)"
  line: "oklch(0.265 0.007 265)"
  line-strong: "oklch(0.34 0.008 265)"
  fg: "oklch(0.965 0.003 265)"
  fg-2: "oklch(0.79 0.008 265)"
  fg-3: "oklch(0.66 0.01 265)"
  primary: "oklch(0.965 0.003 265)"
  primary-fg: "oklch(0.17 0.006 265)"
  series-1: "#3987e5"
  series-2: "#d95926"
  series-3: "#199e70"
  series-4: "#c98500"
  good: "#0ca30c"
  good-text: "#3fbf3f"
  warning: "#fab219"
  critical: "#d03b3b"
  critical-text: "#ef6a6a"
  square-light: "oklch(0.34 0.008 265)"
  square-dark: "oklch(0.27 0.008 265)"
  stone-black: "oklch(0.13 0.004 265)"
  stone-white: "oklch(0.93 0.004 265)"
  highlight: "oklch(0.8 0.12 85 / 0.32)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
    fontFeature: "'cv11', 'ss01'"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "20px"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "24px"
  body-small:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "20px"
  meta:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "20px"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "'tnum'"
  data-large:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "1.25rem"
    fontWeight: 500
    letterSpacing: "-0.025em"
    fontFeature: "'tnum'"
rounded:
  chip: "5px"
  md: "6px"
  lg: "8px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  row: "10px"
  md: "12px"
  gutter: "16px"
  gutter-wide: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-fg}"
    rounded: "{rounded.md}"
    typography: "{typography.body-small}"
    height: "32px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.fg-2}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-raised}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.fg}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.md}"
    size: "32px"
  button-segment:
    backgroundColor: "transparent"
    textColor: "{colors.fg-3}"
    rounded: "{rounded.chip}"
    height: "24px"
    padding: "0 8px"
  button-segment-pressed:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.fg}"
  badge-neutral:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 6px"
  badge-good:
    backgroundColor: "color-mix(in oklab, #0ca30c 10%, transparent)"
    textColor: "{colors.good-text}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 6px"
  badge-critical:
    backgroundColor: "color-mix(in oklab, #d03b3b 10%, transparent)"
    textColor: "{colors.critical-text}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 6px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  panel-header:
    typography: "{typography.title}"
    height: "44px"
    padding: "8px 16px"
  site-header:
    backgroundColor: "color-mix(in oklab, oklch(0.155 0.006 265) 90%, transparent)"
    height: "48px"
---

# Design System: Swarm Arena

## Overview

**Creative North Star: "The Referee's Console"**

Swarm Arena is the category standard played straight: a Linear-grade dark dashboard, dense, quiet and precise. A cool near-black ground carries one raised panel tone, and structure comes from hairline borders rather than boxes, shadows or colour. The chrome is deliberately colourless (white, three greys, hairlines) so that the only saturated things on screen are the data: four track hues climbing a progress chart, and the rare green or red of a verdict.

The system is dark only, by design. There is no light theme and no theme switch; `color-scheme: dark` is set at the root. Density is high and calm: 13-14px UI text, 10px row padding, 16px panel gutters, a 48px top bar. Nothing is decorative. Every saturated mark either identifies a track or reports a status, and every number is set in Geist Mono with tabular figures because it was measured, not written.

Motion is nearly absent. The one ambient animation is the pulsing live dot; everything else is a 150ms colour transition on hover. Reduced-motion collapses all animation and transition durations.

**Key Characteristics:**
- Dark only: near-black ground (hue 265, a faint cool blue) with one raised panel tone and one hover tone.
- Hairline structure: 1px `line` borders and `divide-y` rows; no card shadows.
- Colourless chrome: the primary action colour is the foreground white.
- Four categorical track hues, used only as data identity.
- Status hues reserved for verdicts and always paired with an icon and a label.
- Geist for UI, Geist Mono only for measured data.

## Colors

A colourless greyscale world on a cool near-black ground, with saturation spent only on data identity and status.

### Primary
- **Referee White** (`primary`, same value as `fg`): the single action colour. Used as the fill of primary buttons with near-black text (`primary-fg`), and as the focus-ring colour. There is no brand hue.

### Neutral
- **Arena Night** (`bg`): page ground, top bar (at 90% with backdrop blur), and the inset well behind segmented controls.
- **Panel Slate** (`panel`): every panel surface, the match stat cells, and the cut-out stroke around chart points.
- **Raised Slate** (`panel-raised`): the single hover and pressed tone for rows, links, ghost buttons and pressed segments; also the chart tooltip and neutral badge fill.
- **Hairline** (`line`): all borders, panel header rules, row dividers and chart gridlines.
- **Strong Hairline** (`line-strong`): emphasised strokes only: secondary-button hover border, tooltip border, unlit ladder rungs and rail, scrollbar thumb.
- **Ink** (`fg`): headings, primary text, data values, the current-Elo marker on ladder rails.
- **Ink 2** (`fg-2`): body copy, ledes, nav links, secondary values.
- **Ink 3** (`fg-3`): meta, timestamps, axis labels, "/ finish" denominators, neutral record icons.

### Track identity (categorical data)
- **Track 1 Blue** (`series-1`), **Track 2 Orange** (`series-2`), **Track 3 Aqua** (`series-3`), **Track 4 Amber** (`series-4`): four fixed categorical slots, validated with the dataviz CVD validator against `panel`. A track is assigned a slot once (`color_slot`) and keeps it everywhere: progress-chart lines, legend dots, ladder fill and cleared rungs, feed and filter dots, tooltip rows.

### Status (reserved)
- **Verdict Green** (`good`) with **Verdict Green Text** (`good-text`): landed patches, cleared rungs, finished tracks, working agents. The darker value fills dots and tints badges; the lighter value is the readable text tone.
- **Refuted Red** (`critical`) with **Refuted Red Text** (`critical-text`): rejected patches and ideas ruled dead.
- **Amber** (`warning`): the realtime "connecting" dot.

### Game boards
- **Light Square** (`square-light`) and **Dark Square** (`square-dark`): board cells and the Go/Hex board ground, kept inside the greyscale family.
- **Black Stone** (`stone-black`) and **White Stone** (`stone-white`): pieces and stones for every game.
- **Last-move Highlight** (`highlight`): translucent warm wash over the last move's squares.

### Named Rules
**The Identity, Not Rank Rule.** Colour follows the entity, never its rank. A track's hue is fixed by its slot and never reassigned for leader, sort order or state; track hues never appear on chrome, buttons or text that is not about that track.

**The Reserved Status Rule.** Green and red mean verified and refuted, nothing else. They always ship with an icon and a label (Flag + "Finished", GitMerge + "Landed", CircleSlash + "Ruled dead"); colour alone never carries a status.

**The One White Rule.** The only action colour is the foreground white. Chrome stays greyscale so the data is the only saturated thing on screen.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui)
**Body Font:** Geist (with ui-sans-serif, system-ui), stylistic sets `cv11` and `ss01` on
**Label/Mono Font:** Geist Mono (with ui-monospace), tabular figures

**Character:** One neutral grotesk does all the talking at small sizes; its mono sibling is reserved for things the referee measured. The ramp is compact and steps by colour (fg / fg-2 / fg-3) as much as by size.

### Hierarchy
- **Display / page title** (600, 24px rising to 28px at `sm`, tight tracking, balanced wrap): one per page, the h1 under the top bar.
- **Lede** (400, 15px, 24px line height, `fg-2`): the one or two sentences under the page title; kept to about `max-w-2xl`.
- **Section title** (500, 14px, `fg`): panel headers ("Progress", "Latest game", "Board").
- **Body** (400, 14px, 24px line height, `fg-2`): explanatory copy, `max-w-prose` where it runs long.
- **Small** (400, 13px, 20px line height): record titles, row names, nav links, button text.
- **Meta** (400, 12px, 20px line height, `fg-3`) and **Label** (500, 12px, `fg-3`): timestamps, counters' labels, axis text, record-kind labels, day dividers. Sentence case, never uppercase.
- **Data** (Geist Mono 13px, tabular) and **Big data** (Geist Mono 20px, 500, tight): Elo, scores, plies, counts, times, seat names, engine versions. Stat-cell values on match pages use 18px mono.
- **Badge** (500, 11px, 20px line height): badges only.

### Named Rules
**The Mono Means Measured Rule.** Geist Mono is used only for data: Elo, moves and plies, counts, times, versions and seat IDs, always with tabular figures. Prose, labels and headings are never mono; a measured number is never sans.

**The Sentence Case Rule.** All labels, titles and badges are sentence case at normal tracking. Hierarchy comes from weight and the three ink tones, not from caps or letter-spacing.

## Layout

A single centred container, `max-w-[90rem]` (1440px), with a 16px side gutter rising to 24px at `sm`, shared by the top bar, every page and the footer. Pages open with a title block (title + lede on the left, an inline `dl` of mono counters on the right at `lg`), then a two-column grid: a fluid main column and a fixed 23rem (368px) rail, gap 16px, collapsing to one column below `lg`. Match pages use a 2-up / 4-up stat strip built as a `gap-px` grid on a `line` background (hairlines between cells) and a `md:2 / xl:3` game grid.

Inside panels the rhythm is fixed: 16px horizontal padding, 10px vertical row padding, 44px minimum header height with a hairline under it. Lists are `divide-y` hairline rows, not spaced cards. The top bar is 48px and sticky; day dividers in the board feed stick at 48px beneath it. Feature-row grids use fixed label columns (`7.5rem`/`8.5rem` for track names, `3rem` for times) so numbers align down the page.

## Elevation & Depth

Flat and tonal. Depth is three steps of lightness on one hue (`bg` < `panel` < `panel-raised`) separated by 1px hairlines; panels carry no shadow. Shadows exist in exactly two places, both state- or float-driven: the progress-chart hover tooltip and the pressed segment in a segmented control. The sticky top bar and feed day dividers use translucency plus backdrop blur instead of a shadow.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.45)`): the progress-chart crosshair tooltip, which sits on `panel-raised` with a `line-strong` border.
- **Pressed segment** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.4)`): the active option in a segmented filter, lifting it out of its `bg` well.

### Named Rules
**The Tonal Ladder Rule.** Surfaces separate by lightness step and hairline, never by shadow. A shadow appears only on something that floats above the page (tooltip) or on a pressed control.

## Shapes

Small, consistent radii and hairline outlines. Panels are 8px; buttons, notices, nav links, the segmented well and tooltips are 6px; badges and segment buttons are 5px; status and track dots, ladder rungs and the ladder fill are full circles. On mobile the `flush` panel drops its side borders and radius to run edge to edge, regaining them at `sm`. Focus is a 2px `fg` outline at 2px offset with a 4px radius on every focusable element. Game boards use their own small rounding (4-6px on the board ground) and dashed strokes are reserved for the chart: finish lines (6 5) and time ticks (2 4).

## Components

### Buttons
Quiet and compact; most controls are ghost or segment, colour changes on hover over 150ms.
- **Shape:** gently rounded (6px); segment buttons 5px.
- **Sizes:** default 32px high, 12px padding, 13px text; `sm` 28px, 12px text; `xs` 24px; icon 32px square.
- **Primary:** white fill (`primary`), near-black text, 500 weight; hover drops to `fg-2`. Defined for a single page-level action; no page uses it yet.
- **Secondary (default):** `panel` fill, `line` border, `fg` text; hover raises to `panel-raised` with a `line-strong` border.
- **Ghost / Icon:** transparent, `fg-2`; hover fills `panel-raised` and brightens to `fg`. Icon buttons drive the game replay (previous, play/pause, next).
- **Segment:** lives in a `bg` well with 2px padding; idle `fg-3`, pressed (`aria-pressed`) `panel-raised` + `fg` + the pressed-segment shadow. Track options carry their 6px track dot.
- **Disabled:** 40% opacity, not-allowed cursor.

### Chips (Badges)
- **Style:** 20px high, 6px horizontal padding, 5px radius, 1px border, 11px medium text, optional 12px leading icon.
- **Tones:** neutral (`panel-raised`, `line` border, `fg-2`); outline (transparent, `line`, `fg-3`); good and critical each use their status colour at 40% for the border, 10% for the fill and the readable text tone for the label.

### Cards / Containers (Panel)
- **Corner Style:** 8px, or flush edge to edge on mobile.
- **Background:** `panel`, 1px `line` border, no shadow.
- **Header:** optional; 44px minimum, 16px horizontal padding, section title left and actions (legend, filters, links) right, hairline below.
- **Internal Padding:** set by the body: 16px for prose blocks, 16px x 10px for list rows, flush for charts and lists.

### Navigation
The 48px sticky top bar on `bg` at 90% with backdrop blur and a hairline bottom. Left: a 20px line-mark plus "Swarm Arena" (14px, 600). Right: 13px `fg-2` links with 6px radius that fill `panel-raised` on hover (hidden below `sm`), a 16px hairline divider, then the live indicator (a 6px dot: pulsing `good` when live, `warning` while connecting, `fg-3` for a static snapshot, always with its word).

### Progress Chart (signature)
Elo over time, one 2px line per track in its series hue, direct-labelled at the right edge (dot + name + mono Elo) instead of relying on a legend. Finish lines are dashed in the track hue (70% opacity, 35% once finished); gridlines are `line` with mono `fg-3` tick labels. Hovering shows a crosshair with points ringed in `panel` and the Float tooltip listing each engine's version and Elo. An `sr-only` table carries the same data.

### Track Ladder
One hairline row per track: track dot and name, a rail from 0 to the finish (`line-strong` hairline with a 2px fill in the track hue), rungs as 10px rings lit in the track hue once cleared, a 2px white current-Elo marker, then either the next rung in meta text or a good-tone "Finished" badge with a Flag icon, and the mono Elo over its finish. The whole row links to the track and raises to `panel-raised` on hover.

### Board Feed
A filterable log of structured records. Segmented filters for record type and track sit in a header strip. Records group under sticky day dividers (12px medium `fg-3` on translucent `panel`). Each row is a fixed grid: mono time, a 16px lucide icon in the record's tone, then label, track dot and mono seat on one line, title (13px `fg`) and optional detail (12px `fg-3`), and a "Games" arrow link when a match backs it. Tones: neutral `fg-3`, strong `fg-2`, good and critical text tones for verdicts only.

### Game Board
Inline SVG boards for chess, Go 9x9, Othello and Hex, drawn only from the board tokens (light/dark squares, black/white stones, last-move highlight) with mono 10px `fg-3` coordinates, plus the icon-button replay strip and a range scrubber tinted `fg`.

## Do's and Don'ts

### Do:
- **Do** build every surface from the three-step tonal ladder (`bg`, `panel`, `panel-raised`) and 1px `line` hairlines.
- **Do** give each track one series slot and use it for every mark about that track: line, dot, rung, filter, tooltip row.
- **Do** pair every green or red with a lucide icon and a word, as the ladder's Flag + "Finished" and the feed's verdict rows do.
- **Do** set every measured number in Geist Mono with tabular figures, and its label in sans `fg-3`.
- **Do** direct-label chart series at the line end and keep an accessible table behind the chart.
- **Do** keep transitions to 150ms colour changes and respect reduced motion.

### Don't:
- **Don't** add a light theme or theme toggle; the system is dark only.
- **Don't** use a track hue for chrome, buttons, emphasis or decoration, or reassign hues by rank or leader.
- **Don't** add a fifth categorical hue without re-running the CVD validator against `panel`.
- **Don't** use green, red or amber for anything but verdicts, failures and connecting, and never as colour alone.
- **Don't** introduce a brand accent; the primary is white.
- **Don't** put shadows on panels or rows; depth is tonal.
- **Don't** set prose, headings or labels in mono, or numbers in sans.
- **Don't** use uppercase or letter-spaced labels or eyebrow text above headings.
