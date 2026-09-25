# ASO Studio Clarity

An original analytics design language for ASO Studio, informed by the usability patterns in the user's Adapty dashboard reference. Do not copy Adapty branding, logo, proprietary assets, or exact visual identity.

## Principles

- Data before decoration.
- One app, market, date range, and freshness context is always visible.
- One purple action accent; semantic colors only communicate meaning.
- Charts explain change; tables support comparison; drawers expose evidence.
- Every modeled metric shows its formula, inputs, source, freshness, and confidence.
- Partial and unavailable data remain visible instead of silently disappearing.

## Tokens

```css
:root {
  --canvas: #ffffff;
  --rail: #fcfcfd;
  --surface: #ffffff;
  --surface-subtle: #f8f8fa;
  --surface-hover: #f6f4fc;
  --surface-selected: #f1edff;

  --border: #e7e7eb;
  --border-control: #d9d9df;
  --border-strong: #b8bac2;

  --ink: #29292d;
  --ink-secondary: #55575e;
  --ink-muted: #74767e;
  --ink-subtle: #9799a1;

  --accent: #6540e8;
  --accent-hover: #5430d3;
  --accent-soft: #f1ecff;
  --chart-violet: #a586f7;
  --chart-blue: #779df5;
  --chart-green: #97d77f;
  --chart-coral: #ff8f7e;
  --chart-grid: #ececf0;

  --positive: #2f8f41;
  --positive-soft: #eaf7e8;
  --negative: #d9483b;
  --negative-soft: #fff0ed;
  --warning: #b36b00;
  --warning-soft: #fff6df;
  --info: #3974d8;

  --radius-control: 6px;
  --radius-card: 8px;
  --radius-overlay: 10px;
  --shadow-card: 0 2px 9px rgba(24, 24, 35, .055);
  --shadow-menu: 0 10px 28px rgba(24, 24, 35, .14);

  --rail-width: 188px;
  --context-height: 40px;
  --control-height: 34px;
  --table-row-height: 42px;
}
```

Use `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; use a monospace stack only for identifiers, API paths, and tabular raw data. Meaningful text is never smaller than 12px.

## Information architecture

The left rail owns product modules, not the app list:

- Overview
- Keywords
- Traffic Intelligence
- Discovery
- Competitors
- Metadata & Experiments
- Analytics
- Data Sources

The 40px context bar owns app, country, date range, source freshness, and sync. Store context in the URL when route migration is complete.

## Controls and navigation

- Controls are compact bordered rectangles with 6px radius, not pills.
- Pills are reserved for short semantic statuses.
- Page title and documentation link sit above underline tabs.
- Keep one visually dominant action per view.
- Focus uses a visible 2px accent outline with 2px offset.
- Hover-only actions are forbidden; destructive actions remain visible or live in a visible overflow menu.

## Metrics and charts

Use four-column metric grids on wide screens and two columns below 1280px. Each card contains a definition, current value, period delta, compact chart, and provenance/freshness detail.

Charts use flat fills and strokes without gradients. Gridlines use `--chart-grid`. Violet is the primary series; blue is comparison; green/coral are genuinely positive/negative components. Show a numeric table beneath detailed charts.

Never label Apple popularity as searches or monthly volume. Never label organic top apps as paid-auction winners. Modeled traffic, difficulty, and opportunity need a visible `Calculated` marker and formula.

## Tables

- Continuous rows with 1px separators; no gaps or card-shaped rows.
- Sticky header and sticky keyword column for wide intelligence tables.
- 12px medium headers and 13px cells, tabular numerals aligned right.
- Position tables begin with one compact KPI strip, then a continuous table; do not duplicate navigation as tabs above it.
- Organic top-five rows preserve the tracked app in its real slot. Mark it with an accent outline and a short `Наше приложение` label in detailed views.
- Inline position trends use a 1.35px smooth stroke, a low-opacity flat area fill, and semantic direction color. Lower rank values are better.
- Details open in a 480px right drawer without losing table scroll/filter state.
- Every table has loading, empty, filtered-empty, stale, partial, permission, rate-limit, and upstream-error states.

## Experiment journal

- Metadata snapshots are append-only observations; their title, subtitle, keyword field, locale, source and timestamp are never overwritten by an experiment.
- An experiment is a hypothesis plus explicit before/after dates. It never publishes App Store Connect changes from the dashboard.
- Default to all storefronts for portfolio views. Use a storefront selector only for locale-specific metadata and preserve the all-storefront comparison above it.
- Treat public competitor metadata, public ad-repository creative, authorized partner exports and manual observations as distinct evidence sources. A missing `ppid` must display as unconfirmed CPP, never as absence of a CPP.

## Responsive and accessibility

- Below 1280px: KPI grid becomes two columns; chart legend moves below.
- Below 1024px: rail collapses to a 52px icon rail.
- Below 768px: rail becomes an overlay, filters become a sheet, details become full screen, and tables expose secondary fields in row details.
- Touch targets are at least 44px on touch layouts.
- Meet WCAG 2.2 AA contrast, use `aria-sort`, keyboard-accessible tooltips, focus traps for drawers/dialogs, `aria-live` for sync, and text labels in addition to status color.
- Respect `prefers-reduced-motion`.
