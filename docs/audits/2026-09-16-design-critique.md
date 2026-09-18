# Design critique — the whole system, 16 September 2026

**Method: two isolated agents.** A design review (≈20 screens at 1280 and 375,
signed in as the owner, unanchored) and a mechanical detector plus live browser
measurement on five pages. Neither saw the other. The four load-bearing claims
were verified by hand afterwards.

**Why it exists:** the owner is about to run one agent per service — POS, front
desk, inventory — and asked for a critique of the whole system first. The
per-service tables below are written so each of those chats can read its own
section and nothing else.

---

## Design health — 20 / 40

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | "In house" reads **5 / 8 / 9 / 5** on Dashboard / Housekeeping / In-house / All bookings, same property, same day |
| 2 | Match with the real world | 3 | Owner-facing copy says *"Read back from the database"*; notification tags print raw keys `payment`, `system`, `approval` |
| 3 | User control and freedom | 2 | On a phone the stay panel is a full-screen sheet whose only exit is a 24×24 × |
| 4 | Consistency and standards | 1 | Five date formats, four money formats; `checked_in` blue and `in-house` green for one real-world state |
| 5 | Error prevention | 3 | The front desk explains every disabled action; Housekeeping disables two icons with no reason |
| 6 | Recognition over recall | 2 | `Rate plan: CP` as bare text while `Term` + `GLOSSARY` sit unused |
| 7 | Flexibility and efficiency | 2 | Phone Arrivals: one guest per ~420px card, no check-in from the card |
| 8 | Aesthetic and minimalist | 2 | `/stay` at 375: two identical tab groups, 8 chips, a 6-item legend — first room tile at y≈600 of 812 |
| 9 | Diagnose and recover | 1 | `/stay` has no error branch — `if (isLoading \|\| !data)` and nothing else |
| 10 | Help and documentation | 3 | `Term`, the readiness checklist and the report footnotes are good, and not wired to the jargon staff meet |

**Band: needs work — a strong voice over numbers that disagree.**

---

## Design specificity — authored, and it stops at the service boundary

This is not category-default B2B software. The dash rule is printed in the UI
and honoured in the printed report. Money groups Indian-style. The year runs
from 1 April. `src/lib/offline.ts` refuses each write with its own reason —
*"An invoice cannot be raised offline. Its number comes from a statutory
series, and two desks offline would issue the same one."* `Term` is tap, not
hover, *"the desk and the POS are touch screens."* The POS terminal remembers
the outlet **on the device, not the person**.

What undercuts it is that the authoring stops at each service's edge. Each is
well designed against its own brief and against nothing else. Verified by hand:
**`FilterBar` has 0 consumers** outside the showcase page, **`moneyCompact` has
0 consumers** — while the tape chart hand-rolls `${(cell.rate/1000).toFixed(1)}k`.
The system reads as six good products sharing a colour ramp.

**This is the mechanism behind most of the inconsistencies below, and one agent
per service will widen it unless the shared kit becomes a contract.**

---

## What the deterministic scan is worth

The CLI detector returned **0 findings across all eight directories** — and
that is not a clean bill. The detector agent planted six anti-patterns in a
`.tsx` fixture; **one fired**. Its static coverage is nearly blind to
Tailwind-class markup.

**It also found that the `.cmd` launcher does not propagate exit codes** — the
same input exits 2 through the raw `.exe` and 0 through the wrapper. Anything
gating on the wrapper's exit code gets a silent pass forever.

In the **live DOM** the same detector found 77 issues across five pages:
`/stay` 43 (39 of them contrast), `/pricing` 20, `/till/terminal` 5,
`/cashiering` 5, `/housekeeping` 4. It also measured **0 unnamed buttons and 0
console errors on every page**, which is rare and worth keeping.

---

## Priority issues

### P0 · One booking, three statuses; one house, four counts
`FH-2608-4858` is `In house` on Arrivals and In-house, `Checked out` on All
bookings. The night auditor has four answers to "who is in the building".
`StayDrawer.tsx:58` documents the split as intentional — the clerk cannot read
the comment.
**Fix:** one derived status in `stayview.ts`, consumed everywhere; a screen
needing a variant renders a second, differently-shaped mark beside the
canonical pill, never instead of it.
**Files:** `src/modules/front-desk/data/stayview.ts`, `flows/StayDrawer.tsx`,
`flows/StayMarks.tsx`, `src/components/ui/StatusPill.tsx`.
**Owner: front-desk.**

### P0 · `/stay` shows a skeleton forever when the API is unreachable
Confirmed in source: twelve grey bars, no `isError`, no retry, under a banner
promising *"Anything you can still do will be held."*
**Fix:** an `isError` branch with `ErrorState onRetry`; keep the last good room
grid behind it; shape the skeleton like the room grid.
**Files:** `src/modules/front-desk/pages/StayView.tsx:262`.
**Owner: front-desk.**

### P0 · `/in-house` prints a paid guest's charges under `BALANCE`
₹7,085 in the list; `Paid ₹7,085 · Balance ₹0` in her drawer. The list reads
`openFolios`, the drawer reads the folio.
**Not yet reproduced from the database** — one query decides which number is
wrong before anything is changed.
**Owner: front-desk, with finance.**

### P1 · Seven screens set or show a price, on two incompatible models
`/room-types`, `/rate-plans`, `/grids`, `/rates`, `/pricing`. A GM asked to
raise Saturday's price has six doors and two mental models (absolute, and
base-plus-difference).
**Fix:** one screen owns setting price; the rest carry a banner naming it, as
`/rates` already does.
**Owner: inventory.**

### P1 · Five services fail five different ways offline
Measured with the network blocked. `/housekeeping` flips its own pill and
serves cached rooms — the best behaviour in the system. `/reservations` prints
**`All 0 · In house 0 · 0 of 0`**, which tells a GM "no bookings on file" —
the product's own dash rule, broken on the failure path, on the screen where
the lie is worst.
**Fix:** one `ListStates` wrapper taking `{isLoading, isError, isEmpty,
isFiltered}` that cannot be used partially.
**Owner: `src/components/ui/` + reservations.**

### P2 · Five date formats, four money formats
`Tuesday, 25 August 2026` · `25 Aug 2026 – 7 Sep` · `2026-08-25 → 2026-09-07` ·
`2026-08-25` · `16/09/2026, 01:08:34 pm`. And `₹4,099` · `₹4,23,678` · `4.1k` ·
`4099` · `3952.80`. ADR is `₹3,953` on the dashboard and `3952.80` on the
report.
**Fix:** route everything through `format.ts`; adopt `moneyCompact` on the tape
chart; add a test that fails on a raw date inside a template literal.
**Owner:** the rule is the core's; the fixes land in inventory, finance, pos,
front-desk, reports.

### P3 · `nested-cards` ×5 and `cramped-padding` ×5 on `/pricing`
Cards inside cards in the differences rail. **Owner: inventory.**

---

## Per-service

| Service | Strong | Weak | Fix first |
|---|---|---|---|
| **front-desk** | The stay panel: full-screen on a phone, pinned Charged/Paid/Balance. `StayActions` explains every disabled item | No error branch on `/stay`; `BALANCE` shows charges; `/arrivals` says "10 expected" over ten arrived rows; `4.1k` rates; two identical tab groups | The `isError` + stale-data branch in `StayView.tsx` |
| **reservations** | `?res=` deep-links the drawer; `/book` is a clear one-guest form | Prints **zeros** for unknown counts offline; two search boxes with identical placeholder | Replace the failure-path zeros with dashes |
| **inventory** | `/pricing` is the best-written screen in the system; `/rates` is honest about being read-only | Six screens, two pricing models, no signposting; raw ISO dates in `Grids.tsx` | Declare one authoritative pricing screen; banner the rest |
| **pos** | Outlet remembered on the device; the day-end copy on what reaches the drawer | Raw ISO dates in two places; the terminal sets no document title; `/till` empty state offers one field and no guidance | `BUSINESS_DATE` and `d.businessDate` through `dateLong` |
| **housekeeping** | The only service that flips its own Online/Offline pill and keeps serving cached rooms | Three unlabelled icons, two silently disabled; a 4-option select inside all 18 cards; no "Needs cleaning" section | A visible label and a reason on the disabled icons |
| **finance** | Folios is the best money screen in the product | `/invoices` prints `—` for a genuine ₹0; tab title "Issued" vs heading "Invoices"; a permanent e-invoicing essay on a daily screen | Print `₹0` where a folio is genuinely settled |
| **reports** | The index says what each report is for; the footnotes state the formulas and the dash rule | `3952.80` beside `₹31,622`; `Total Room 17` vs 18; an unlabelled print timestamp; "Owed by guests" for a net figure | STATISTICS through `money()` / `percent()` |
| **admin** | *"One person can sign in and see nothing"*; the provisioning warning | A row named **`REPLACE — your name`** holding access to every property; four inline actions per row; three words for one state | Quarantine the `REPLACE` administrator |

---

## Persona red flags

**A clerk at 7pm with three people waiting** — Arrivals says *"10 expected ·
Check in from the row"* and all ten rows read `In house` or `Checked out`. On a
checked-out guest the only named button on screen is **"Remove VIP"**. On an
in-house guest, `Settle and check out` is **36px** tall while `More options`
beside it is **44px**.

**A housekeeper on a phone in a corridor** — 63% of the screen goes to title,
description, a full-width card and a sideways-scrolling filter row before the
first room. Three grey icons per card, two disabled with no reason. The filter
chips are staff names including **`Test GM`**, clipped mid-word.

**The owner from another city** — In house 5/9/8. ADR `₹3,953` vs `3952.80`.
`Total Room 17` vs 18. `₹31,412` labelled *"Owed by guests"* on one screen and
*"Owed to the property, less refunds"* on another; it is the second. The report
footer prints today's date on a report headed *As on 25 Aug 2026*.

---

## Minor

Notification says *"7 postings reversed today"* stamped *"22 days ago"* —
`relative()` measures the wall clock, the copy measures the business date ·
`describeError` offers *"Create the missing index in Firebase"* for a Postgres
system · `Input` puts helper text inside `<label>`, so a field's accessible
name is *"UntilNot included. A season through 31 Dec ends on 1 Jan…"* · meal
plans render three different ways · `ROOM_TONES` gives `clean` and `inspected`
the same colour — the distinction that screen exists to make · a normal unpaid
balance renders red, training staff past real errors · the Design System
showcase is a live menu item · 17 "Coming soon" links sit in the primary
navigation.

**Discarded as false positives:** `em-dash-overuse` on `/pricing` (the tool
calls it advisory; the voice is deliberate here) and four "small targets" on
`/cashiering` (a sub-pixel rounding artefact — all four measure 44×44 or more).

---

## Fixed on the day

**Contrast, across the whole system** — see `CHANGELOG.md`, 16 September
(contrast). `grey-400` retired as a text colour, four darker steps of the brand
hues added, the primary button and the room tiles repaired. Re-measured in the
browser: `/stay` 39 → 0, `/pricing` 7 → 0, `/housekeeping` 1 → 0,
`/till/terminal` 2 → 0, `/cashiering` 2 → 0, `/arrivals` 0.

Everything else above is open.

---

## Process note

The detector's findings reached the synthesising session before the design
review finished, because the two agents returned in that order. The review was
unaffected — it never saw the detector — but the synthesis was anchored earlier
than the method intends. Where the two disagreed, the disagreement is named
rather than merged: the review proposed `grey-500` as the text floor, and the
DOM measurement showed `grey-500` is 4.24:1 on a tinted card, which is why the
rule that shipped is `grey-500` on white and `grey-600` on a tint.
