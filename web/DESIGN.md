---
name: Swarm Arena
description: A calm, editorial record of four game engines climbing their Elo ladders, in Sanzo Wada colours on paper or night, where every number traces to a played match.
colors:
  bg: 'light-dark(oklch(0.94 0.055 97.3), oklch(0.185 0.004 229))'
  band: 'light-dark(oklch(0.965 0.03 97.3), oklch(0.215 0.004 229))'
  panel: 'light-dark(oklch(0.975 0.022 97.3), oklch(0.235 0.004 229))'
  panel-raised: 'light-dark(oklch(0.905 0.055 97.3), oklch(0.275 0.004 229))'
  line: 'light-dark(oklch(0.86 0.05 97.3), oklch(0.32 0.004 229))'
  line-strong: 'light-dark(oklch(0.74 0.045 97.3), oklch(0.42 0.004 229))'
  fg: 'light-dark(oklch(0.185 0.004 229), oklch(0.94 0.055 97.3))'
  fg-2: 'light-dark(oklch(0.37 0.004 229), oklch(0.84 0.035 97.3))'
  fg-3: 'light-dark(oklch(0.47 0.004 229), oklch(0.7 0.025 97.3))'
  primary: 'var(--fg)'
  primary-fg: 'var(--bg)'
  series-1: 'light-dark(oklch(0.452 0.109 242.8), oklch(0.545 0.109 242.8))'
  series-2: 'light-dark(oklch(0.605 0.087 333.3), oklch(0.68 0.087 333.3))'
  series-3: 'light-dark(oklch(0.584 0.107 178), oklch(0.689 0.127 178))'
  series-4: 'light-dark(oklch(0.595 0.094 105.1), oklch(0.697 0.094 105.1))'
  good: 'light-dark(oklch(0.495 0.112 154.6), oklch(0.535 0.112 154.6))'
  good-text: 'light-dark(oklch(0.488 0.112 154.6), oklch(0.633 0.112 154.6))'
  warning: 'light-dark(oklch(0.594 0.126 105.7), oklch(0.941 0.2 105.7))'
  critical: 'light-dark(oklch(0.54 0.21 20.4), oklch(0.572 0.21 20.4))'
  critical-text: 'light-dark(oklch(0.527 0.21 20.4), oklch(0.672 0.21 20.4))'
  square-light: 'light-dark(oklch(0.8 0.05 97.3), oklch(0.4 0.004 229))'
  square-dark: 'light-dark(oklch(0.72 0.05 97.3), oklch(0.31 0.004 229))'
  stone-black: 'oklch(0.185 0.004 229)'
  stone-white: 'oklch(0.975 0.03 97.3)'
  highlight: 'light-dark(oklch(0.594 0.126 105.7 / 0.35), oklch(0.941 0.2 105.7 / 0.28))'
typography:
  hero:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '3.75rem'
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: '-0.025em'
  chapter:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '3rem'
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: '-0.025em'
  subchapter:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.875rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  intro:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 400
    lineHeight: '32px'
  display:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '-0.025em'
    fontFeature: "'cv11', 'ss01'"
  headline:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: '24px'
  title:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: '20px'
  body:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '24px'
  body-small:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: '20px'
  label:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: '20px'
  meta:
    fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: '20px'
  data:
    fontFamily: 'Geist Mono, ui-monospace, monospace'
    fontSize: '13px'
    fontWeight: 400
    fontFeature: "'tnum'"
  data-large:
    fontFamily: 'Geist Mono, ui-monospace, monospace'
    fontSize: '1.25rem'
    fontWeight: 500
    letterSpacing: '-0.025em'
    fontFeature: "'tnum'"
rounded:
  chip: '5px'
  md: '6px'
  lg: '8px'
  full: '9999px'
spacing:
  hair: '2px'
  xs: '4px'
  sm: '8px'
  row: '10px'
  md: '12px'
  gutter: '16px'
  gutter-wide: '24px'
  gutter-band: '40px'
  section-compact: '56px / 80px'
  section: '80px / 112px'
  section-roomy: '96px / 144px'
  chapter: '48px / 64px'
  sticky: '96px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-fg}'
    rounded: '{rounded.md}'
    typography: '{typography.body-small}'
    height: '32px'
    padding: '0 12px'
  button-primary-hover:
    backgroundColor: '{colors.fg-2}'
  button-secondary:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.fg}'
    rounded: '{rounded.md}'
    height: '32px'
    padding: '0 12px'
  button-secondary-hover:
    backgroundColor: '{colors.panel-raised}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.fg-2}'
    rounded: '{rounded.md}'
    height: '28px'
    padding: '0 10px'
  button-ghost-hover:
    backgroundColor: '{colors.panel-raised}'
    textColor: '{colors.fg}'
  button-icon:
    backgroundColor: 'transparent'
    textColor: '{colors.fg-2}'
    rounded: '{rounded.md}'
    size: '32px'
  button-segment:
    backgroundColor: 'transparent'
    textColor: '{colors.fg-3}'
    rounded: '{rounded.chip}'
    height: '24px'
    padding: '0 8px'
  button-segment-pressed:
    backgroundColor: '{colors.panel-raised}'
    textColor: '{colors.fg}'
  badge-neutral:
    backgroundColor: '{colors.panel-raised}'
    textColor: '{colors.fg-2}'
    rounded: '{rounded.chip}'
    height: '20px'
    padding: '0 6px'
  badge-good:
    backgroundColor: 'color-mix(in oklab, #0ca30c 10%, transparent)'
    textColor: '{colors.good-text}'
    rounded: '{rounded.chip}'
    height: '20px'
    padding: '0 6px'
  badge-critical:
    backgroundColor: 'color-mix(in oklab, #d03b3b 10%, transparent)'
    textColor: '{colors.critical-text}'
    rounded: '{rounded.chip}'
    height: '20px'
    padding: '0 6px'
  panel:
    backgroundColor: '{colors.panel}'
    rounded: '{rounded.lg}'
  panel-header:
    typography: '{typography.title}'
    height: '44px'
    padding: '8px 16px'
  site-header:
    backgroundColor: 'color-mix(in oklab, var(--bg) 90%, transparent)'
    height: '48px'
  section:
    backgroundColor: '{colors.bg} | {colors.band}'
    padding: '{spacing.section} {spacing.gutter}'
  section-heading:
    typography: '{typography.chapter}'
    margin-bottom: '{spacing.chapter}'
  section-nav:
    backgroundColor: 'color-mix(in oklab, var(--bg) 90%, transparent)'
    textColor: '{colors.fg-3}'
    height: '44px'
  section-nav-current:
    textColor: '{colors.fg}'
  reading-progress:
    backgroundColor: '{colors.fg-3}'
    height: '1px'
  disclosure-row:
    typography: '{typography.headline}'
    padding: '20px 0'
---

# Design System: Swarm Arena

## Overview

**Creative North Star: "The Referee's Notebook"**

Swarm Arena reads like a well-kept notebook of a long contest: calm, editorial, precise. Long pages run down the vertical axis in chapters, one question per band, with whitespace and a change of ground doing the work that borders and cards used to do. The chrome stays almost colourless (ink, two quieter inks, hairlines), so the saturated things on screen are the data: four engine hues climbing a chart, and the rare green or red of a verdict.

Colour comes from Sanzo Wada's _A Dictionary of Color Combinations_ (1933–34), through the MIT data package `dictionary-of-colour-combinations`. Palettes are chosen as **whole combinations**, never as single swatches: the ground and ink are one combination, the four engines another, the status colours a third. Each token keeps its book colour's hue; lightness or chroma moved only where WCAG AA required it, and every move is listed below next to the book value. The site credits the source in its footer. No scan or PDF of the book is ever committed.

There are two themes, light (paper) and dark (night), from the same combination. The page follows the reader's system setting; `data-theme="light"` or `"dark"` on `<html>` pins one. Each token is written once as `light-dark(<light>, <dark>)` in `app/globals.css`.

Motion is nearly absent: 150ms colour transitions, a scroll-linked hairline of reading progress, and smooth anchor scrolling only when the reader allows motion. Reduced motion collapses all of it.

**Key Characteristics:**

- Paper and night: Sulpher Yellow and Black (Wada 52), each the other's ink.
- One idea per section, stacked vertically, separated by tone and whitespace.
- Colourless chrome: the primary action is the ink colour.
- Four engine hues from one four-colour combination (Wada 347), used only as data identity.
- Status hues from one combination with the same Black (Wada 313), always with an icon and a label.
- Geist for words, Geist Mono only for measured data.

## Colors

### The combinations

| Role           | Combination | Book colours (Wada name, book hex)                                                    |
| -------------- | ----------- | ------------------------------------------------------------------------------------- |
| Ground and ink | **52**      | Sulpher Yellow `#f5ecc2`, Black `#111314`                                             |
| Engine accents | **347**     | Helvetia Blue `#005b8d`, Lilac `#b984af`, Sea Green `#00b49b`, Olive Yellow `#a6a159` |
| Status         | **313**     | Diamine Green `#1a7444`, Carmine `#cc1236`, Yellow `#fff200` (with Black `#111314`)   |

Why these: 52 is the book's quietest pairing of a warm paper and a near-black ink, so it serves both themes without a third hue. 347 has the widest hue spread of the four-colour combinations (no two members closer than 65° in OKLCH), at moderate chroma, so the engines stay distinguishable without shouting. 313 shares 52's Black and holds a green, a red and a yellow, the three states the site reports. The dark-theme candidates offered in the brief (256, 340, 255, 295, 325, 303) were set aside: none has four chromatic members for four engines, and several carry oranges and reds that would clash with the status red.

### Token map

Values are OKLCH; "book" means the token is the book colour exactly. "L" is OKLCH lightness. Each adjustment keeps the book hue and was needed for the contrast named.

| Token                          | Role                   | Book colour (combination)      | Light theme                            | Dark theme              |
| ------------------------------ | ---------------------- | ------------------------------ | -------------------------------------- | ----------------------- |
| `bg`                           | page ground            | Sulpher Yellow / Black (52)    | book `#f5ecc2`                         | book `#111314`          |
| `band`                         | alternate section band | same                           | L 0.94→0.965, C 0.055→0.03             | L 0.185→0.215           |
| `panel`                        | raised surface         | same                           | L→0.975, C→0.022                       | L→0.235                 |
| `panel-raised`                 | hover, pressed         | same                           | L→0.905                                | L→0.275                 |
| `line`                         | hairlines              | same                           | L→0.86, C→0.05                         | L→0.32                  |
| `line-strong`                  | emphasised strokes     | same                           | L→0.74, C→0.045                        | L→0.42                  |
| `fg`                           | ink                    | Black / Sulpher Yellow (52)    | book `#111314`                         | book `#f5ecc2`          |
| `fg-2`                         | body copy              | same                           | L→0.37 (7.9:1)                         | L→0.84, C→0.035 (9.1:1) |
| `fg-3`                         | meta, labels           | same                           | L→0.47 (5.2:1)                         | L→0.70, C→0.025 (5.6:1) |
| `primary` / `primary-fg`       | the action             | `fg` / `bg`                    | ink on paper                           | paper on night          |
| `series-1`                     | Chess                  | Helvetia Blue `#005b8d` (347)  | book                                   | L 0.452→0.545 for 3:1   |
| `series-2`                     | Go                     | Lilac `#b984af` (347)          | L 0.680→0.605 for 3:1                  | book                    |
| `series-3`                     | Othello                | Sea Green `#00b49b` (347)      | L 0.689→0.584, C→0.107 (gamut) for 3:1 | book                    |
| `series-4`                     | Hex                    | Olive Yellow `#a6a159` (347)   | L 0.697→0.595 for 3:1                  | book                    |
| `good`                         | verdict mark           | Diamine Green `#1a7444` (313)  | book                                   | L 0.495→0.535 for 3:1   |
| `good-text`                    | verdict text           | Diamine Green (313)            | L→0.488 for 4.5:1                      | L→0.633 for 4.5:1       |
| `critical`                     | refuted mark           | Carmine `#cc1236` (313)        | book                                   | L 0.540→0.572 for 3:1   |
| `critical-text`                | refuted text           | Carmine (313)                  | L→0.527 for 4.5:1                      | L→0.672 for 4.5:1       |
| `warning`                      | connecting dot         | Yellow `#fff200` (313)         | L 0.941→0.594, C→0.126 (gamut) for 3:1 | book                    |
| `highlight`                    | last-move wash         | Yellow (313)                   | the light `warning` at 35%             | book at 28%             |
| `square-light` / `square-dark` | board cells            | ground (52)                    | L 0.80 / 0.72, C 0.05                  | L 0.40 / 0.31           |
| `stone-black` / `stone-white`  | pieces, stones         | Black / Sulpher Yellow (52)    | book / L→0.975, C→0.03                 | same                    |
| `code-*`                       | source highlighting    | the 347 hues and Diamine Green | each at 4.5:1                          | each at 4.5:1           |

The site's credit: "Colour combinations after Sanzo Wada, _A Dictionary of Color Combinations_" (footer, every page).

`scripts/tokens.test.mjs` (`npm test -w web`) parses these tokens and asserts, in both themes: text tokens 4.5:1 and marks 3:1 on every surface (`bg`, `band`, `panel`, `panel-raised`), and the primary label 4.5:1 on its fill.

### Named Rules

**The Whole Combination Rule.** New colour comes from a Wada combination as a whole, with the combination number recorded here. Keep the book hue; move lightness or chroma only for contrast, and log the move in the token map.

**The Identity, Not Rank Rule.** Colour follows the entity, never its rank. A track's hue is fixed by its slot and never reassigned for leader, sort order or state; track hues never appear on chrome, buttons or text that is not about that track.

**The Reserved Status Rule.** Green and red mean verified and refuted, nothing else. They always ship with an icon and a label (Flag + "Finished", GitMerge + "Landed", CircleSlash + "Ruled dead"); colour alone never carries a status.

**The One Ink Rule.** The only action colour is the ink (`fg`). Chrome stays colourless so the data is the only saturated thing on screen. No glowing accents on dark, no gradient text.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui)
**Body Font:** Geist (with ui-sans-serif, system-ui), stylistic sets `cv11` and `ss01` on
**Label/Mono Font:** Geist Mono (with ui-monospace), tabular figures

**Character:** One neutral grotesk does all the talking at small sizes; its mono sibling is reserved for things the referee measured. The ramp is compact and steps by colour (fg / fg-2 / fg-3) as much as by size.

### Hierarchy

- **Display** (600, 36px rising to 48px at `sm` and 60px at `lg`, tight tracking, balanced wrap): the one h1 of an editorial page's opening section (`SectionHeading level="page"`).
- **Chapter** (600, 30px rising to 48px at `sm`): the h2 that opens each section of a long page; **Sub-chapter** (600, 24px rising to 30px) the h3 inside one; **Intro** (16-18px, 28-32px line height, `fg-2`) is the one or two sentences under it.
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

Pages share one frame: the 48px sticky top bar, the collapsible sidebar, and the footer.

**Editorial pages** spread information along the vertical axis instead of compressing it into one viewport. The homepage was the first (#206); every other route follows on this one system (#218), area by area: engines and versions (#229); games, matches and graveyard (#230); fleet, sessions and tasks (#231); board, messages and news (#232); the explainers (#233). Those pages compose the primitives below. They never fork them: a page that needs something new adds a variant here, in its own pull request, and documents it in this file.

### Sections and bands

- **One question per section.** A page is a stack of full-width `Section` bands, each answering one question, in narrative order: overview, then context, evidence, analysis, further reading. If a section needs two headings to explain itself, it is two sections.
- **Bands alternate.** Sections alternate `plain` (`bg`) and `band` (`band`, the quiet member of Wada 52), starting with `plain`. Never two `band`s in a row. The change of ground and the whitespace mark the boundary: no border, rule or card around a section.
- **A breakout grid** (`.section-grid`): a reading column of up to 72rem, gutters of 16px, 24px from `sm` and 40px from `lg`. Prose inside it keeps its own measure (`max-w-2xl` to `max-w-3xl`).
- **The full-width data section.** A chart, a table or a board that wants room goes in `FullBleed`: `wide` (up to 84rem) for charts and tables, `full` (the whole band) for edge-to-edge data such as the fleet graph. It never reaches past the band, so it never scrolls the page sideways; a table too wide for a phone scrolls inside its own `overflow-x-auto` box.
- **Vary the shape.** Alternate single-column sections with two-column ones (a 5:6 or 2:3 split, text on the left), so the page does not repeat one shape down its length.

### Spacing scale

Vertical rhythm comes from four tokens in `app/globals.css`, each a phone value and a value from `sm` (40rem) up. Sections and headings use these utilities and nothing else for their outer spacing.

| Token (utility)                                    | Phone | `sm` and up | Use                                                       |
| -------------------------------------------------- | ----- | ----------- | --------------------------------------------------------- |
| `--spacing-section-compact` (`py-section-compact`) | 56px  | 80px        | a short section: one line of status, a list of links      |
| `--spacing-section` (`py-section`)                 | 80px  | 112px       | the default                                               |
| `--spacing-section-roomy` (`py-section-roomy`)     | 96px  | 144px       | the opening section, and sections built around a chart    |
| `--spacing-chapter` (`mb-chapter`)                 | 48px  | 64px        | between a section's heading block and its content         |
| `--spacing-sticky` (`scroll-mt-sticky`)            | 96px  | 96px        | anchor offset: the 48px top bar plus the 44px section nav |

Inside a section, step down by the Tailwind scale: 80-128px (`mt-20` to `mt-32`) between sub-sections, 40px (`mt-10`) between a block and its disclosure, 24-32px between list rows (`py-6`, `py-7`), 16-20px between a heading and its intro.

### Headings

Every page has exactly one h1, and the outline never skips a level.

- **Page** (`SectionHeading level="page"`, the `display` type, 36-60px): the route's one h1, in its opening section. On the homepage it is the headline sentence; on other routes it names the page ("The fleet"), with the intro saying what the page answers.
- **Chapter** (`level="chapter"`, the default, 30-48px): the h2 that opens every other section, with an intro of one or two sentences (16-18px, `fg-2`, at most 42rem) and at most two quiet `TextLink`s.
- **Sub-chapter** (`level="sub"`, 24-30px): an h3 inside a section ("The latest game", "Further reading").
- Below that, items in a list carry 16-18px medium titles (h3 or h4 by the outline). Hierarchy comes from size and the three inks, never from uppercase, letter-spacing or an eyebrow label above a heading.

### Wayfinding and reading progress

- **SectionNav.** A page with four or more sections carries a `SectionNav` under the top bar: one link per section, the current one marked. A page with fewer sections needs none.
- **Anchor scrolling.** Links are real `#id` anchors (they work without JavaScript and open in a new tab). A click marks its section at once, glides there only when motion is allowed, lands it under the sticky bars (`scroll-mt-sticky`), moves keyboard focus to it and writes the hash. No scroll snapping, ever.
- **Reading progress.** A 1px `fg-3` hairline that fills with the page scroll, driven by CSS scroll timelines (no script). It rides the `SectionNav`'s bottom edge; a long page with no section nav (a news story, a long explainer) may use `ReadingProgress placement="bar"` instead. Never both. Browsers without scroll timelines and readers with reduced motion see no bar.

### Progressive disclosure

The essentials stay visible; the detail is one click away. Use a `Disclosure` (`inline` under the thing it expands, `row` for a stack of several) or a link to the record's own page. Never hide the one number or sentence a section exists to show. A disclosure's summary says what opening it shows ("The ladders: who each engine has beaten").

### When a card is allowed

Whitespace is the default separator, a hairline (`border-line`, `divide-y`) the second. A card (`Panel`: `panel` fill, `line` border, 8px radius) is allowed only for:

1. **An interactive unit** that must read as one object: a playable board with its controls, a form, a filter bar with its results.
2. **A floating surface**: a tooltip, a popover, the search dialog.
3. **The one lead item** of a list that is otherwise hairline rows (the newest story on `/news`).
4. **A dashboard table** that has to hold together on a page not yet converted.

Never a grid of same-shaped cards, never a card inside a card, never a card around a whole section, and never a card used only to make a number look important: set it large in mono instead.

### One primary action

Each screen has at most one primary button (the ink fill). Secondary actions are `TextLink`s: 15px `fg-2` with a small arrow, underlined on hover.

### Checking a page

Each route's redesign shows, before and after:

- `node web/scripts/impeccable-routes.mjs <base-url> [--only /route]`: Impeccable's `detect` at 1440x900 and 390x844 against a production build. CI runs it for every page route on each pull request that touches `web/` and writes the table to the job summary (the **web-checks** run); quote your route's row. Remaining findings are either fixed or justified in the pull request.
- `/impeccable critique` of the route, and screenshots at 1440 and 390 px in both themes.
- `npm test -w web`: the token contrast test and `scripts/design-system.test.mjs` (the primitives' contract).

### Dashboard pages

Pages not yet converted keep the previous layout: a 90rem container, a title block, then a fluid main column and a fixed 23rem rail, with panels built as hairline rows. Inside panels the rhythm is fixed: 16px horizontal padding, 10px row padding, a 44px header with a hairline under it.

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

### Section primitives (`components/ui`)

The shared editorial layout system (#218). Every primitive is a CVA component with a `data-slot`; import it, pick a variant, and add only layout classes through `className`.

- **Section** (`tone`: `plain` | `band`; `space`: `compact` | `default` | `roomy`; `fill`: `none` | `screen`): a full-width band with an anchor `id`, named by its heading (`labelledBy`), padded from the section spacing scale, with `scroll-margin` that clears the sticky bars. `fill="screen"` makes an opening section fill most of the first viewport.
- **SectionHeading** (`level`: `page` | `chapter` | `sub`; `space`: `default` | `tight` | `none`): the heading block that opens a section: the title at its rung of the outline, an intro capped at about 42rem, and an optional row of quiet links (`action`).
- **SectionNav** (`items`, `label`, `progress`): a sticky list of in-page links, 13px `fg-3` with the current section in `fg` and a 1px ink underline (`aria-current="location"`), on `bg` at 90% with backdrop blur. It scrolls sideways on phones, keeping the current link in view, and handles anchor scrolling as described under Layout.
- **ReadingProgress** (`placement`: `edge` | `bar`): the 1px reading-progress hairline, on the nav's bottom edge or pinned under the top bar.
- **Disclosure** (`variant`: `inline` | `row`): a native `<details>` with a chevron that turns 90°. `inline` has a 15px `fg-2` summary; `row` is a full-width 16px `fg` summary between hairlines, for a stack of several. Works without JavaScript, and find-in-page opens it.
- **FullBleed** (`width`: `wide` | `full`): lets a chart or table leave the reading column.
- **TextLink** (`size`: `default` | `small`; `external`): a secondary action as a text link with an arrow (up-right for `external`), so each screen keeps one primary button.

The type steps they use are Typography's `display`, `chapter`, `subchapter` and `intro` variants.

### Engine feature (homepage)

One engine given room: a 48px logo tile, the name at 24px, its rules library and reference opponents in meta text, the rating in Geist Mono at 48-60px, the version in mono at 24px, and one sentence on where it stands (the next opponent, or "past its ladder: now rated against its own last version"). A hairline on top, no card. The whole block opens the engine; "Play it yourself" is a quiet link.

### Buttons

Quiet and compact; most controls are ghost or segment, colour changes on hover over 150ms.

- **Shape:** gently rounded (6px); segment buttons 5px.
- **Sizes:** default 32px high, 12px padding, 13px text; `sm` 28px, 12px text; `xs` 24px; icon 32px square.
- **Primary:** ink fill (`primary`), ground-coloured text (`primary-fg`), 500 weight; hover drops to `fg-2`. One per screen: the homepage's "Play an engine" (44px high, 15px text).
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

The 48px sticky top bar on `bg` at 90% with backdrop blur and a hairline bottom. Left: a 20px line-mark plus "Swarm Arena" (14px, 600). Right: search, then the live indicator (a 6px dot: pulsing `good` when live, `warning` while connecting, `fg-3` for a static snapshot, always with its word). The pulse is the one ambient animation, kept because it reports live data. The footer carries the Wada credit.

### Progress Chart (signature)

Elo over time, one 2px line per track in its series hue, direct-labelled at the right edge (dot + name + mono Elo) instead of relying on a legend. Finish lines are dashed in the track hue (70% opacity, 35% once finished); gridlines are `line` with mono `fg-3` tick labels. Hovering shows a crosshair with points ringed in `panel` and the Float tooltip listing each engine's version and Elo. An `sr-only` table carries the same data.

### Track Ladder

One hairline row per track: track dot and name, a rail from 0 to the finish (`line-strong` hairline with a 2px fill in the track hue), rungs as 10px rings lit in the track hue once cleared, a 2px white current-Elo marker, then either the next rung in meta text or a good-tone "Finished" badge with a Flag icon, and the mono Elo over its finish. The whole row links to the track and raises to `panel-raised` on hover.

### Board Feed

A filterable log of structured records. Segmented filters for record type and track sit in a header strip. Records group under sticky day dividers (12px medium `fg-3` on translucent `panel`). Each row is a fixed grid: mono time, a 16px lucide icon in the record's tone, then label, track dot and mono seat on one line, title (13px `fg`) and optional detail (12px `fg-3`), and a "Games" arrow link when a match backs it. Tones: neutral `fg-3`, strong `fg-2`, good and critical text tones for verdicts only.

### Breadcrumbs

The trail lives in the top bar, right after the brand, which stands for home: `Swarm Arena / Engines / Hex / Ladder / MCTS 2000`. Separators are a `fg-3` slash at half strength; ancestors are 13px `fg-2` links that fill `panel-raised` on hover; a level with no page of its own (Ladder, Tasks) is plain `fg-3`; the current page is `fg` with `aria-current`. It is built from the URL, and a level named only by an id (a game, a task, a rung) is set in mono until the page's own title replaces it. Phones show only the page (the brand keeps its mark alone), tablets add the parent, desktop shows the whole trail. Item pages carry no separate back link.

### Just in banner

One 40px row under the top bar on every page, on `panel` with a hairline below: a 6px white dot and "Just in" (12px, 500, `fg`), the newest story's headline (13px `fg-2`), its age in mono `fg-3`, "Read the story" and a dismiss icon button. White, not amber or green: it is news, not a verdict. It runs for 48 hours after publishing, hides on the story's own page, and a dismissal is remembered per story and applied before paint.

### News

`/news` opens with the latest story as the one bordered lead (good-tone "Refereed" badge with BadgeCheck, title at 20-24px, lede, engine chip, mono time), then earlier stories as hairline rows under day labels: mono time column, 14px headline, two-line lede, engine chip. A story page is a 42rem reading column: badges, a 32px headline, a 16px lede, meta and a hairline, then the body in `.article` (15px, 1.75 line height, 500-weight `fg` subheads, `fg` strong for the numbers). It ends with "Behind this story", a hairline grid of the version, pull request, engine and the story's own source, so every number in the text is one click from the record.

### Game Board

Inline SVG boards for chess, Go 9x9, Othello and Hex, drawn only from the board tokens (light/dark squares, black/white stones, last-move highlight) with mono 10px `fg-3` coordinates, plus the icon-button replay strip and a range scrubber tinted `fg`.

## Do's and Don'ts

### Do:

- **Do** give each idea its own section, and let the page grow downwards rather than packing a screen.
- **Do** separate sections by alternating `bg` and `band` and by whitespace.
- **Do** keep one primary action per screen; set the rest as text links.
- **Do** take new colours from a whole Wada combination and log any lightness or chroma move in the token map.
- **Do** write every colour token as `light-dark(<light>, <dark>)` and run `npm test -w web` after changing one.
- **Do** give each track one series slot and use it for every mark about that track: line, dot, rung, filter, tooltip row.
- **Do** pair every green or red with a lucide icon and a word.
- **Do** set every measured number in Geist Mono with tabular figures, and its label in sans `fg-3`.
- **Do** direct-label chart series at the line end and keep an accessible table behind the chart.
- **Do** keep transitions to 150ms colour changes and respect reduced motion.

### Don't:

- **Don't** put every element inside a small card, or a section inside a bordered panel.
- **Don't** put a badge or chip row above a headline, or a row of hero metrics under it.
- **Don't** add decoration that carries no information (the homepage has no 3D backdrop).
- **Don't** pick single swatches, change a book hue, or put a hex value in a component.
- **Don't** use a track hue for chrome, buttons, emphasis or decoration, or reassign hues by rank or leader.
- **Don't** use green, red or yellow for anything but verdicts, failures and connecting, and never as colour alone.
- **Don't** add glowing accents, gradient text or a cyan-on-dark palette.
- **Don't** put shadows on panels or rows; depth is tonal.
- **Don't** set prose, headings or labels in mono, or numbers in sans.
- **Don't** use uppercase or letter-spaced labels or eyebrow text above headings.
- **Don't** commit a scan or PDF of Wada's book.
