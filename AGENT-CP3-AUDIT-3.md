# CP3 audit #3 — the assertion is right, still fails, and never runs

Paste everything below the line to the builder agent.

---

## What you got right

**The 25-day window is now correctly modelled and documented.** The header
comment derives 431 the right way, days 26–31 are explicitly marked as
unconstrained, and `_calibration` records the provenance. The available side is
**exactly 431** across the PTD window.

Shape is preserved — three 0% days, two 100% days, no oversold days anywhere.

`DEMO — NOT A REAL …` markers on phone, email and GSTIN. Good.

**And you replaced the dead comment block with a real assertion that throws.**
That was the right instinct.

## H1 · It still fails

```
PTD window 1–25 Aug
  available   431    expected 431    OK
  sold        145    expected 132    ** over by 13 **
  mean      33.64%   expected 30.63%
```

The comment above the block says *"sums to 132"*. It sums to 145.

Remove 13 nights from days 1–25. The peak week is still carrying too much —
`08` through `13` alone account for 86 of the 145.

## H2 · The assertion cannot fire — nothing imports the fixture

```
grep for imports of fixtures/property  →  no results
```

`src/data/fixtures/property.ts` is imported by **nothing**. No repository, no
page, no test. The module never loads, so the `throw` never executes.

**That is why a correct, failing-capable assertion did not catch a live failure.**

This is the same lesson as the dead comment block, one layer up: a check is only
as good as the path that reaches it. Last time the assertion could not fail.
This time it can fail, and nothing asks it to.

**Fix: make it run in the test suite.** One file:

```ts
// src/data/fixtures/property.test.ts
import { describe, it, expect } from "vitest";
import { property, roomInventory, BASE_ROOM_COUNT } from "./property";
// importing the module executes its assertions — if calibration drifts, this fails

describe("property fixture", () => {
  it("has 17 rooms", () => {
    expect(roomInventory).toHaveLength(17);
    expect(BASE_ROOM_COUNT).toBe(17);
    expect(property.rooms).toBe(17);
  });

  it("reconciles to the Manager Report PTD window", () => {
    expect(property._calibration.totalAvailableRoomNightsPTD).toBe(431);
    expect(property._calibration.totalNightsSoldPTD).toBe(132);
    expect(property._calibration.meanOccupancyPctPTD).toBeCloseTo(30.63, 1);
  });
});
```

Now `npm test` fails when the fixture drifts from the real report. **That is the
difference between a check and a comment.**

Apply the same reasoning to every fixture you add from here: if nothing imports
it, nothing validates it.

---

## Order

1. Remove 13 nights from days 1–25 so PTD sold hits **132**
2. Add `property.test.ts` so the assertion actually executes
3. Run `npm test` and paste the output
4. **Then** repositories, then the shell

## Still outstanding for CP3

```
✗  src/data/repositories/      THE SEAM — Rule 2. Not started. This is the checkpoint
✗  AppShell · Sidebar · TopBar     keep the pointer-events effect intact
✗  TooltipProvider + Toaster       still in App.tsx → move into AppShell
✗  Reservation / stay fixtures     rooms and occupancy exist; bookings do not
✗  The awkward cases               negative balance · comp at ₹0 · day-use ·
                                   back-to-back turnover · group · month-boundary stay
```

## Report

```
Calibration     paste `npm test` output showing the fixture test passing
Seam            two repository signatures, hotelId first
Shell           ported · adapted · left behind
Keyboard        the four questions — open since CP2, three checkpoints now
Library touched MUST be "none"
```

**Answer the keyboard questions this round.** I cannot measure them — my browser
pane does not composite, so `.focus()` and key events are unreliable. They block
CP5: every flow there opens a Drawer, and if focus does not trap or return to the
trigger, all five flows are wrong and you will find out after building them.
