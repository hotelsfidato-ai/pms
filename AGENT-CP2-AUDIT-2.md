# CP2 audit #2 — fixes verified. One requirement still unmet: nine primitives are not on the page.

Paste everything below the line to the builder agent.

---

**D2, D3 and the discipline all check out. CP2's central requirement does not.**

## Verified fixed

```
table rows        3          pagination  "1–3 of 9"    ← now consistent
statuses shown    confirmed · pending · cancelled
money             ₹64,800 · ₹1,28,400 · ₹41,200        ← Indian grouping
library           13/15 byte-identical                 ← untouched
```

**You did not fix `Misc.tsx`.** It is still byte-identical to the CRS. That was
the right call and it is the hardest instruction to follow — the bug is sitting
right there and you left it alone because it is not yours to fix. Good.

## Narrow viewport — passes, and the check was premature

At 375×812:

```
horizontal page overflow   none (375 = 375)
unnamed controls           4 — the same checkboxes and switch from A1
new icon-only controls     none
```

No *additional* unnamed controls appear at narrow width. The only overflow is the
typography specimen, which uses `truncate` deliberately.

**But this check cannot really be done yet.** Controls that collapse to icon-only
live in `TopBar` and `Sidebar` — the search button, the notification bell, the
role switcher. Those are **CP3**. I asked for this at CP2 and I was early.
Re-run it once the shell exists.

---

## The unmet requirement — nine primitives are absent

CP2 says: *"Every primitive appears on `/design-system` in every state."*

Nine do not appear at all:

```
DatePicker        only DateRangePicker is shown
FilterBar
SearchInput
Drawer
DropdownMenu
Popover
NoResultsState
ErrorState
Spinner
```

**This is inherited from the CRS page, not a regression you introduced.** The
origin page never showed them either. But CP2's job is to make the design system
complete for *this* product, and four of these matter a great deal here.

### Why these four matter more than the rest

**`Drawer` — the most important primitive in the PMS, and it is undemonstrated.**
`PHASE-1-FRONTEND.md` builds the entire interaction model on **side panels rather
than page navigation**. Every flow — arrival, charge, settle, check out — opens a
panel over the Stay View. If the Drawer's sizing, motion and focus behaviour are
wrong, every flow in CP5 is wrong, and you will find out five checkpoints late.

**`ErrorState` and `NoResultsState`.** The brief is explicit: *"distinct `empty`
and `no-results` states with different words and different exits."* Right now the
page shows `EmptyState` alone, so the distinction the rule exists to enforce is
invisible. Show all three side by side — empty, no-results, error — and make the
wording and the exit button visibly different in each.

**`DropdownMenu`.** Row actions live here. Every table in the product will use it.

The other five — `DatePicker`, `FilterBar`, `SearchInput`, `Popover`, `Spinner` —
are quicker. Add them anyway; a design system with holes gets worked around.

### The rule still holds

**Add them to `src/pages/DesignSystem.tsx`. Do not touch the components.**
If a primitive cannot be demonstrated without changing it, that is a finding —
report it, do not edit.

---

## A2 · Focus rings — still open, still needs a human

Unchanged from my last audit. Source facts:

```
8 focus utilities, all `focus:`, none `focus-visible:`
all 8 sit on Input · Textarea · NativeSelect · Combobox · DatePicker

Button · Checkbox · Switch · Tabs · Pagination — no focus styling at all
```

I still cannot measure whether rings paint; programmatic `.focus()` mismeasures
in this environment.

**Press Tab from the top of the page and answer three questions:**

1. Visible ring on **buttons**, or only on inputs?
2. Brand ring, or the browser's default blue?
3. Does clicking an input with the mouse paint the same ring as tabbing to it?

Three sentences. It is the last thing standing between CP2 and done.

---

## To clear CP2

1. Add the nine missing primitives to the page — **`Drawer`, `ErrorState`,
   `NoResultsState`, `DropdownMenu` first**, they carry the most risk
2. Show empty · no-results · error together, with different words and exits
3. Answer A2 at the keyboard
4. Re-confirm the library is still 13/15 untouched

```
Primitives added   which nine, and any that could not be shown without editing
Drawer             does it size, animate and trap focus correctly? this decides CP5
States             empty vs no-results vs error — do they read differently?
Keyboard pass      buttons: ring or no ring? brand or default? click vs tab?
CRS bugs           A1 confirmed · A2 your answer · anything new
Library touched    MUST be "none"
```

---

## What is coming at CP3, so you can read ahead

**Demo data and the shell.** Three things land together:

- **Port `AppShell`, `Sidebar`, `TopBar`** from `D:\fidato crs\src\components\app\`
  — `AGENT-PORT-UI.md` Step 5 is un-withdrawn at that point. Move
  `TooltipProvider` and `Toaster` out of `App.tsx` into `AppShell`, per your own
  `DECISIONS.md` entry.
- **Do not port the CRS navigation tree.** The PMS navigation is in
  `PHASE-1-FRONTEND.md`, and **Stay View is home** — not a dashboard.
- **A full month of demo data for one property**, calibrated to the real August
  2026 figures now in `MASTER.md` §7: 17 rooms, 132 nights sold, 30.63%
  occupancy, ADR ₹3,178.63, daily occupancy swinging between **0% and 100%**.

There is one CRS bug waiting for you at CP3, already documented in
`AGENT-BUILD-FULL.md`: **`AppShell` must clear a stale `pointer-events: none`
from `<body>` on route change.** Radix sets it while a modal is open; if the
modal unmounts while still open, the style is stranded and **the entire
application becomes unclickable with no error in the console**. Handle it when
you port `AppShell`.

Do not start CP3. Finish CP2 and report.
