# Stage 1 — The interface, on demo data

**Read `MASTER.md` first. This file assumes it.**

| | |
|---|---|
| Goal | The complete PMS interface, working end to end on demo data — flows, not mockups |
| Data | **Demo fixtures only.** No fetch, no database, no API, no Firebase, no auth |
| Directory | `D:\fidato pms` |
| Reviewed by | The auditor, against §8 |
| Estimate | 3–4 weeks |

---

## Why this stage exists

**We are designing the way the hotel works, not decorating a database.**

The schema is built and proven — 17 migrations, 51 assertions, verified against a
live PostgreSQL. It is not going anywhere. What is *not* settled is how a clerk
moves through a shift: how they find a booking, take a walk-in at 23:40, move a
guest whose air conditioning has failed, and hand over a balanced drawer.

Those decisions are cheap now and expensive later. The CRS proved it — its whole
first phase was the frontend on simulated data, and its second phase then swapped
in a real backend by replacing **one folder** instead of rewriting 34 screens.

> **Everything here must feel finished.** A stakeholder should be able to click
> through a full arrival, a charge and a departure and believe it is live. If a
> screen only makes sense once real data arrives, it is not designed yet.

---

## 1 · The interaction model

Four decisions that govern every screen. **Do not deviate without asking.**

### 1.1 · Stay View is home, and it does not go away

A front desk clerk lives in the tape chart. Everything they do starts there and
returns there.

**Clicking a booking opens a right-hand detail panel — it does not navigate
away.** The chart stays visible behind it. A clerk who loses the chart to check
one thing has lost their place in the day.

**Clicking an empty cell starts a booking, pre-filled with that room and that
date.** That is how the real flow begins: you are looking at availability, you
see a gap, you fill it.

Page navigation is for *changing task*. Panels are for *doing the task*.

### 1.2 · The property is in the URL, and switching preserves context

```
/                      group dashboard
/h/:code/stay          the tape chart
/h/:code/stay?res=…    same chart, detail panel open
```

Switching property while on Stay View lands on **Stay View for the new property,
on the same date**. Never dump the user back to a dashboard — they were mid-task.

A manager can bookmark a property. A support message can carry a link that opens
the exact booking.

### 1.3 · Trained hands are fast hands

Front desk staff use one system all day, every day. They will learn shortcuts,
and the system should reward that.

```
/         focus search          n   new booking
i         check in selected     o   check out selected
Esc       close panel           ?   shortcut help
← →       move the date window  g   go to date
```

Every shortcut also has a visible control. **The keyboard is an accelerator, not
a requirement** — a new joiner on their first shift must find everything by
looking.

### 1.4 · Density is the aesthetic

The live system shows fourteen days across seventeen rooms with no scrolling.
That is not clutter — it is what a duty manager needs at a glance.

> ⚠ **Do not add whitespace to make it feel calmer.** It will make it worse. Our
> design system says *"dense tables, quiet rows"*; this is what that means.

---

## 2 · The five flows

These are the deliverable. Screens are how the flows are expressed, not the
other way round. **Each must run start to finish on demo data.**

### Flow A · Arrival → in house

```
Stay View
  → arrivals pill shows a count
  → click the guest's bar
  → detail panel: booking summary, balance, ID status
  → [Check in]
      ① confirm guest and party size
      ② assign a room       ← only clean/inspected rooms of that type offered
      ③ capture ID          ← camera or upload, skippable with a reason
      ④ confirm rate and meal plan
      ⑤ done
  → the bar turns "in house", the room turns occupied,
    the arrivals count drops by one, behind the panel
```

**The chart must visibly update as the panel closes.** That feedback is what
tells a clerk the work landed.

### Flow B · In house → charge

```
Stay View → click an in-house bar → [Folio]
  → posting list, running balance
  → [Add charge] → category, description, amount, tax band
  → posted, balance moves
  → a wrong posting is REVERSED, never edited
     (the reversal shows as its own line, in rose)
```

The reversal behaviour is a design decision, not a technical one. The ledger is
append-only; the interface must **make that legible rather than hide it**.

### Flow C · Departure → settle → check out

```
Stay View → departures pill → click the bar
  → folio with outstanding balance in red
  → [Settle] → method (cash · card · UPI · bill to company)
  → balance reaches zero, and only then does [Check out] enable
  → [Check out] → invoice preview, GEORGIA serif, print/email
  → the room turns vacant-dirty, and appears on housekeeping's board
```

**Check-out stays disabled with a visible reason while a balance is outstanding.**
Blocked actions are shown, never hidden.

### Flow D · Walk-in at 23:40

The hardest flow and the most common at these properties.

```
Stay View → click an empty cell (room + date already chosen)
  → guest: search existing, or create in the same field
  → nights, party size, meal plan
  → rate: default shown, override allowed with a reason
  → [Confirm and check in]  ← one action, not two
```

A walk-in is not a booking followed by a check-in. It is one act, and the
interface should treat it as one.

### Flow E · Housekeeping, on a phone

```
Housekeeping board (mobile-first)
  → rooms grouped: Vacant Dirty · Vacant Clean · Occupied · Out of order
  → tap a room → mark clean → mark inspected
  → an offline change queues visibly and syncs when signal returns
```

Design this for **a phone held in a stairwell with one hand**. Tap targets, not
mouse targets. The offline queue must be *visible* — a housekeeper needs to know
their work was recorded.

---

## 3 · Sub-stages

**Finish one, report, wait for review.** Do not start 3.4 because 3.3 looks
nearly done.

| # | Sub-stage | Gate |
|---|---|---|
| **3.1** | Skeleton — Vite, React 19, TS strict, Tailwind v4, `theme.css` copied verbatim from `brand/tokens/`, Inter self-hosted, router, Zustand, oxlint, vitest | `npm run build` succeeds · `npx tsc -b` produces **no output** |
| **3.2** | `/design-system` — every token and primitive rendered from the real modules | Matches `brand/tokens/design-system.md` value for value |
| **3.3** | UI primitives on Radix, styled to tokens | Every primitive on `/design-system` in every state; keyboard reaches all |
| **3.4** | Demo data (§4) | Fixtures load; every flow has the data it needs |
| **3.5** | App shell — sidebar, property switcher, breadcrumb, command palette, shortcuts | Switching property changes the shell and preserves the route |
| **3.6** | **Stay View** (§5) | Renders 14 days × 17 rooms with no scroll; all filters work |
| **3.7** | **The five flows** (§2) | Each runs start to finish and the chart updates behind |
| **3.8** | Supporting screens (§6) | Every route reachable, no dead links |
| **3.9** | Housekeeping mobile | Usable at 375px, one-handed |
| **3.10** | States, polish, screenshot review | §8 |

---

## 4 · The demo data

**Model it on the real property.** A stakeholder who recognises the room numbers
believes the demo; one who sees "Hotel A / Room 1" does not.

Use the structure from the live system, with **invented guest names** — no real
guest data in the repository, ever.

**Property: 5 Elements By Fidato Hotels, Akkalkot — 17 rooms**

```
Deluxe        206, 306, 405                    ₹3,399 EP  ·  ₹3,699 CP
Family Suite  403                              ₹10,898 EP ·  ₹8,398 CP
Superior      201-205, 301-305, 401            ₹4,099 EP  ·  ₹4,699 CP
Pancham Hall  (banquet — no rooms, no rate)
```

Plus **six more properties** with plausible names, cities and room counts, so the
group dashboard and property switcher are real. Vary them — do not make seven
identical hotels.

**Bookings must cover every state the UI has to render:**

```
arriving today (unassigned)      in house, balance outstanding
in house, settled                departing today
checked out                      no show
cancelled                        void
released                         tentative
a group booking across 3 rooms   a walk-in taken last night
a guest with a room move mid-stay
a returning guest (2 past stays at a DIFFERENT property)
a blacklisted guest              a foreign national (Form C due)
```

Occupancy should look like a real week — **not 100%, not 10%**. The live system
showed 6–35% across a fortnight; match that shape.

> **No lorem, anywhere.** Every name, amount and date is plausible. Money in
> rupees, dates `DD/MM/YYYY`, tabular figures throughout.

---

## 5 · Stay View — the specification

The centrepiece. From the top:

- **Date picker**, then **filter pills with live counts**:
  `All · Vacant · Occupied · Reserved · Blocked · Due Out · Dirty`
- **Rate plan selector** · **grouping selector** · **Assign Room**
- **Fourteen date columns**, weekday above date, weekends marked
- **Room type group rows** — collapsible, each carrying **two figures per date**:
  availability above, rate below
- **Room rows** — number, then two small status icons, then the timeline
- **Booking bars** — spanning their dates, coloured by state, carrying guest name
  and a source icon
- **Pinned footer** — `Available Inventory` and `Occupancy(%)` per date

**Bar colours come from the token set, and each means one thing:**

```
in house           success  #1f6f5c
confirmed          info     #2b6cb0
tentative          yellow   #ffb600
due out            tangerine#eb8c00
no show            rose     #db536a
reversal / void    red      #e0301e
```

Interactions: **click** a bar → detail panel · **click** an empty cell → new
booking · **hover** → tooltip with dates, rate and balance.

> Drag-to-move is **Stage 4**. Design the bar so it can gain a drag handle
> without redrawing — but do not build it now.

---

## 6 · Screens

Every route renders from fixtures. Screens with no reference material get a
**route and an honest placeholder naming what they will carry** — do not invent
flows that have not been specified.

**Group level**

```
/                    dashboard — one row per property: ADR, RevPAR, occupancy,
                     arrivals due, rooms dirty. ONE hero accent, using the logo
                     gradient, and only one
/guests              guest database, with duplicates visible and a merge action
/companies           corporate accounts
/reports             the report taxonomy, favouritable
/admin/properties    add a property — one form, no infrastructure
/admin/users         staff and their property access
/admin/roles         the live permission matrix
/admin/audit-log     who changed what
/design-system       every token and primitive
```

**Property level** — all under `/h/:code/`

```
stay          the tape chart              reservations   list, three tabs
folios        open accounts               invoices       issued, Georgia preview
housekeeping  status board, mobile        rates          grid, editable cells
night-audit   run and log                 cashiering     placeholder — unspecified
pos           placeholder — unspecified
```

**Statuses to render** — more than the schema currently allows, which is fine at
this stage:

```
Tentative · Confirmed · Checked in · Checked out
No show   · Cancelled · Void      · Released
```

**Void ≠ Cancelled.** A void never happened; a cancellation happened and was
undone.

---

## 7 · What the builder must NOT do

| Do not | Because |
|---|---|
| Any `fetch`, API client, or database connection | Stage 2 and 3 |
| Firebase, any SDK, any auth | Stage 3 |
| Read `D:\PMS FIDATO\db` or model against the schema | Stage 1 is the interface. Coupling the UI to the schema is what the repository seam exists to prevent |
| Design a flow that has no reference material | §6 — route and placeholder instead |
| A raw hex, or an arbitrary pixel value | Tokens only |
| The shadcn CLI, or any component library beyond Radix | Its defaults carry a recognisable generic look |
| Add a dependency not in `MASTER.md` §3 | Ask, and record why in `docs/DECISIONS.md` |
| Put real guest data in the repository | The reference screenshots contain live PII. Invent every name |
| Mark this stage complete | Only the auditor does that |

---

## 8 · Definition of done

1. `npx tsc -b` produces **no output** *(not `--noEmit` — it compiles nothing here)*
2. `npm run build` succeeds
3. `npx vitest run` passes — **check the file count**, not just the word "passed"
4. `/design-system` matches `brand/tokens/design-system.md` value for value
5. **All five flows in §2 run start to finish** on demo data
6. Every route renders for a permitted role, **Forbidden** for one without access
7. Housekeeping usable at 375px, one-handed
8. Every list has **loading, empty, no-results and error** states — empty and
   no-results use different words and offer different exits
9. **A rendered screenshot of every screen has been looked at.** Structural
   checks miss visual bugs — two identical primary buttons read as two perfectly
   normal entries in the accessibility tree
10. No `fetch`, no database client, no auth SDK anywhere in the tree
11. No real guest names or contact details anywhere
12. `docs/DECISIONS.md` records every judgement call worth not re-deriving

---

## 9 · The stage report

```
STAGE 1 REPORT

Gate output
  tsc -b        : <paste>
  npm run build : <paste>
  vitest run    : <paste — including FILE count>

Flows — each start to finish
  A arrival → in house      : <works / what is missing>
  B charge and reversal     : <>
  C settle → check out      : <>
  D walk-in                 : <>
  E housekeeping offline    : <>

Files created/changed
  <list>

Screenshots reviewed
  <which, and what they revealed that the code did not>

Could not do
  <what, and why>

Did beyond the plan
  <what, and why>

Decisions recorded
  <list>
```

Four things make a report unreviewable and it comes back:
missing gate output · "done" claimed on unrun code · work beyond the plan not
called out · screenshots not actually looked at.
