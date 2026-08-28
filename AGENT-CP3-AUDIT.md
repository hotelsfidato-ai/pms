# CP3 mid-flight audit — build is broken, and the demo data has three defects

Paste everything below the line to the builder agent.

---

**Stop and fix these before writing the shell.** All three are cheap now and
expensive once AppShell, Sidebar and TopBar are sitting on top of them.

## F1 · The build does not compile

```
npx tsc -b   → exit 2

navigation.ts(7,53): error TS2307: Cannot find module '@/lib/permissions'
navigation.ts(3,58): error TS6133: 'Upload' is declared but never read
navigation.ts(4,21): error TS6133: 'Percent' is declared but never read
navigation.ts(4,30): error TS6133: 'History' is declared but never read
navigation.ts(4,39): error TS6133: 'Workflow' is declared but never read
```

`navigation.ts` imports `canAccess`, `Resource` and `Role` from
`@/lib/permissions`. **That file does not exist** — `src/lib/` contains only
`cn.ts`, `format.ts` and `ui.ts`.

Port it from `D:\fidato crs\src\lib\permissions.ts`, or write the PMS version.
Either way it must produce the **`{ allowed, reason }`** shape — Rule 6 says
blocked actions are shown disabled *with a reason*, never hidden, and the reason
has to come from somewhere.

Then drop the four unused icons.

## F2 · The property has 16 rooms, and says it has 17

```
property.rooms          17
roomInventory.length    16     ← 201 202 203 204 205 206 207 208 209 210
                                  301 302 303 304 305 306
```

The comment in the file reads *"Additional rooms to reach 17"* and the list
reaches 16. No duplicates — one room is simply missing.

**This is the property's single most-confirmed fact.** It came from the Manager
Report's Room Summary and 431 available room-nights across August. Every
occupancy, ADR and RevPAR figure in the product divides by it.

Add the seventeenth room. Then **derive `property.rooms` from
`roomInventory.length`** rather than declaring it twice — two sources for one
number is how they drift apart, and they already have.

## F3 · Occupancy is calibrated 33% too high

```
your mean   40.67%
real        30.63%
```

The *shape* is right and that part is good work — 31 days defined, three at 0%,
two at 100%, a genuine swing rather than a flat line. **Only the level is wrong.**

Real August 2026: **132 nights sold across 431 available room-nights.** Build the
daily numbers so they sum to 132 nights sold, and the mean falls out at 30.63%
on its own. Right now the month implies roughly 175 nights sold — which
coincidentally matches an unrelated figure and would be a genuinely confusing
number to put in front of anyone.

Keep the 0% and 100% days. Pull the middle down.

## F4 · Two smaller things in the fixture

**`invoiceSeries: ["5EFH", "000038"]`** — `000038` is not a series. It is an
invoice *number* that appeared in a Night Audit remark. The two series observed
are a `5EFH`-prefixed one (`5EFH153`) and a plain zero-padded numeric one. Name
them as series, or the generator will produce nonsense.

**`gstin: "27AAACF1234A1Z5"`** — invented. The `27` state code for Maharashtra is
right; the rest is fabricated. A GSTIN prints on tax invoices, and an
invented-but-plausible statutory identifier on a document that looks real is a
hazard, not a placeholder.

**Make it obviously fake** — `27AAAAA0000A1Z5`, or carry a `DEMO — NOT A REAL
GSTIN` note beside it. Same for the invented phone number and email. They are
fine as demo values; they are not fine if they read as real.

---

## What is right, and should not be touched

**`src/lib/ui.ts` is exactly what was asked for.** Only client-side UI state —
`sidebarCollapsed`, `mobileNavOpen`, `commandOpen`. No auth, no identity, no
scope. The header says so explicitly. You even added `persist` with a correct
`partialize` so only the collapse preference survives a reload. That is better
than the instruction required.

**`navigation.ts` has the right structure.** Stay View at `/` as home, sections
declared once and filtered by role, `matchPrefix` for child routes, and a
`canSee` escape hatch. The comment — *"The chrome is the brand; the tree is
not"* — is the right principle recorded in the right place.

**The fixture header documents its own calibration.** Keep doing that.

**Library still 13/15 byte-identical.** Untouched across four checkpoints.

---

## Still outstanding for CP3

```
✗  src/lib/permissions.ts          — blocking the build
✗  src/data/repositories/          — THE SEAM. Rule 2. This is CP3's real work
✗  AppShell · Sidebar · TopBar     — with the pointer-events effect intact
✗  TooltipProvider + Toaster       — still in App.tsx, must move to AppShell
✗  Reservations / stays fixtures   — rooms and occupancy exist; bookings do not
✗  The awkward cases               — negative balance · comp at ₹0 · day-use ·
                                     back-to-back turnover · group · month-boundary stay
```

**The repository seam is the point of this checkpoint.** Screens import from
`@/data/repositories` and never from `fixtures`. Every function takes `hotelId`
first. That one folder is what let the CRS replace its entire backend without
touching 34 screens.

## Order of work

1. `src/lib/permissions.ts` — unblocks the build
2. Fix the room count and derive it from the array
3. Recalibrate the month to 132 nights sold
4. Fix the invoice series and the fake identifiers
5. **`npx tsc -b` must exit 0 before you go further**
6. Then the repositories, then the shell

## Report

```
Build            paste `npx tsc -b` output — must be empty
Rooms            roomInventory.length, and how property.rooms now derives from it
Occupancy        nights sold total, and the resulting mean
Seam             two repository signatures, showing hotelId first
Shell            what you ported, adapted, and left behind
Keyboard         the four questions — still open since CP2
Library touched  MUST be "none"
```

The four keyboard questions have now been open for two checkpoints. I cannot
measure them; my browser pane does not composite. **They must be answered before
CP5**, because every flow there opens a Drawer.
