---
name: Fidato PMS
description: The hotel system a front desk, a kitchen and an owner work in all day. Quiet navy and greys, one orange action, every figure easy to scan.
colors:
  ink-950: "#010d17"
  ink-900: "#031728"
  ink-800: "#0b2135"
  ink-700: "#142b3a"
  ink-600: "#24384a"
  grey-700: "#354552"
  grey-600: "#4c5b67"
  grey-500: "#67737e"
  grey-400: "#9aa2a9"
  grey-300: "#ccd0d4"
  grey-200: "#e2e5e8"
  grey-100: "#eef0f2"
  grey-50: "#f7f8f9"
  white: "#ffffff"
  brand-orange: "#df6128"
  brand-orange-600: "#c4521d"
  brand-orange-700: "#a34314"
  brand-orange-800: "#8f3b12"
  brand-orange-100: "#f9dccd"
  brand-orange-50: "#fdf1eb"
  brand-yellow: "#ffb600"
  brand-yellow-100: "#ffedbf"
  brand-yellow-50: "#fff8e6"
  warning-ink: "#8a6300"
  brand-tangerine: "#eb8c00"
  brand-tangerine-700: "#a96500"
  brand-tangerine-50: "#fdf4e6"
  brand-rose: "#db536a"
  brand-rose-700: "#b84659"
  brand-rose-100: "#f8d4da"
  brand-rose-50: "#fdeef0"
  brand-red: "#e0301e"
  brand-red-700: "#c52a1a"
  brand-red-100: "#f9d0cc"
  brand-red-50: "#fdeceb"
  success: "#1f6f5c"
  success-600: "#1a5f4f"
  success-100: "#cde5de"
  success-50: "#eaf4f1"
  info: "#2b6cb0"
  info-100: "#d2e2f2"
  info-50: "#ebf2f9"
  info-ahead: "#95b6d8"
  accent-from: "#fe611f"
  accent-to: "#f4bf54"
typography:
  headline:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.021em"
  title:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.6875rem"
    letterSpacing: "-0.014em"
  title-sm:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "-0.014em"
  figure:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    fontFeature: "\"tnum\""
  body:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.4375rem"
    fontFeature: "\"cv02\", \"cv03\", \"cv04\", \"cv11\""
  body-sm:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.3125rem"
  label:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.3125rem"
  button:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: "1.4375rem"
  caption:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1.0625rem"
  table-header:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1.0625rem"
    letterSpacing: "0.025em"
  print:
    fontFamily: "Georgia, ITC Charter, Times New Roman, serif"
    fontSize: "10.5pt"
rounded:
  xs: "4px"
  sm: "6px"
  DEFAULT: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "28px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-orange-600}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.brand-orange-700}"
  button-primary-active:
    backgroundColor: "{colors.brand-orange-800}"
  button-primary-disabled:
    backgroundColor: "{colors.grey-300}"
    textColor: "{colors.grey-600}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.grey-50}"
  button-ghost:
    textColor: "{colors.grey-600}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.grey-100}"
    textColor: "{colors.ink-900}"
  button-danger:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-lg:
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  input-disabled:
    backgroundColor: "{colors.grey-50}"
    textColor: "{colors.grey-400}"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "20px"
  kpi-tile:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink-900}"
    typography: "{typography.figure}"
    rounded: "{rounded.md}"
    padding: "16px"
  pill-neutral:
    backgroundColor: "{colors.grey-100}"
    textColor: "{colors.grey-600}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  pill-info:
    backgroundColor: "{colors.info-50}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
  pill-success:
    backgroundColor: "{colors.success-50}"
    textColor: "{colors.success-600}"
    rounded: "{rounded.full}"
  pill-warning:
    backgroundColor: "{colors.brand-yellow-50}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.full}"
  pill-danger:
    backgroundColor: "{colors.brand-red-50}"
    textColor: "{colors.brand-red-700}"
    rounded: "{rounded.full}"
  pill-accent:
    backgroundColor: "{colors.brand-orange-50}"
    textColor: "{colors.brand-orange-700}"
    rounded: "{rounded.full}"
  table-header:
    backgroundColor: "{colors.grey-50}"
    textColor: "{colors.grey-500}"
    typography: "{typography.table-header}"
    padding: "0 16px"
    height: "40px"
  sidebar:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.white}"
    width: "248px"
  sidebar-collapsed:
    width: "68px"
  top-bar:
    backgroundColor: "{colors.white}"
    height: "56px"
  dialog:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.lg}"
  tooltip:
    backgroundColor: "{colors.ink-900}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: Fidato PMS

The tokens above are copied from `src/styles/theme.css`, which is the source
of truth: if the two ever disagree, the CSS wins and this file is out of date.
`DESIGN.html`, beside this file, draws every colour, type size and component
described here; open it in a browser to see them.

## Overview

**Creative North Star: "The Calm Front Desk"**

A hotel's busiest screen should be its calmest one. Fidato PMS is used all
day by a receptionist with a queue in front of them, a housekeeper with a
phone in one hand, a waiter at a fixed till, and an owner reading the figures
from another city. So the interface is quiet: a dark navy menu, white working
surfaces on a pale grey page, hairline borders instead of shadows, and one
warm orange reserved for the single thing to do next. When everything is
calm, the one orange button and the one warning count are impossible to miss.

It is a dense operational tool, not a marketing page. Tables of forty
postings and a tape chart of fourteen day columns are read by scanning, so
type stays compact (body 15px), numbers line up in tabular figures, and
colour carries meaning (paid, due, dirty, cancelled) rather than decoration.
The brand comes from the Fidato Hotels visual identity guide (page 13): the
navy "Fidato Black", a grey ramp, and five warm colours. The system adds only
what an operations tool cannot do without: darker readable steps of the warm
colours, a success green and an info blue.

Honesty is part of the look. A figure the system does not hold is a dash,
never a zero; a disabled control says why in words; a failed read says it
failed instead of showing an empty screen.

**Key Characteristics:**
- Navy menu, white surfaces, grey-50 page, 1px grey-200 hairlines.
- One orange primary action per view; everything else is quiet.
- Warm colours are signals, shown only when there is something to act on.
- Every colour pair used for text measured to WCAG AA (4.5:1) or better.
- Compact, scannable type in one family (Inter), tabular numbers.
- Controls grow to 44px under a finger, not by window width.
- Motion is short (110 to 200ms) and only for things that open and close.

## Colors

A cool navy-and-grey base with one warm brand orange, plus four more warm
brand colours kept for status, and a muted green and blue the brand guide
lacked.

### Primary
- **Fidato Orange** (`brand-orange`): the brand colour. Used as a fill for
  the focus ring, the active tab underline, selection highlight (its `-100`
  step) and large marks. **Not for small text or button fills**: white on it
  measures 3.57:1.
- **Action Orange** (`brand-orange-600`): the primary button fill (white on it
  4.59:1). Hover `brand-orange-700`, pressed `brand-orange-800`.
- **Readable Orange** (`brand-orange-700`): orange text: warning figures on
  the Dashboard, the accent pill, link-style actions in empty and error
  states. `brand-orange-50` and `-100` are its soft tints.

### Secondary (the other brand warms, as status)
- **Signal Yellow** (`brand-yellow`) with **Warning Ink** (`warning-ink`) on
  **Yellow Wash** (`brand-yellow-50`): the warning pill.
- **Tangerine** (`brand-tangerine`, readable step `brand-tangerine-700`):
  due-out states.
- **Rose** (`brand-rose`, readable step `brand-rose-700`): no-shows.
- **Alarm Red** (`brand-red`): the danger button, errors, the required
  asterisk. Small red text on a red wash uses `brand-red-700`.

### Tertiary (system additions, flagged for brand review)
- **Settled Teal** (`success`, text `success-600`, wash `success-50`):
  confirmed, paid, synced. Muted so it sits beside the warm palette.
- **Ink Blue** (`info`, wash `info-50`): neutral information.
- **Blue Ahead** (`info-ahead`, `#95b6d8`): Ink Blue at half strength, for a
  mark only (never text): a night booked but not yet slept, in the Dashboard's
  occupancy chart (the owner, D27-365 (2)). Not the pale `info-100`, which is
  1.32:1 on white as a thin bar; this is 2.11:1.

### Neutral
- **Fidato Black** (`ink-900`): all primary text, the sidebar, tooltips.
  `ink-950` to `ink-600` are its deeper and lighter steps.
- **Slate** (`grey-700`): form labels. **Muted Slate** (`grey-600`): secondary
  text, and any text on a tinted surface. **Quiet Slate** (`grey-500`): hints,
  descriptions, table headers, a dash standing in for a missing figure.
- **Mist** (`grey-400`): icons, placeholders, disabled text only.
- **Hairline** (`grey-300`, `grey-200`): input borders and surface borders.
- **Cloud** (`grey-100`): icon chips, hover fills. **Page** (`grey-50`): the
  app background, table headers, dialog footers. **White**: every working
  surface.
- **Logo gradient** (`accent-from` to `accent-to`): the mark only.

### Named Rules
**The Readable Step Rule.** A brand colour never carries small text. Text and
white-on-colour fills use the darker step made for it (`-600`/`-700`), each
measured, not judged by eye.

**The Mist Is Not Text Rule.** `grey-400` fails AA on every surface (2.59:1 on
white). It is for icons, dividers, placeholders and disabled controls. Text
starts at `grey-500` (4.85:1 on white); on a tinted surface, `grey-600`.

**The Signal Rule.** A warm colour appears only when there is something to do.
A count of rooms to clean is orange when it is above zero and plain ink at
zero; an orange zero every morning is a false alarm.

## Typography

**Body Font:** Inter Variable (self-hosted via `@fontsource-variable/inter`),
falling back to Inter, -apple-system, Segoe UI, Roboto, sans-serif.
**Print Font:** Georgia (with ITC Charter, Times New Roman) for printed
invoices and report covers. *Superseded 27 September (D27-52): printed documents take the CRS
voucher's look and its sans; see Printed documents below.*
**Mono:** ui-monospace, SF Mono, Cascadia Mono, Menlo.

**Character:** one neutral, highly legible family carries every role, with
Inter's alternate glyphs switched on (`cv02 cv03 cv04 cv11`: open digits and
a clearer lowercase) so 1, l and I never blur in a room number or a total.

### Hierarchy
- **Headline** (600, 1.5rem, tracking -0.021em): the page title, one per
  screen, in the page header.
- **Title** (600, 1.125rem, tracking -0.014em): a section heading inside a
  page.
- **Title small** (600, 1rem): card, dialog and drawer titles; empty-state
  titles.
- **Figure** (600, 1.875rem, tabular): the headline number on a Dashboard
  tile; other tiles use 1.5rem.
- **Body** (400, 0.9375rem / 15px): all running text, table cells, buttons.
  Descriptions under headings cap at about 42rem wide.
- **Body small** (400, 0.875rem): section descriptions, form labels (500),
  tile labels, breakdown rows.
- **Caption** (500, 0.75rem / 12px, the floor): pills, timestamps, room
  codes. Nothing renders below 12px.
- **Table header** (600, 0.75rem, uppercase, tracking 0.025em, `grey-500`).

### Named Rules
**The Twelve Pixel Floor Rule.** No text below 0.75rem. The scale was moved
up one notch on purpose after counting hundreds of 11px nodes on the busiest
screens.

**The Tabular Rule.** Money, dates and counts always use tabular figures
(`.tabular`, or `data-numeric` on a table cell) and right-align in columns,
so they never jitter between rows.

## Layout

The app shell is a dark navy sidebar (248px, collapsible to 68px) beside a
white top bar (56px) and the page, which sits on `grey-50`. Below 1024px the
sidebar becomes a left-hand drawer opened from a menu button in the top bar.

A page is one `Page` container: 20px side padding and 24px top (28px and 32px
from 640px up), centred, at most 1600px wide. It opens with a page header
(the title, a description under it, the page's actions on the right, wrapping
under the title on a phone), then sections. A section is a title with its
description directly under it (never floated to the far right), 14px of air,
its content, and 32px before the next section.

Grids use CSS grid with a 12px gap. Four tiles run one per row on a phone,
two by two from 640px and four across from 1280px; six short counts run two,
three, then six across. Never leave one tile alone on a row.

Tables become a list of cards below 640px, each card a label/value list, with
a "Sort by" select replacing the column headers.

Breakpoints are Tailwind's: 640, 768, 1024, 1280px. Touch size is decided by
the pointer, not the width (see Components).

## Elevation & Depth

Flat by default. Surfaces are white on a `grey-50` page and are separated by
a 1px `grey-200` hairline, never by a shadow. Depth appears only for things
that float above the page.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 12px 32px -8px rgb(3 23 40 / 0.18), 0 2px 8px -2px rgb(3 23 40 / 0.08)`):
  dialogs, drawers, toasts.
- **Popover** (`box-shadow: 0 8px 24px -6px rgb(3 23 40 / 0.14), 0 1px 4px rgb(3 23 40 / 0.06)`):
  menus, popovers, the command palette.
- **Raise** (`box-shadow: 0 1px 2px rgb(3 23 40 / 0.06)`): the rare small lift.

All shadows are tinted with Fidato Black, never pure black.

### Named Rules
**The Hairline Rule.** A card, a table, an input and a tile are drawn with a
1px border. If you are reaching for a shadow on something that does not
float, use a border.

## Shapes

Gently rounded throughout, with a 10px house radius. Cards, inputs, tables,
tiles and normal buttons are 10px (`md`); small buttons and tooltips 6px
(`sm`); dialogs and drawers 12px (`lg`); pills and scrollbar thumbs fully
round. The focus ring is a 2px `brand-orange` outline, 2px out, following the
element's own corner.

Icons come from one family (lucide), one stroke, 16px inside controls and
20px for a standalone mark. On a tile the icon sits in a 32px `grey-100`
square chip with 10px corners.

## Components

### Buttons
Quiet by default, one loud action per view.
- **Shape:** 10px corners (`md`, 36px tall), 6px for small (32px), 44px for
  large. Label in Body weight 500, icon 16px with an 8px gap.
- **Primary:** Action Orange fill, white label. One per view and one per
  dialog.
- **Secondary** (the default): white, Fidato Black label, 1px `grey-300`
  border; hover `grey-50` with a `grey-400` border.
- **Ghost:** no fill, `grey-600` label; hover `grey-100`.
- **Danger:** Alarm Red fill, white label, for destructive acts only.
- **Link:** text only, underlined on hover.
- **Disabled:** stays readable (primary becomes `grey-300` with `grey-600`
  text) and the reason is given in words nearby.
- **Loading:** a spinning 16px loader replaces the leading icon; the button
  is disabled while it runs.
- **Touch:** under a coarse pointer every button grows to at least 44px.

### Status pills
- **Style:** fully round, 2px by 8px, caption type, a soft tint with a
  readable ink and a 1px inset ring of the tint's `-100` step, plus a 6px dot
  in the full colour. Never a solid block.
- **Tones:** neutral, info, success, warning, danger, accent. Booking and
  invoice states map to tones in one place (`RESERVATION_TONES`,
  `INVOICE_TONES`).

### Cards and tiles
- **Card:** white, 1px `grey-200` border, 10px corners, 20px padding, no
  shadow.
- **Dashboard tile** (signature): 16px padding; the icon chip and label on
  top; the figure large; a figure's breakdown (month so far, year so far, or
  each way of paying) as label-left, value-right rows under one `grey-100`
  hairline. A tile that opens a list carries a chevron beside its number and
  a `grey-400` border on hover. A missing figure is a `grey-500` dash at full
  size.

### Charts (the owner, D27-217 to D27-219 and D27-365, 26 October)
The Dashboard's chart row and the small lines and split bars in its tiles.
Recharts draws a bar chart (already installed; nothing else is added); a small
line or a split bar is plain SVG and CSS.
- **No animation.** A chart appears at its values (`isAnimationActive={false}`,
  as the Monthly occupancy report does). No count-ups.
- **Text only on the type ladder:** 12px for axes and captions, 14px and 16px
  for a read-out.
- **Colour is meaning.** Blue is rooms in house, as on Rooms and the Calendar;
  its half-strength step (`info-ahead`) is a night booked but not yet slept.
  Orange stays "something to do". A split bar is ink and greys (`ink-900`,
  `grey-600`, `grey-400`, then `grey-300`), so no colour gets a second meaning.
- **A gap is not a zero.** A figure the system does not hold, or that does not
  exist for that day (an average rate on a night with no room sold), is a gap
  in the line, never a zero.
- **One value is written on the chart:** today's. Every other value is read by
  hover, tap or the arrow keys, and is in the report.
- **A key** under the chart when it has two or more kinds of bar; none for one.
- **A chart card** has a 16px heading and its note behind the (i).
- **On a phone** a chart fits its card with fewer day numbers, or scrolls
  inside its card. The page never scrolls sideways and nothing is squeezed.

### Inputs and fields
- **Style:** white, 1px `grey-300` border, 10px corners, 36px tall, 12px side
  padding, Body text, `grey-400` placeholder. Hover darkens the border to
  `grey-400`.
- **Focus:** border turns `brand-orange` with a 2px `brand-orange` ring at 20%.
- **Label:** above the field, Body small weight 500 in `grey-700`; a required
  field adds a red asterisk. Hint below in caption `grey-500`; an error below
  in caption `brand-red`, and the border turns red.
- **Disabled:** `grey-50` fill, `grey-400` text.
- **Touch:** 44px tall and 16px text under a coarse pointer, so a phone does
  not zoom in.

### Tables
- **Frame:** white, 1px `grey-200` border, 10px corners.
- **Header:** 40px, `grey-50`, uppercase table-header type in `grey-500`, a
  `grey-200` rule below; sortable headers show a chevron.
- **Cells:** Body text, numbers right-aligned and tabular.
- **Phone:** each row becomes a card (see Layout).

### Navigation
- **Sidebar:** Fidato Black, white logo. Items in white at 65% on a
  transparent row; hover 100% white on a 6% white wash; the current screen
  white on a 10% white wash. Section labels uppercase caption at 35% white,
  collapsible. "Find a screen" and "Collapse" sit at the foot.
- **Top bar:** white, 56px, `grey-200` rule below: the menu button (under
  1024px), "Find a screen" with its Ctrl K hint, notifications and the
  account menu.
- **Tabs:** Body weight 500 in `grey-500`, active in Fidato Black with a 2px
  `brand-orange` underline.

### Dialogs, drawers and overlays
- **Dialog:** white, 12px corners, 1px `grey-200` border, Overlay shadow;
  widths 420, 560, 760 or 980px. Header 20px padding with a title-small and a
  `grey-500` description over a `grey-200` rule; footer on `grey-50` with the
  actions right-aligned, Cancel then the one primary.
- **Drawer:** slides in from the right (200ms), same header and footer.
- **Tooltip:** Fidato Black, white 0.8125rem text, 6px corners, at most
  260px wide.
- **Toast:** white, 10px corners, Overlay shadow, from the bottom right.

### Empty and error states
- **Empty:** centred; a 44px round `grey-100` chip with a `grey-400` icon; a
  title-small title that names the space; one `grey-500` sentence saying how
  to fill it; one action.
- **Error:** the same shape with a `brand-red-50` chip and a red icon; says
  what failed and offers Try again.

### Glossary term
A trade word (ADR, RevPAR, city ledger) carries a dotted underline at 40%
of its colour; a tap or Enter opens one plain sentence saying what it means.

### Printed invoice
A4 with 16mm by 14mm margins, 10.5pt, Georgia. Rows never split across
pages, table headers repeat, backgrounds print (a cancelled banner must
survive), and the signature block sits at the foot of the last page.

**27 September, the owner (D27-52): every document looks like the CRS voucher.**
"This is the main reference design; all my branding needs to come from this."
The reference is `D:\fidato crs\src\features\reservations\voucher.ts`,
`renderVoucherHtml` (read it; never edit the CRS). Every bill and document takes
its layout: the logo masthead, the orange-barred title and number, the fact
strip, two columns, a table with a 2px ink rule, the totals, orange-edged panels
and the footer, in the voucher's sans instead of Georgia. A document keeps its
content, words and figures; only the look changes. The page-break rules above
(rows never split, headers repeat, backgrounds print, the signature at the foot)
still hold. The logo comes from one group setting (D27-53); the code holds no
logo, and with none set the hotel's name prints in its place.

### Named Rules (the owner, 27 September, D27-54)
**The Tappable Rule.** Keep every screen simple. Anything you can tap must look
tappable: buttons look like buttons, links are orange, and a tile or row that
opens something shows an arrow. Anything you cannot tap must never look like a
button: status pills and counts stay flat.

## Do's and Don'ts

### Do:
- **Do** use `brand-orange-600` for the primary button and `brand-orange-700`
  for orange text; keep `brand-orange` itself for rings, underlines and marks.
- **Do** give every view one primary action; a button next to Cancel must
  declare its variant (a test in `src/components/ui/primaryAction.test.ts`
  refuses a silent one).
- **Do** show a missing figure as a dash, "-", in `grey-500`, never as 0, and
  never invent a price.
- **Do** use tabular figures for every number and right-align them in
  columns.
- **Do** separate surfaces with a 1px `grey-200` hairline; keep shadows for
  dialogs, drawers, menus and toasts.
- **Do** put a section's description directly under its heading.
- **Do** say what failed and how to recover, and say why a control is off.
- **Do** keep motion to 110 to 200ms with `cubic-bezier(0.16, 1, 0.3, 1)`, for
  opening and closing only; everything stops under reduced motion.
- **Do** write in plain words the desk uses: sentence case, "Month so far",
  "Needs cleaning", "Owed by guests".

### Don't:
- **Don't** set text in `grey-400`, or small text in any full-strength brand
  colour.
- **Don't** put the logo gradient on a button, a heading or a background.
- **Don't** colour a count orange when it is zero.
- **Don't** add a shadow to a card, a tile or a table.
- **Don't** use a second icon family, or emoji as icons.
- **Don't** go below 12px text, or make a touch target smaller than 44px on a
  phone.
- **Don't** show a failed read as an empty list or a row of dashes.
- **Don't** write a colour as a hex in a class (`text-[#8a6300]`); use its
  token. The three older one-offs moved onto tokens on 23 September (D22-12):
  the link button is `brand-orange-700`, the danger button presses to
  `brand-red-700`/`brand-red-800`, and the warning pill's ink is
  `brand-yellow-800`. Some screens still write that ink as a hex.
