# Checkpoint 1 CLEARED · proceed to Checkpoint 2

Paste everything below the line to the builder agent.

---

**Checkpoint 1 is cleared. Both fixes verified. Proceed to Checkpoint 2.**

## What I verified, and how

**The port survived the fix.** Re-ran the MD5 comparison after your `App.tsx`
change — still 13 of 15 byte-identical, still only `PageHeader.tsx` and
`StatusPill.tsx` differing. **No drift introduced while fixing.** That is the
discipline this checkpoint was testing.

**The page renders.**

```
rootChildren : 2          h1 : "Design system"
sections     : 11         text : 4504 chars
```

Content matches the CRS word for word — every hex, the Success rationale
paragraph, the logo-gradient note, the Georgia note, all eight type steps with
"7 properties" correctly substituted.

**Both providers work.**

```
Toast   region present, fired on click → "Saved / The record has been updated."
Tooltip trigger mounted, data-state="closed"   (it threw before; now it has state)
```

`delayDuration={400}` matches the CRS. Correct.

**Placeholders read honestly** — `Property Two · awaiting confirmation`. Good.
**Superseded by the decision below** — remove them.

## Owner decision — Stage 1 ships ONE property

Demo data is **5 Elements By Fidato Hotels · Akkalkot · 17 rooms**. The other six
properties are integrated at a later stage. Delete `Property Two` and
`Property Three`.

**Read this next part carefully, because it is the part that gets expensive if
you get it wrong.**

This is a decision about **data**, not about **architecture**. One property's
worth of fixtures; multi-property everywhere else.

| Stays multi-property from day one | Ships with one row |
|---|---|
| Property id in the URL | The property list |
| `hotelId` in every TanStack Query key (rule 5) | The switcher's contents |
| Every repository function takes `hotelId` | Room and rate data |
| The property switcher exists and is visible | |

**Never hardcode a property id. Never write `properties[0]`. Never branch on
`properties.length === 1`. Never drop `hotelId` from a signature because there is
only one.**

Adding six properties later must be an edit to a fixture file — not to a
component. The database is already multi-tenant (`hotel_id` on 13 tables, with
RLS). A single-property frontend would be the only thing in the system needing a
rewrite.

### Confirmed data you may use — from the live system

```
Property     5 Elements By Fidato Hotels · Akkalkot · 17 rooms
Room type    Deluxe
Rate plan    "Deluxe CP"   (room type + meal plan, as the live system names it)
Meal plans   EP  room only · CP  breakfast · MAP  breakfast + one meal
Banquet      Pancham Hall
Currency     INR, rounded to the rupee
```

Anything beyond this list must read as an obvious placeholder. Guest names are
fine to invent — the CRS demo names (Ananya Bose, Vikram Desai, Priya Menon) are
already in the page and are fine to keep.

### The property Combobox on `/design-system`

With one property it becomes a one-item picker, which demonstrates nothing. **A
component demo does not have to demo properties.** Point it at meal plans or rate
plans instead — real, confirmed, and genuinely multi-valued:

```
EP    Room only
CP    Breakfast
MAP   Breakfast + one meal
```

Change the label and placeholder to match. That is a better demo of a filterable
combobox than three near-identical hotel names ever was.

## The Checkpoint 0 carry-over is closed — no defect

This is the answer to the question left open two checkpoints ago.

```
--color-grey-200      #e2e5e8        --color-success       #1f6f5c
--color-brand-rose    #db536a        --color-success-100   #cde5de
--color-brand-red     #e0301e        --color-info          #2b6cb0
```

Live, on rendered elements:

```
ring-grey-200     → #e2e5e8          ring-success-100  → #cde5de
bg-brand-red      → rgb(224, 48, 30) bg-brand-orange   → rgb(223, 97, 40)
bg-brand-yellow   → rgb(255, 182, 0) text-ink-900      → rgb(3, 23, 40)
```

**The `@theme` block exposes the full ramp.** `text-success` and `bg-grey-200`
returned defaults at CP0 purely because nothing in source used them.

**Method note, because I got this wrong myself at CP0:** never test a Tailwind
utility by injecting the class at runtime. The v4 JIT generates from a source
scan — an injected class proves nothing either way. Probe a real rendered
element, or read the registered custom property. Enumerating `document.styleSheets`
is also unreliable here; it returned 0 selectors on a fully styled page.

---

# CHECKPOINT 2 — primitives

**Most of this is already done, because you ported it.** All 33 primitives the
brief names are present and exported:

```
Button · Input · Textarea · NativeSelect · Combobox · DatePicker · DateRangePicker
Checkbox · Switch · Segmented · Field · DataTable · Pagination · FilterBar
SearchInput · Card · StatusPill · ProgressBar · Stat · DetailList · Avatar
Tabs · Dialog · Drawer · DropdownMenu · Tooltip · Popover · Toast
EmptyState · NoResultsState · Skeleton · Spinner · ErrorState
```

I also checked two of the three accessibility defects the brief carries forward
from the CRS:

- **Combobox roles** — `role="listbox"`, three `role="option"`, `aria-selected`
  on each. **Already correct in the ported component.**
- **Form labelling** — all 7 controls have an associated `label`. **Correct.**

The third — `AppShell` stranding `pointer-events: none` on `<body>` — belongs to
**Checkpoint 3**, when the shell is ported. Do not chase it now.

## So what is actually left for CP2

Three things, and none of them are code-generation.

**1 · The keyboard pass.** Tab through `/design-system` from the top with the
keyboard only.

- Reach **every** control — 51 focusable elements are on the page
- **A visible focus ring on each.** Not a browser default outline the theme has
  suppressed. If a control is reachable but you cannot see where you are, that
  is a defect
- Open the Dialog with the keyboard, confirm focus is trapped inside it, close
  with `Escape`, and confirm **focus returns to the trigger**
- Open the Combobox with the keyboard, arrow through options, select with Enter
- Tab into the DataTable and confirm rows are reachable

**2 · Icon-only controls need names.** Any control that collapses to icon-only
at narrow widths needs an explicit `aria-label`. Resize to a narrow viewport and
re-check — this is the defect that got through in the CRS, and it only appears
below the `sm` breakpoint.

**3 · Every primitive in every state.** Walk the page and confirm each primitive
shows its full range — not just its default. Buttons show all four variants,
three sizes, icon and loading and disabled. Inputs show hint, error, disabled,
numeric. States show empty, loading **and** error. If a state is missing from
the page, add it to the page — do not add it to the component.

## What must not happen

**Do not modify a ported component to pass this checkpoint.**

If a primitive genuinely fails an accessibility check, that is a **CRS bug too** —
the same file is in production. Report it, name the file and line, and stop.
Fixing it here and not there is the exact drift this port existed to prevent,
and it would be invisible until someone diffed the two trees.

The only edits allowed at CP2 are to `src/pages/DesignSystem.tsx` — the page,
not the library.

## Report

`PHASE-1-FRONTEND.md` §9 format, including `What I saw in the browser`. Add:

```
Keyboard pass    every control reached? focus ring visible on each? dialog trap + restore?
Narrow viewport  which controls collapse to icon-only, and are they named
States covered   any primitive still missing a state on the page
Demo data        placeholders removed? combobox repointed? one property everywhere?
Library touched  MUST be "none" — if not, name the file, the line, and why
```

**Paste raw output, not a summary of it.** And open the page. The last two
reports claimed complete for a build nobody had looked at; `tsc -b` has now
failed to catch a blank screen twice.

## After CP2

Checkpoint 3 is **demo data and the shell** — where `AppShell`, `Sidebar` and
`TopBar` get ported, and the providers move out of `App.tsx` into `AppShell`.
Read `AGENT-PORT-UI.md` Step 5 then, not before.

The property switcher in `TopBar` will show **one** entry. Build it as a
switcher anyway. That is the whole point of the decision above.

Do not start it. Finish CP2 and report.
