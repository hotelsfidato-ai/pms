# Fidato PMS — master plan

**Read this file completely before writing anything. Every session, every agent.**

This is the contract between the auditor and the builder. Where this file and
the code disagree, **the code is what shipped** — fix this file in the same
commit.

| | |
|---|---|
| Project | Property Management System · **7 owned Fidato properties** · room count confirmed for one (5 Elements Akkalkot, **17**); the group total is **unverified** — see §7 |
| Build directory | `D:\fidato pms` |
| Database (already built) | `D:\PMS FIDATO\db` — 17 migrations, 51 assertions, verified |
| Design system source | `D:\fidato crs\src\styles\theme.css` + `docs\design-system.md` |
| Current stage | **Stage 1 — Frontend, no data** |

---

## 1 · Who does what

There are two roles in this project and they do not overlap.

| | **The auditor** | **The builder** |
|---|---|---|
| Who | The planning session | A Claude Code agent in `D:\fidato pms` |
| Does | Writes the plan, sets constraints, **reviews every deliverable**, decides when a stage is complete | Writes the code, runs the checks, reports what actually happened |
| Never | Writes production code | Marks its own stage complete, changes the plan, or skips the exit gate |

**The builder reports; the auditor decides.** A stage is done when the auditor
says it is, not when the builder believes it is.

### What the builder must hand back at the end of a stage

1. The exit-gate command **and its real output, pasted**
2. A list of every file created or changed
3. Anything it could not do, and why
4. Anything it did that the plan did not ask for, and why

A stage report missing any of those four is returned unreviewed.

---

## 2 · The rules — non-negotiable

Breaking one of these is a defect even if the code works.

| # | Rule | Why |
|---|---|---|
| 1 | **Stage 1 has NO data layer.** No fetch, no database, no API client, no Firebase | Locking the UI before wiring it is what makes Stage 3 plumbing instead of redesign |
| 2 | **Screens import only from `@/data/repositories`** | The seam. The CRS swapped its entire backend by replacing one folder instead of rewriting 34 screens |
| 3 | **Business rules live only in `src/lib/rules.ts`** | A rule duplicated in a component drifts, and the copy nobody remembers is the one that runs |
| 4 | **Design tokens only.** Never a raw hex, never an arbitrary pixel value | §4 is the whole palette. A one-off colour is a bug |
| 5 | **`hotelId` in every TanStack Query key** | Miss it and switching property serves the previous hotel's cache — arrivals for the wrong city |
| 6 | **Show blocked actions disabled with a reason. Never hide them** | Use the `{ allowed, reason }` shape. A missing button teaches nobody |
| 7 | **Forbidden, not 404**, for a route a role cannot reach | A 404 says "wrong address". Forbidden says "wrong person" |
| 8 | **Never claim unrun code works** | "Written but unrun" is an acceptable status. "Done" applied to unexecuted code is not |
| 9 | **One stage at a time. Do not build ahead** | Work delivered in one large dump cannot be reviewed, and unreviewed code is where defects live |
| 10 | **Never round-trip a file through PowerShell 5.1** | `Get-Content` without `-Encoding` decodes as ANSI and mangles UTF-8. It corrupted nine files in the CRS and survived a typecheck, a build and 103 tests |
| 11 | **Port UI primitives from the CRS. Never hand-write one that already exists there** | `D:\fidato crs\src\components\ui` runs in production on the byte-identical `theme.css`. A re-implementation is a drift site, and the drift is found by a stakeholder, not by a test |

---

## 3 · Tech stack — decided, do not substitute

```
React 19 · Vite · TypeScript strict · Tailwind CSS v4 · React Router v7
TanStack Query v5 · Zustand · Radix UI · react-hook-form + Zod · Recharts
Inter Variable (self-hosted via @fontsource-variable/inter — no CDN)
```

Carried from the CRS, which runs this stack in production. **Do not add a
dependency without recording the reason in `docs/DECISIONS.md`.**

Specifically **not** used, and deliberately:

- **No shadcn CLI.** Its defaults carry a recognisable generic look, and the
  point of a brand system is not to look like everyone else's.
- **No component library beyond Radix primitives.** The CRS has 15 primitives
  built on Radix and styled to the tokens; copy that approach.
- **No CSS-in-JS.** Tailwind v4 with `@theme` tokens.

---

## 4 · Design system — the Fidato identity

**Everything is already in `brand/`. Read `brand/README.md` first.**

```
brand/tokens/theme.css      ← copy verbatim into src/styles/
brand/tokens/design-system.md  the written rules
brand/logo/                 logo-full.svg · logo-mark.svg · TS + PNG forms
brand/reference/            the original Visual Identity Guidance (PDF)
brand/source/               the supplied artwork, unaltered
```

These are the same files the CRS ships in production, not re-creations. The
values below are reproduced for reading; **`brand/tokens/theme.css` is what the
code must use.**

### Brand ink

```
--color-ink-950  #010d17
--color-ink-900  #031728   ← Fidato Black. Sidebar, headings, primary text
--color-ink-800  #0b2135
--color-ink-700  #142b3a
--color-ink-600  #24384a
```

### Grey ramp

```
--color-grey-700 #354552   body text
--color-grey-600 #4c5b67
--color-grey-500 #67737e   secondary text
--color-grey-400 #9aa2a9   tertiary, icons
--color-grey-300 #ccd0d4   borders, disabled
--color-grey-200 #e2e5e8   hairlines
--color-grey-100 #eef0f2
--color-grey-50  #f7f8f9   page background
```

### Five warm brand colours

```
--color-brand-yellow    #ffb600   pending, warning
--color-brand-tangerine #eb8c00   secondary accent, 2nd chart series
--color-brand-orange    #df6128   PRIMARY action, active navigation
--color-brand-rose      #db536a   attention, no-show
--color-brand-red       #e0301e   destructive, error, overdue
```

Tints exist for soft badges and surfaces — `brand-orange-50/100/600/700`,
`brand-yellow-50/100`, `brand-rose-50/100`, `brand-red-50/100`,
`brand-tangerine-50`.

### Two documented departures — keep both

```
--color-success  #1f6f5c   confirmed · paid · reconciled · synced
--color-info     #2b6cb0   neutral, drawn from the ink family
```

The brand guide has five warm colours and **nothing for "this went well"**. An
operational system cannot function without it — *confirmed*, *paid* and
*reconciled* are among the most frequent states in the product, and rendering
them in the same orange as *pending* makes the status vocabulary meaningless.
The green is deliberately muted and slightly teal so it sits beside the warm
palette instead of fighting it. **Flagged for brand review; do not "fix" it.**

The second departure is typography — see below.

### Logo gradient

```
--color-accent-from #fe611f
--color-accent-to   #f4bf54
```

Mark, collapsed rail and **one** hero accent on the dashboard. **Never on
buttons** — it would compete with the primary action.

### Typography

```
--font-sans   "Inter Variable", Inter, -apple-system, "Segoe UI", sans-serif
--font-serif  Georgia, "ITC Charter", "Times New Roman", serif
--font-mono   ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace
```

The guide specifies Georgia + Arial — an MS-Office-era pairing that reads dated
in a dense interface and has no variable-weight axis. **Inter Variable** is used
in the interface instead, self-hosted so it works offline. **Georgia is retained
in exactly one place: printed and print-preview documents** — invoices, report
covers, registration cards — via `.print-serif`. That is where the brand serif
still earns its keep.

Scale — use the token, never a raw size:

```
--text-2xs  11px    pills, labels, eyebrows
--text-xs   12px    captions, footnotes
--text-sm   13px    secondary text, hints
--text-base 14px    body, table cells
--text-md   15px    card titles
--text-lg   17px    section headings
--text-xl   20px    page titles
--text-2xl  24px    KPI figures
--text-3xl  30px
--text-4xl  36px
```

Headings carry `letter-spacing: -0.014em` (`h1` uses `-0.021em`) at weight 600.
Body uses `font-feature-settings: "cv02","cv03","cv04","cv11"`.

### Radius and elevation

```
--radius-xs 4px · --radius-sm 6px · --radius 8px
--radius-md 10px  ← the house radius
--radius-lg 12px · --radius-xl 16px
```

**Hairline 1px borders, never shadows, on surfaces.** Shadows belong only to
things that float — dialogs, popovers, toasts, the command palette. A card that
casts a shadow is claiming an elevation it does not have.

```
--shadow-overlay  dialogs
--shadow-popover  popovers, dropdowns
--shadow-raise    the one subtle lift, used sparingly
```

### Motion

`150–200ms`, `--ease-out-quiet: cubic-bezier(0.16, 1, 0.3, 1)`. **Nothing
bounces or springs.**

### Rules that are not tokens

- **Tabular figures on every number a user might compare** — money, dates,
  counts, references, percentages. Use `.tabular` or `data-numeric`. Without it
  columns fail to align and the eye cannot scan them.
- **Colour is reserved for status and one accent.** Everything else is ink, grey
  and white. A screen where several things are coloured is a screen where
  nothing is emphasised.
- **Dense tables, quiet rows.** No zebra striping; a hairline divider is enough.
- **One primary button per view.**
- **Generous whitespace around the one thing each screen is about.**
- **Empty ≠ no-results.** Different words, different exits.

### Brand mark

`logo-full.svg` and `logo-mark.svg` from `D:\fidato crs\src\assets\brand\` are
used **verbatim** — never recoloured, redrawn or stretched. One "O" of clear
space on all sides. The mark alone is the collapsed rail, the favicon and the
assistant avatar.

---

## 5 · The stages

Each stage ends in a working system and a gate that either passes or does not.
**The builder does not begin a stage whose entry gate has not passed.**

| Stage | Scope | Data | Gate |
|---|---|---|---|
| **1** | **Frontend shell and screens** | **None — static fixtures only** | Every screen renders, every role shows the right navigation, design-system page matches the tokens |
| 2 | Repository layer + fixtures behind the seam | Fixtures, still no network | Screens read through `@/data/repositories`; swapping the driver changes one folder |
| 3 | Auth bridge — Firebase token to session | Real | A real sign-in reaches Postgres and returns only that user's properties |
| 4 | Front desk + folio, end to end | Real | A guest booked → checked in → charged → paid → checked out, folio balances |
| 5 | Night audit | Real | Run twice, posts once; a 01:40 charge lands on the previous business date |
| 6 | Housekeeping, mobile-first, offline | Real | Status survives a dropped connection and replays once |
| 7 | POS bridge — post to room | Real | A restaurant bill lands on a folio with its own GST band |
| 8 | Billing, GST, Form C | Real | An invoice with 12% and 5% lines totals correctly |
| 9 | Rates, availability, STAAH | Real | An availability change reaches the OTAs |
| 10 | Group dashboard and reports | Real | Group figures reconcile against each property's day-close |
| 11 | CRS bridge | Real | Owned-property inventory appears in the CRS |
| 12 | Hardening and go-live | Real | WAL restore performed and verified; RTO measured, not estimated |

**Stage 1 is specified in `PHASE-1-FRONTEND.md`.** Nothing beyond it is
authorised yet.

---

## 6 · What already exists — do not rebuild it

The database is **built and verified**, not planned. `D:\PMS FIDATO\db`:

- **17 migrations**, applied clean under `ON_ERROR_STOP` against PostgreSQL 17.6
- **22 tables** — 13 property-scoped, 9 group-level
- **32 RLS policies**, zero tables unprotected
- **51 assertions** in `db/tests/run.sh`, all passing

Verified by execution, not assertion: a clerk resolves to exactly one property,
cross-property writes are refused, self-grant into `staff_hotels` is refused, the
ledger is append-only, retried postings are rejected, closed business dates are
refused, and a deactivated group admin loses everything.

**The builder does not touch the database in Stage 1.** It does not read the
schema, connect to it, or model against it. Stage 1 is the interface.

### The component library also already exists

`D:\fidato crs\src\components\ui` — **thirteen modules, ~100 exports**, running
in production at `app.fidatohotels.com`. It is a pure presentation library: no
Supabase, no Firebase, no feature imports, no data layer. Its only local
dependencies are `@/lib/cn` and `@/lib/format`.

It is built on a `theme.css` that is **byte-identical** to this project's
(`3dd69f8b13bdf9f85803e53814857428` in all three locations), so every class it
uses already resolves here.

| Module | What it carries |
|---|---|
| `Button` | 4 variants, 3 sizes, icon and loading states |
| `Input` | `Field`, `Input`, `Textarea`, `NativeSelect` |
| `Card` | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `DetailList`, `DetailRow` |
| `StatusPill` | `Tone` vocabulary + 9 domain tone maps |
| `Overlays` | Dialog, Drawer, DropdownMenu, Popover, Tooltip, Tabs |
| `States` | `EmptyState`, `NoResultsState`, `ErrorState`, 4 skeletons, `Spinner`, `describeError` |
| `DataTable` | Sortable typed table + `Pagination` |
| `Toast` | zustand store + `Toaster` — **not** Radix Toast |
| `Misc` | Avatar, Checkbox, Switch, StarRating, SearchInput, Segmented, ProgressBar, Stat, Separator |
| `Combobox` · `DatePicker` | Filterable select; date and range pickers |
| `PageHeader` · `FilterBar` | `Page`, `Section`, `Breadcrumbs`, filter chrome |

The **living style guide** at `src/features/design-system/DesignSystemPage.tsx`
renders all of it. **That page, as deployed, is the approved specification** —
the owner reviewed it and instructed that the PMS maintain it.

Porting instructions: `AGENT-PORT-UI.md`. See rule 11.

---

## 7 · Open questions — none of these block Stage 1

Recorded so they are not re-derived. Each names the stage it actually blocks.

| # | Question | Blocks |
|---|---|---|
| 1 | ~~Room count at 5 Elements Akkalkot~~ **ANSWERED — 17 rooms**, confirmed by the Manager Report's Room Summary and 431 available room-nights across August 2026. The other six properties remain unknown; the 175-room group total is still **unverified** and is *not* the same number as the 175 nights sold in 2026 | Commercial claims, and the STAAH quote |
| 2 | Is a **banquet hall** typical across properties, and is it sold by night, day or session? | Stage 9 (rates) |
| 3 | What are the **two icons** beside each room number in Stay View? | Stage 4 (front desk) |
| 4 | ~~Which reports are actually used?~~ **ANSWERED — eight**, exported from the live system and specified in `docs/REPORTS-SPEC.md`: Night Audit · Manager Report · City Ledger Summary · No Show · Monthly Occupancy · Monthly Statistics · Yearly Statistics · Lodging Tax | ~~Stage 10~~ — now specified |
| 5 | ~~Is POS live at any property today?~~ **ANSWERED — YES.** Outlet **Sattva**, categories Food and Beverages, ₹1,44,849.37 revenue PTD August 2026, with `POS to PMS Posting` and a `Room Posting` payment method already routing charges onto guest folios. **Stage 7 is a migration, not a greenfield build** | Stage 7 — scope changed |

> ⚠ **Question 1 is the one that matters commercially.** Until the real room
> count is confirmed, do not repeat the 175-room figure to anyone outside the
> project.

### Owner decision — Stage 1 ships ONE property

Demo data is **5 Elements By Fidato Hotels**, Akkalkot, **17 rooms**. The other
six are integrated at a later stage.

**This is a data decision, not an architecture decision.** The distinction is the
whole point:

| Stays multi-property from day one | Ships with one row |
|---|---|
| Property id in the URL — `/p/:hotelId/...` | The property list |
| `hotelId` in every TanStack Query key (rule 5) | The property switcher's contents |
| Every repository function takes `hotelId` | Room and rate data |
| The property switcher exists and is visible | |

**Never hardcode a property id. Never write `properties[0]`. Never branch on
`properties.length === 1`.** Adding six properties must be a change to a fixture
file, not a change to a component. The database is already multi-tenant —
`hotel_id` on 13 tables with RLS — so a single-property frontend would be the
only thing in the system that had to be rewritten.

### Confirmed demo data — from eight production exports

Everything below is copied from real reports in `D:\reports fidato\`, dated
25–26 August 2026. Full detail in **`docs/REPORTS-SPEC.md`**. Anything not on
this list must read as an obvious placeholder.

```
Property        5 Elements By Fidato Hotels · Akkalkot
Total rooms     17   (18 on some dates — inventory varies, never hardcode it)
Room numbers    201 · 202 · 204 · 206 · 301 · 304
Room types      Superior · Deluxe
Rate types      CP · Room Only        (EP, MAP also in use)
Meal plans      EP room only · CP breakfast · MAP breakfast + one meal
Banquet         Pancham Hall
Tax             CGST 2.5% + SGST 2.5% = 5%
Financial year  1 April → 31 March
Sources         Walk-in · Fidato Hotels
OTA accounts    Agoda · Booking.com · Expedia · go-MMT
Payments        Cash · UPI · Credit Card · Debit Card · GoMMT · Google Pay · Room Posting
POS outlet      Sattva — categories Food, Beverages
Extra charges   Room Posting · Late Check-out Fee · Early Check-in Fee · Extra Person Fee
Invoice series  5EFH153  and  000038   (two series in play)
Currency        INR, Indian digit grouping — ₹9,93,190.00
Dates           DD/MM/YYYY
```

**Calibrate demo volumes to August 2026 actuals:**

```
132 nights sold · 431 available room-nights · 30.63% occupancy
ADR ₹3,178.63 · RevPAR ₹973.50 · room revenue ₹4,19,578.77
318 adult / 28 child · 152 confirmed · 13 walk-ins · 10 comps · 0 no-shows
```

A demo showing 90% occupancy renders fine and misrepresents the business. This
property swings from empty to full — real daily occupancy ranges `0%` to `100%`.

---

## 8 · Where we are

```
Stage 1  ████░░░░░░░░  frontend, no data          ← YOU ARE HERE
  CP0    ████████████  toolchain verified · Tailwind painting · tokens registered
  CP1    ████████████  library ported (13/15 byte-identical) · page renders · CLEARED
  CP2    ████████████  32/32 primitives · 3 distinct states · CLEARED
  CP3    ████████████  shell + seam + demo data · 57 tests · CLEARED
  CP4    ████████████  Stay View — tape chart · 17x14 · CLEARED
  CP5    ████████████  five flows — all walked in a browser · CLEARED
  CP6    ░░░░░░░░░░░░  34 screens remain, 8 of them reports — AGENT-CP6-BUILD.md
```

**Four keyboard checks are open and cannot be answered by the auditor.** The
browser pane does not composite: `window.innerWidth` reads `0`, element widths
read `2px`, `.focus()` reports no ring on components that have one, and `Escape`
never reaches the page. These need a human, **before CP5**:

```
1  Visible focus ring on buttons, or only inputs? Brand ring or browser default?
2  Does Escape close the Dialog and the Drawer?
3  On Drawer close, does focus return to the trigger?
4  Is focus trapped inside an open Drawer?
Stage 2  ░░░░░░░░░░░░  repository seam
Stage 3  ░░░░░░░░░░░░  auth bridge
...
Database ████████████  17 migrations · 51 assertions · verified
CRS lib  ████████████  13 modules in production · byte-identical theme.css
```

**Checkpoint 0 cleared** — `.flex` resolves to `flex`, `h1` to 20px Inter
Variable, `--color-ink-900` to `#031728`, and `bg-grey-50` genuinely paints
`rgb(247,248,249)`.

**Checkpoint 1 cleared, and it closed the CP0 carry-over.** The three tokens that
returned defaults at CP0 are all registered and correct:

```
--color-grey-200      #e2e5e8      --color-success       #1f6f5c
--color-brand-rose    #db536a      --color-success-100   #cde5de
```

Live values on rendered elements: `ring-grey-200` resolves `#e2e5e8`,
`ring-success-100` resolves `#cde5de`, `bg-brand-red` `rgb(224,48,30)`,
`bg-brand-orange` `rgb(223,97,40)`. **The `@theme` block exposes the full ramp.**
`text-success` and `bg-grey-200` returned defaults at CP0 only because Tailwind
v4 generates utilities it finds in source and nothing used them — not a defect.

> **Never test a Tailwind utility by injecting the class at runtime.** The JIT
> scans source; an injected class proves nothing. Probe a real rendered element,
> or read the registered custom property.

### Defects found in the CRS by porting it — open, not ours to fix alone

Porting the library into a second application surfaced bugs invisible in the CRS
alone. **The same files run in production.** Neither is fixed here unilaterally.

| # | Defect | Evidence | Status |
|---|---|---|---|
| **A1** | `Checkbox` and `Switch` have **no accessible name**. Radix renders `role="checkbox"` on a `<button>`, so the wrapping `<label>` never names it — a screen reader announces "checkbox, not checked" with no context | Browser a11y tree: `checkbox [ref_5]`, `switch [ref_8]`, all unnamed, against `textbox "Required"` and `tab "Month"` which are named | **Confirmed.** Fix likely `aria-label` on `CheckboxPrimitive.Root`. Needs a decision covering both trees |
| **A2** | No component uses `focus-visible:`. All eight focus utilities sit on the five input-type components — **`Button`, `Checkbox`, `Switch`, `Tabs`, `Pagination` carry no focus styling at all** | Source grep. Whether rings actually paint is **unverified** — programmatic `.focus()` mismeasures in this environment | **Open.** Needs a human at the keyboard |

Update this block at the end of every stage. **Rewrite it, do not append** —
documentation describing a state that stopped being true is worse than none,
because it is trusted.
