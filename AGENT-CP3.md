# CP2 CLEARED · Checkpoint 3 — the shell and demo data

Paste everything below the line to the builder agent.

---

**Checkpoint 2 is cleared.** Proceed to Checkpoint 3. Read the whole of this
first — **CP3 is not a clean port like CP1 was**, and treating it like one will
break Rule 1 on the first import.

## CP2 — verified

```
primitives on page   32 / 32          sections   16  (was 11)
focusable elements   62               library    13/15 byte-identical
at rest              0 dialogs open · body pointer-events "auto" · no stranded inline style
```

**The three states are genuinely distinct** — this is what the requirement was
actually for, and you got it right:

```
Empty       "No reservations yet"  →  "Create your first one"      →  [New reservation]
No results  "No matches"           →  "Try widening them"          →  [Clear filters]
Error       "Failed to load…"                                      →  [Try again]
```

Different words, different exits. Labels read like the product too — *Open
arrival flow*, *Cancel reservation*, *Keep it*, *Select meal plan…*

**`Misc.tsx` still untouched.** Second checkpoint running where the bug is in
front of you and you left it alone. That is the discipline this project runs on.

### What I could NOT verify — carried forward, not waived

My browser pane does not composite, so **geometry, focus and key events are
unmeasurable here**: `window.innerWidth` reads `0`, element widths read `2px`,
`.focus()` reports no ring even on components that demonstrably have one, and
`Escape` never reaches the page.

I am not going to invent findings from broken instruments. **These four need a
human at the keyboard, and they must be answered before CP5**, because every flow
in CP5 opens a Drawer:

1. Visible focus ring on **buttons**, or only on inputs? Brand ring or browser default?
2. Does `Escape` close the Dialog and the Drawer?
3. When a Drawer closes, does focus return to the button that opened it?
4. Is focus trapped inside an open Drawer — does Tab cycle without escaping to the page behind?

**Source fact that makes #1 likely a real defect:** all eight focus utilities in
the library sit on `Input`, `Textarea`, `NativeSelect`, `Combobox`, `DatePicker`.
`Button`, `Checkbox`, `Switch`, `Tabs` and `Pagination` have **no focus styling
at all**, and nothing anywhere uses `focus-visible:`. If buttons show no ring,
that is a **CRS bug** — report it, do not fix it here.

---

# CHECKPOINT 3 — the shell and demo data

## ⚠ This is an adapted port, not a copy

CP1 worked because the library had no coupling. **The shell has plenty.** I
traced every import so you do not walk into it:

| Dependency | What to do |
|---|---|
| `@/lib/session` — **451 lines** | **Do not port.** It carries Firebase auth: `useAuthListener`, `SessionUser`, `AuthIssue`. **Rule 1: Stage 1 has no auth.** Extract **only `useUi`** — the zustand store holding `mobileNavOpen` — into a small `src/lib/ui.ts` |
| `./navigation.ts` | **Do not port.** That is the CRS tree — Reservations, Customers, Commissions, Import, Booking register. Write the PMS tree instead |
| `AiPanel.tsx` | **Skip.** CRS-specific |
| `@/data/repositories` | **Does not exist yet. Create it — that is this checkpoint's real work.** See below |
| `@/lib/permissions` | Port. Rule 6 needs the `{ allowed, reason }` shape |
| `CommandPalette.tsx` | **Port it.** `PHASE-1-FRONTEND.md` is keyboard-first and ⌘K is central |
| `RoleSwitcher.tsx` | Port structurally — it demos the permission model even on demo data |
| `@tanstack/react-query` | Already installed. Rule 5: **`hotelId` in every query key** |

## AppShell — port near-verbatim, it already carries the fix

`AppShell.tsx` is 70 lines and **already contains the `pointer-events` safety
net** I warned you about:

```tsx
useEffect(() => {
  if (document.querySelector("[data-radix-focus-guard]")) return;
  if (document.body.style.pointerEvents === "none") {
    document.body.style.removeProperty("pointer-events");
  }
  document.body.removeAttribute("data-scroll-locked");
}, [pathname]);
```

**Keep this exactly as it is.** Without it, a modal that unmounts while open
strands `pointer-events: none` on `<body>` and the whole application becomes
unclickable with nothing in the console.

Changes needed: `react-router-dom` → `react-router`, drop `AiPanel`, point
`useUi` at your new `src/lib/ui.ts`. **Move `TooltipProvider` and `Toaster` out
of `App.tsx` into `AppShell`** — your own `DECISIONS.md` entry says this, so
close it out when you do.

## The repository seam — Rule 2, and the reason it exists

```
src/data/fixtures/       plain data, no logic
src/data/repositories/   the ONLY thing screens import
```

**Screens import from `@/data/repositories`. Never from `fixtures` directly.**
Every function takes `hotelId` as its first argument, even though there is one
property. The CRS replaced its entire backend by rewriting one folder instead of
34 screens — that is what this buys.

Repositories return promises and are called through TanStack Query, with
`hotelId` in every key. No `fetch`, no client, no SDK — the fixtures are the
source. Rule 1 forbids a network, not a seam.

## Navigation — the PMS tree, and Stay View is home

**`/` redirects to Stay View, not a dashboard.** The front desk lives there all
day; the dashboard is for people who are not working a shift.

Take the navigation from `PHASE-1-FRONTEND.md`. Port the *chrome* from the CRS —
248px `ink-900` rail, `h-14` bars, `size-[18px]` icons, `text-2xs` uppercase
section labels, `max-w-[1600px]` content column, ⌘K affordance. **The chrome is
the brand; the tree is not.**

The **property switcher shows one entry**. Build it as a switcher anyway — the
single-property decision in `MASTER.md` §7 is about data, not architecture.
**Never `properties[0]`, never `length === 1`, never a hardcoded id.**

## Demo data — one property, one month, real numbers

`MASTER.md` §7 has the confirmed dataset. Build **August 2026** for 5 Elements
Akkalkot, calibrated to what actually happened:

```
17 rooms  (18 on 8–13 Aug — inventory varies, never hardcode it)
rooms       201 · 202 · 204 · 206 · 301 · 304 and the rest
types       Superior · Deluxe          rates  CP · Room Only
132 nights sold · 431 available · 30.63% occupancy
ADR ₹3,178.63 · RevPAR ₹973.50 · room revenue ₹4,19,578.77
318 adult / 28 child · 152 confirmed · 13 walk-ins · 10 comps · 0 no-shows
```

**Daily occupancy in the real data swings from 0% to 100%.** Several empty days,
a few full ones, most in between. A flat 30% every day is as wrong as a flat 90%.

Include the awkward cases, because they are the ones that break layouts:

- A **negative folio balance** — a guest who overpaid. Real data has `-784.00`
- A **complimentary room** at ₹0 with `Var % = -100`
- A **day-use** booking and a **back-to-back turnover** on one room
- One **group booking** across several rooms
- **OTA sources** — Agoda, Booking.com, Expedia, go-MMT — alongside Walk-in
- A stay spanning the **month boundary**

## Definition of done

```
✓  /  redirects to Stay View
✓  AppShell ported with the pointer-events effect intact
✓  TooltipProvider + Toaster moved out of App.tsx; DECISIONS.md updated
✓  No screen imports from fixtures — only from repositories
✓  hotelId in every query key and every repository signature
✓  Property switcher present, one entry, no length-based branching
✓  August 2026 demo data with realistic daily variance
✓  Library still 13/15 byte-identical
```

## Report

`PHASE-1-FRONTEND.md` §9 format plus `What I saw in the browser`, and:

```
Ported            which shell files, verbatim or adapted, and every adaptation
Not ported        session.ts / navigation.ts / AiPanel — confirm, and anything else
Seam              repository signatures — paste two, showing hotelId first
Demo data         days at 0% and 100%? negative balance? comp? day-use? group?
Narrow viewport   NOW meaningful — icon-only controls in TopBar, are they named?
Keyboard          the four questions above, answered at the keyboard
Library touched   MUST be "none"
```

**Answer the four keyboard questions this time.** They have been open for two
checkpoints because I cannot measure them, and CP5's five flows all depend on
Drawer focus behaviour being right.

Do not start CP4. Finish CP3 and report.
