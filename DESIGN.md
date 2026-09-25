# Studio design system

One look for every product (Keywords, Ads, Screenshots, Video, In-App), copied 1:1 from the
an Adapty-style admin analytics dashboard.
Code: `shared/ds.css` (tokens), `shared/ds-components.css` (component classes),
`shared/charts/` (charts). Each product imports them and maps its own classes in `ds-bridge.css`.

## Shape — the rule people notice first
- **Radius 8px** on every rectangle: cards, tables, popovers, inputs, selects, buttons, drawers, dialogs.
- **Radius 6px** for things inside a control: segment buttons, menu rows, icon buttons, rate chips.
- **Pills (999px) only for tiny status badges** (20px tall). No round buttons, no round inputs,
  no round segmented controls, no square (0px) cards or buttons.

## Controls
- Height **40px** (compact 32px), border **.75px solid `--ds-ctl-border`**, background `--ds-input-bg`,
  text 14px / 500. Hover: border `--ds-muted`. Focus: accent border + soft accent outline.
- Primary button: `--ds-accent` fill, white 600 text, no border. One primary per screen.
- Segmented control: 40px box with 3px padding; inner buttons 32px, radius 6.
- **Active / selected state everywhere** (nav item, segment, menu row, tab): `--ds-accent-soft` background +
  `--ds-accent` text, weight 600. Hover: `--ds-accent-soft` background only.

## Surfaces
- Page background `--ds-bg`. Cards `--ds-panel`, **no border**, `--ds-shadow`, padding 16px, gap 16px.
- Popovers/menus: `--ds-tip-bg`, 1px `--ds-border`, `--ds-shadow-pop`, radius 8, rows radius 6.

## Type (Inter)
- Page title 24/28 600 · section h2 20/24 600 · card title 16/24 600 · body 14/20 · note 13/19 muted.
- No uppercase headers, no letter-spacing (tiny group labels 12px 600 muted are the only small caps-like text).

## Tables
- 14px, tabular numbers; header 600 `--ds-strong`, not uppercase; cells 10px 12px; `--ds-hairline` rows;
  row hover `--ds-accent-soft`; total row `--ds-row-total` 600. Wrapped in a radius-8 box with a hairline border.
- Good/bad values: colored text 600; strong deviation adds a tinted chip (radius 6).

## Charts (`shared/charts`)
- SVG, 2px lines with round joins, 4px rounded data-ends on bars, recessive grid (`--ds-grid`, baseline `--ds-axis`).
- Every chart has a hover tooltip: header + one row per series with a color key and the value.
- Series colors in fixed order `--ds-c1..c4`; semantic colors only for meaning (good/bad/warn).

## Theme
Light by default; dark via `<html data-theme="dark">` (stored in `localStorage.theme`).
