# Full build brief — the complete Fidato PMS interface

Paste everything below the line into the builder agent. This is a long task.
Work through it continuously, stopping only at the checkpoints.

---

You are building the **complete interface** of the Fidato Hotels Property
Management System, in `D:\fidato pms`, on demo data. No database, no API, no
authentication, no network calls of any kind.

Read `MASTER.md`, `PHASE-1-FRONTEND.md`, `brand/README.md` and
`docs/ezee-analysis.html` before starting. Everything below assumes them.

## How this brief works

There are **six checkpoints**. Each has commands with expected output. **You may
not continue past a checkpoint until its checks return the expected values.**

This exists because your last submission passed `tsc -b`, `vite build` and
`vitest` while the application rendered as unstyled HTML in Times New Roman.
Type checks, bundlers and DOM-text assertions cannot see whether a style
applied. The checkpoints can.

**If a checkpoint fails, stop and fix it. Do not build on top of it.**

---

# CHECKPOINT 0 — make the foundation actually work

Your current build is broken. Fix these four things first.

```bash
# from PowerShell, NOT Git Bash — TLS-inspecting proxy on this machine
npm install -D @tailwindcss/vite
npm install react-hook-form zod
npm install recharts@^3
```

```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

Create `docs/DECISIONS.md`. Record the Recharts pin as its first entry —
`recharts@2.x` predates React 19; the CRS runs `^3.10.1` in production.

### ✅ Checkpoint 0 — run in the browser console at `localhost:5174`

```js
getComputedStyle(document.querySelector('.flex')).display                                    // "flex"
getComputedStyle(document.querySelector('h1')).fontSize                                      // "20px"
getComputedStyle(document.querySelector('h1')).fontFamily                                    // contains "Inter"
getComputedStyle(document.documentElement).getPropertyValue('--color-ink-900').trim()        // "#031728"
```

**All four must be correct.** Anything else and Tailwind is still not wired.

---

# CHECKPOINT 1 — `/design-system`

Build this **second, not last**. It renders every token and every primitive from
the real modules, so it cannot drift from the product, and it is how the design
system is checked for the rest of the build.

Show, from the actual imported modules:

- **Every colour** — swatch, token name, hex. All ink, all grey, all five brand
  colours plus tints, success, info, and the logo gradient
- **The full type scale** — `text-2xs` through `text-4xl`, each labelled with its
  pixel size, in Inter
- **Georgia** shown separately, marked *"printed documents only"*
- **Radius** — xs · sm · default · md · lg · xl
- **Elevation** — overlay · popover · raise, and a hairline-bordered surface
  beside them showing the difference
- **Tabular vs non-tabular figures**, columns of numbers side by side so the
  misalignment is visible
- **Every primitive** in every state

### The palette — copy these exactly

```
ink-950  #010d17    ink-900  #031728    ink-800  #0b2135
ink-700  #142b3a    ink-600  #24384a

grey-700 #354552    grey-600 #4c5b67    grey-500 #67737e
grey-400 #9aa2a9    grey-300 #ccd0d4    grey-200 #e2e5e8
grey-100 #eef0f2    grey-50  #f7f8f9

brand-yellow    #ffb600   pending, warning
brand-tangerine #eb8c00   secondary accent, 2nd chart series
brand-orange    #df6128   PRIMARY action, active navigation
brand-rose      #db536a   attention, no-show
brand-red       #e0301e   destructive, error, overdue

success #1f6f5c   confirmed · paid · reconciled
info    #2b6cb0   neutral

accent-from #fe611f → accent-to #f4bf54
  mark, collapsed rail, ONE hero accent. NEVER on buttons.
```

```
text-2xs 11px  text-xs 12px  text-sm 13px  text-base 14px
text-md  15px  text-lg 17px  text-xl 20px  text-2xl 24px
text-3xl 30px  text-4xl 36px

radius: xs 4 · sm 6 · default 8 · md 10 (house) · lg 12 · xl 16
motion: 150–200ms, cubic-bezier(0.16, 1, 0.3, 1). Nothing bounces.
```

### ✅ Checkpoint 1

```js
// tokens registered
['--color-ink-900','--color-brand-orange','--color-success','--color-grey-50']
  .map(t => [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()])
// → [["--color-ink-900","#031728"],["--color-brand-orange","#df6128"],
//    ["--color-success","#1f6f5c"],["--color-grey-50","#f7f8f9"]]
```

Open `/design-system` and compare every value against
`brand/tokens/design-system.md`. **Any mismatch is a failure.**

---

# CHECKPOINT 2 — primitives

Built on Radix, styled to tokens, in `src/components/ui/`.

```
Button · Input · Textarea · NativeSelect · Combobox · DatePicker · DateRangePicker
Checkbox · Switch · Segmented · Field · Label
DataTable · Pagination · FilterBar · SearchInput
Card · StatusPill · ProgressBar · Stat · DetailList · Avatar · Badge
Tabs · Dialog · Sheet · DropdownMenu · Tooltip · Popover · Toast
EmptyState · NoResults · Skeleton · Spinner · ErrorState
```

**`Button`** — variants `primary` (brand-orange, one per view) · `secondary`
(hairline border) · `ghost` · `danger` (brand-red). Sizes `sm` `md`. States
include `disabled` **with a reason surfaced as a tooltip** — never a bare
disabled control.

**`StatusPill`** — outlined, `text-2xs`, uppercase, letter-spaced. One colour per
meaning:

```
Tentative   yellow      Confirmed    info        Checked in  success
Checked out grey-500    Due out      tangerine   No show     rose
Cancelled   grey-400    Void         red         Released    grey-400
```

**`DataTable`** — dense rows, hairline dividers, **no zebra striping**, sticky
header, `data-numeric` on every numeric column, and **distinct `empty` and
`no-results` states with different words and different exits**.

### Three rules that were real defects in the CRS

1. Controls that collapse to icon-only at narrow widths need an explicit
   `aria-label`, or they are unnamed buttons below the `sm` breakpoint.
2. `Combobox` must expose `role="listbox"` / `role="option"` / `aria-selected`.
   Its trigger is a Radix Popover; without those roles a screen reader announces
   a dialog full of buttons.
3. **`AppShell` must clear a stale `pointer-events: none` from `<body>` on route
   change.** Radix sets it while a modal is open. If a modal unmounts while open
   — navigating from the command palette — the style is stranded and **the entire
   application becomes unclickable with no error**.

### ✅ Checkpoint 2

Every primitive appears on `/design-system` in every state. Tab through the page
with the keyboard only and reach every control, with a visible focus ring.

---

# CHECKPOINT 3 — demo data and the shell

## The demo data

Model it on the real property, with **invented guest names**. No real guest data
in the repository, ever — the reference screenshots contain live PII.

**5 Elements By Fidato Hotels, Akkalkot — 17 rooms**

```
Deluxe        206, 306, 405                  EP ₹3,399   CP ₹3,699
Family Suite  403                            EP ₹10,898  CP ₹8,398
Superior      201-205, 301-305, 401          EP ₹4,099   CP ₹4,699
Pancham Hall  banquet — no rooms, no rate    ← render it, do not filter it out
```

Plus **six more properties** with plausible Maharashtra and UP names, cities and
room counts between 12 and 30. Vary them — do not make seven identical hotels.

**Bookings must cover every state the UI renders:**

```
arriving today, unassigned      in house, balance outstanding
in house, settled               departing today
checked out                     no show
cancelled                       void
released                        tentative
group booking across 3 rooms    walk-in taken last night
a guest with a room move mid-stay
a returning guest with 2 past stays at a DIFFERENT property
a blacklisted guest             a foreign national, Form C due
```

**Occupancy must look like a real week — 6% to 35% across the fortnight**, which
is what the live system shows. Not 100%, not empty.

Money in rupees, dates `DD/MM/YYYY`, tabular figures throughout. **No lorem
anywhere.**

## The shell

- **Sidebar**, collapsible to a rail showing only `logo-mark.svg`
- **Property switcher** in the topbar — crest, name, city. Always visible. This
  is the most important control on the screen: the most expensive PMS mistake is
  a clerk posting a charge to the right room at the wrong hotel
- **Breadcrumb** distinguishing group-level from property-level
- **Role switcher** — Stage 1 only, removed when auth lands
- **Command palette** — `Cmd/Ctrl+K`

## Routes

```
/                      group dashboard
/guests                guest database, duplicates visible, merge action
/companies             corporate accounts
/reports               report taxonomy, favouritable
/admin/properties      add a property — one form
/admin/users           staff and property access
/admin/roles           live permission matrix
/admin/audit-log       who changed what
/design-system

/h/:code/stay          the tape chart          ← home for front desk
/h/:code/reservations  list, three tabs
/h/:code/folios        open accounts
/h/:code/invoices      issued, Georgia preview
/h/:code/housekeeping  status board, mobile
/h/:code/rates         grid, editable cells
/h/:code/night-audit   run and log
/h/:code/cashiering    placeholder — unspecified
/h/:code/pos           placeholder — unspecified
```

**Roles:** `owner · gm · front_desk · housekeeping · pos · stores · finance ·
read_only`. Access map in `src/lib/permissions.ts`, rendered live at
`/admin/roles`.

A forbidden route renders **Forbidden, not 404**. A user with one property lands
in it; one with several lands on the group dashboard.

### ✅ Checkpoint 3

- Switching property **stays on the same route and date**, changing only the data
- Switching role changes the visible navigation
- Both survive a page reload (state persisted)
- Every route in the list above resolves — no dead links

---

# CHECKPOINT 4 — Stay View

The centrepiece. A front desk lives in this screen all day.

```
┌─ date picker ─┬─ All 17 · Vacant 16 · Occupied 1 · Reserved 0 ·
│               │  Blocked 0 · Due Out 0 · Dirty 9        ← live counts
├─ rate plan selector ─── grouping selector ─── [Assign Room]
├──────────┬────────────── 14 date columns, weekday over date ─────────
│ ROOM TYPE│  avail count (top)  /  rate (bottom)   ← two figures per cell
│  room no │  [══ booking bar, guest name, source icon ══]
│  ⚑ ⚐     │
├──────────┴──────────────────────────────────────────────────────────
│ Available Inventory  ·  Occupancy(%) with inline bar   ← pinned footer
```

- Room type rows are **collapsible**
- Weekends visually marked (**SAT and SUN** — the live system configures these)
- Two small status icons before each room's timeline
- Bar colours from the token set, one meaning each:

```
in house  success   confirmed  info      tentative  yellow
due out   tangerine no show    rose      void       red
```

**Interactions:**

- **Click a bar** → right-hand detail panel. **The chart stays visible behind
  it.** A clerk who loses the chart has lost their place in the day
- **Click an empty cell** → new booking, pre-filled with that room and date
- **Hover a bar** → tooltip with dates, rate, balance

Drag-to-move is **Stage 4**. Design the bar so it can gain a drag handle later
without redrawing, but do not build it.

### ✅ Checkpoint 4

```js
document.querySelectorAll('[data-room-row]').length          // 17
document.querySelectorAll('[data-date-col]').length          // 14
document.body.scrollWidth <= window.innerWidth               // true — no h-scroll
```

Click a booking → panel opens, chart still visible. Click an empty cell → new
booking pre-filled. Every filter pill changes what is shown.

---

# CHECKPOINT 5 — the five flows

**These are the deliverable.** Screens are how flows are expressed, not the
reverse. Each must run start to finish on demo data.

### A · Arrival → in house

```
arrivals pill → click bar → panel: summary, balance, ID status
  → [Check in]
      ① confirm guest and party
      ② assign room    ← ONLY clean/inspected rooms of that type offered
      ③ capture ID     ← upload, skippable with a reason
      ④ confirm rate and meal plan
      ⑤ done
  → bar turns in-house, room turns occupied, arrivals count drops
    — VISIBLY, behind the closing panel
```

That last line matters. The visible update is what tells a clerk the work landed.

### B · In house → charge

```
click in-house bar → [Folio] → posting list, running balance
  → [Add charge] → category, description, amount, tax band
  → a wrong posting is REVERSED, never edited
     the reversal appears as its own line, in rose
```

The ledger is append-only. **Make that legible rather than hiding it.**

### C · Departure → settle → check out

```
departures pill → click bar → folio, outstanding balance in RED
  → [Settle] → cash · card · UPI · bill to company
  → balance reaches zero
  → ONLY THEN does [Check out] enable
  → invoice preview in GEORGIA → print / email
  → room turns vacant-dirty and appears on housekeeping's board
```

**Check-out stays disabled with a visible reason while a balance is
outstanding.** Blocked actions are shown, never hidden.

### D · Walk-in at 23:40

The hardest and most common flow at these properties.

```
click empty cell (room and date already chosen)
  → guest: search existing OR create in the same field
  → nights, party size, meal plan
  → rate: default shown, override allowed WITH A REASON
  → [Confirm and check in]   ← ONE action, not two
```

A walk-in is not a booking followed by a check-in. It is one act.

### E · Housekeeping on a phone

```
board, mobile-first
  → grouped: Vacant Dirty · Vacant Clean · Occupied · Out of order
  → tap room → mark clean → mark inspected
  → an offline change QUEUES VISIBLY and syncs when signal returns
```

Design for **a phone held in a stairwell, one-handed**. Tap targets, not mouse
targets. The queue must be visible — a housekeeper needs to know their work was
recorded.

### ✅ Checkpoint 5

Walk all five flows in the browser yourself, end to end. For each, record what
you saw. A flow that "should work" has not been tested.

---

# Keyboard

```
/    focus search        n    new booking        i   check in selected
o    check out selected  Esc  close panel        ?   shortcut help
← →  move date window    g    go to date         Cmd/Ctrl+K  command palette
```

**Every shortcut also has a visible control.** The keyboard is an accelerator,
not a requirement — a new joiner on their first shift must find everything by
looking.

---

# Hard rules

| Never | Why |
|---|---|
| `fetch`, an API client, a database connection | Stage 2 and 3 |
| Firebase, any SDK, any auth | Stage 3 |
| Read `D:\PMS FIDATO\db` or model against the schema | Coupling the UI to the schema is what the repository seam prevents |
| A raw hex, or an arbitrary pixel value | Tokens only |
| The shadcn CLI, or its token names, or its default styling | Its defaults carry a recognisable generic look |
| Real guest names or contact details | The reference screenshots contain live PII |
| Design a flow with no reference material | Route and honest placeholder instead |
| Add whitespace to make it feel calmer | Density is the aesthetic. It will make it worse |

**Screens import only from `@/data/repositories`.** Even on fixtures. That seam
is why the CRS swapped its entire backend by replacing one folder instead of
rewriting 34 screens.

**Business rules only in `src/lib/rules.ts`.** A rule duplicated in a component
drifts, and the copy nobody remembers is the one that runs.

---

# Skills

Check what you have before starting: **`ui-ux-pro-max`** (patterns,
accessibility, React/Tailwind), **`ckm-design-system`** (token architecture),
**`frontend-design`** (responsive, for the mobile board). Install what is missing
via `find-skills`.

> ⚠ **`ckm-ui-styling` is built around shadcn/ui, which `MASTER.md` §3 forbids.**
> Take its Radix and accessibility patterns. Reject the CLI, the styling and the
> token names.
>
> The same applies to any skill offering to generate a palette or choose fonts.
> **The visual direction is decided and it is in `brand/`.** A skill offering 96
> palettes is offering 96 wrong answers here.
>
> Use skills for **how to build it well**, never for **what it should look like**.

---

# Report when all six checkpoints pass

```
STAGE 1 REPORT

Skills active
  <found / installed / used where>

Checkpoints — paste the actual console output for each
  CP0 Tailwind wired        : <4 values>
  CP1 tokens registered     : <4 values>
  CP2 primitives + keyboard : <what you observed>
  CP3 shell + demo data     : <what you observed>
  CP4 Stay View             : <3 values>
  CP5 five flows            : <what you saw walking each>

What I saw in the browser
  <per screen — what it actually looked like, not what the code says>

Gate output
  tsc -b        : <paste>
  npm run build : <paste>
  vitest run    : <paste, including FILE count>

Files created/changed
Could not do — and why
Did beyond the plan — and why
Decisions recorded in docs/DECISIONS.md
```

A report is returned unread if it lacks checkpoint output, lacks
**What I saw in the browser**, claims "done" on code that has not run, or
contains work beyond the plan that is not called out.

Begin at Checkpoint 0.
