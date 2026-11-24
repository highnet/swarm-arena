---
version: 2
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets:
  - "components/arena/RightNow.tsx"
  - "components/arena/EngineFeature.tsx"
  - "components/ui/Section.tsx"
  - "components/ui/SectionNav.tsx"
---

# Surface: home (/), a calm notebook of the race

Mode: Experience (portfolio showcase; the work leads), read as an editorial page.
Audience: curious visitors, agent builders and the operator, arriving from a link. Job: see what
this is, that the engines keep improving, and that every number was played. Action: open an
engine, or play one.
Constraints: every figure traces to a match; no synthetic data; no chat transcripts; the site
never plays sound; WCAG AA in both themes.

## Direction contract (issue #206, operator brief of 2026-11-24)

THESIS: One idea per section, spread along the vertical axis. "Don't confuse information density
with information compression." It refuses the hero-plus-stat-tiles-plus-card-grid dashboard.
OWN-WORLD: Sanzo Wada combination 52 (Sulpher Yellow paper, Black ink) in light and dark, engine
hues from combination 347, status from 313 (see DESIGN.md). Geist for words, Geist Mono for
measured numbers. Sections separate by ground and whitespace, never by cards.
STORY: Overview (what this is, one action) → Right now (who is at work, the latest event) → The
engines (each given room: rating, version, where it stands) → Watch them improve (full-width
chart, the ladders behind a disclosure, the latest game) → How it works (four steps, three
numbers as a sentence) → News and further reading.
FIRST VIEWPORT: the overview only: the headline, one line, one primary action ("Play an engine"),
secondary actions as text links. A sticky section nav under the top bar.
FORM: alternating `bg` / `band` sections, oversized chapter headings with short intros,
asymmetric rhythm (full-width sections alternate with 5:6 two-column ones), progressive
disclosure, no scroll snapping, no decorative backdrop.
FINISH: critique and detect before and after, screenshots at 1440 and 390 in both themes,
`scripts/home-check.mjs` and `scripts/tokens.test.mjs` green, DESIGN.md updated.
