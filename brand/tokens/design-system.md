# Design system

Everything here is rendered live at **`/design-system`** in the running app. That page
imports the real components from `src/components/ui`, so it cannot drift from the product.
If a token changes, the page changes.

Source of truth for tokens: **`src/styles/theme.css`** (Tailwind v4 `@theme`).

---

## Brand mark

`src/assets/brand/logo-full.svg` is the supplied lockup, **copied verbatim**. It is never
recoloured, redrawn or stretched. `logo-mark.svg` is the flame glyph alone, extracted from
the same file for the collapsed rail, the favicon and the assistant avatar.

Clear space of one "O" is preserved on all sides, per the visual identity guide (p.11).

> **Note on logo colour.** The supplied SVG draws the wordmark in `#142B3A`; the guide
> specifies Fidato Black `#031728`. The rule "don't alter the logo" wins — the file is used
> untouched, and `#031728` is used for UI ink only. Worth confirming with the brand team
> which is authoritative.

---

## Colour

From the visual identity guide, p.13.

| Token | Hex | Used for |
|---|---|---|
| `ink-900` | `#031728` | Fidato Black — sidebar, headings, primary text |
| `brand-orange` | `#DF6128` | Primary action, active navigation |
| `brand-tangerine` | `#EB8C00` | Secondary accent, second chart series |
| `brand-yellow` | `#FFB600` | Pending, warning |
| `brand-rose` | `#DB536A` | Attention, no-show |
| `brand-red` | `#E0301E` | Destructive, error, overdue |
| `grey-700` | `#354552` | Body text |
| `grey-500` | `#67737E` | Secondary text |
| `grey-400` | `#9AA2A9` | Tertiary text, icons |
| `grey-300` | `#CCD0D4` | Borders, disabled |

Surfaces: page `#F7F8F9`, cards pure white, hairline borders `#E6E9EC`.

### Two documented departures from the guide

**1. A success colour was added — `success #1F6F5C`.**
The brand palette is five warm colours plus greys, with nothing for "this went well". An
operational system cannot function without it: *confirmed*, *paid*, *reconciled* and
*synced* are among the most frequent states in the product, and rendering them in the same
warm orange as *pending* would make the status vocabulary meaningless. The green chosen is
deliberately muted and slightly teal so it sits beside the warm palette instead of fighting
it. **Flagged for brand review.**

**2. Typography is Inter, not Georgia + Arial.**
The guide specifies Georgia for headlines and Arial for body — an MS-Office-era pairing that
reads dated in a dense interface and has no variable-weight axis. The brief asked for the
feel of premium Apple software, so the UI uses **Inter Variable**, self-hosted via
`@fontsource-variable/inter` (no CDN, works offline). Georgia is retained in exactly one
place: printed and print-preview documents — invoices and report covers — via the
`.print-serif` class, which is where the brand serif still earns its keep.
**Also flagged for brand review.**

### Logo gradient

`#FE611F → #F4BF54`, sampled from the logo mark. Reserved for the mark itself, the collapsed
rail, and a single hero accent on the dashboard. **Never on buttons** — it would compete with
the primary action.

---

## Typography scale

| Token | Size | Used for |
|---|---|---|
| `text-2xl` | 24px | KPI figures |
| `text-xl` | 20px | Page titles |
| `text-lg` | 18px | Section headings |
| `text-md` | 15px | Card titles |
| `text-base` | 14px | Body, table cells |
| `text-sm` | 13px | Secondary text, hints |
| `text-xs` | 12px | Captions, footnotes |
| `text-2xs` | 11px | Pills, labels, eyebrows |

**Tabular figures** (`.tabular`) are applied to every number the user might compare: money,
dates, counts, references, percentages. Without it, columns of figures fail to align and the
eye cannot scan them.

---

## Visual language

- **8pt spacing grid.** Radius 10px (`rounded-md`).
- **Hairline `1px` borders instead of shadows.** Shadows belong only to things that float —
  dialogs, popovers, toasts, the command palette. A card that casts a shadow is claiming an
  elevation it does not have.
- **Colour is reserved for status and one accent.** Everything else is ink, grey and white.
  A screen where several things are coloured is a screen where nothing is emphasised.
- **150–200ms `ease-out` transitions.** Nothing bounces or springs.
- **Generous whitespace around the one thing each screen is about.**
- **Dense tables, quiet rows.** No zebra striping; a hairline divider is enough.

---

## Components

All in `src/components/ui`, built on Radix primitives and styled to the tokens above. The
shadcn CLI was deliberately not used — its defaults carry a recognisable generic look, and
the point of a brand system is not to look like everyone else's.

`Button` · `Input` · `Textarea` · `NativeSelect` · `Combobox` · `DateRangePicker` ·
`Checkbox` · `Switch` · `Segmented` · `Field` · `DataTable` · `Pagination` · `FilterBar` ·
`Card` · `StatusPill` · `ProgressBar` · `Stat` · `DetailList` · `Avatar` · `StarRating` ·
`Tabs` · `Dialog` · `DropdownMenu` · `Tooltip` · `Toast` · `EmptyState` · `Skeleton`

### Two accessibility notes worth keeping

- Controls that collapse to icon-only at narrow widths (global search, role switcher) carry
  an explicit `aria-label`. Without it they are unnamed buttons below the `sm` breakpoint.
- `Combobox` exposes `role="listbox"` / `role="option"` / `aria-selected`. Its trigger is a
  Radix Popover, so without those roles a screen reader announces a dialog full of buttons
  rather than a set of choices.

### One defensive guard

`AppShell` clears a stale `pointer-events: none` from `<body>` on route change. Radix applies
that while a modal is open; if a modal unmounts while still open (navigating from the command
palette, for instance) the style can be stranded and the **entire application becomes
unclickable with no visible cause**. The command palette also closes before it navigates, for
the same reason.
