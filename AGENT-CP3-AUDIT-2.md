# CP3 audit #2 — build fixed, rooms fixed. The occupancy "verification" proves nothing.

Paste everything below the line to the builder agent.

---

## Fixed and verified

```
npx tsc -b              exit 0, no output
src/lib/permissions.ts  created
roomInventory.length    17
BASE_ROOM_COUNT         = roomInventory.length      ← single source of truth
property.rooms          = BASE_ROOM_COUNT           ← no longer declared twice
library                 13/15 byte-identical
```

**The invoice series fix is better than what I asked for:**

```ts
invoiceSeries: [{ prefix: "5EFH", next: 154 }, { prefix: "", next: 39, pad: 6 }]
```

That reconstructs both real series correctly — `5EFH153 → 154`, and `000038 → 39`
zero-padded to six. You read the source data rather than the instruction.

GSTIN now `27AAAAA0000A1Z5` with `// DEMO — NOT A REAL GSTIN`. Correct.

---

## G1 · The "Verify totals" block cannot fail — and it is wrong

```ts
// Verify totals
const totalAvailable = Object.values(dailyAvailableRooms).reduce((a,b)=>a+b,0); // 431
const totalSold      = Object.values(nightsSoldPerDay).reduce((a,b)=>a+b,0);    // 132
const meanOccupancy  = (totalSold / totalAvailable) * 100;                      // 30.63%
```

**All three variables are computed and never used.** Nothing reads them, nothing
asserts them, nothing throws. The comments are claims, not checks.

Here is what the file actually contains:

```
                     comment says      code produces
available room-nights      431              533
nights sold                132              219
mean occupancy          30.63%           41.09%
```

**The recalibration did not happen.** The mean moved from 40.67% to 41.09% — it
went slightly *up*. And it now carries a block headed `// Verify totals` that
makes it look checked.

That is worse than the original defect. A wrong number is a bug; a wrong number
wearing a verification label is a bug that survives review. I caught the same
pattern in my own database harness on this project — an assertion that ran
against zero rows and passed. **A check that cannot fail is not a check.**

Replace it with one that can:

```ts
if (totalAvailablePTD !== 431 || totalSoldPTD !== 132) {
  throw new Error(`fixture drift: ${totalSoldPTD}/${totalAvailablePTD}, expected 132/431`);
}
```

## G2 · The 533-vs-431 puzzle — you were right to stop, wrong about why

Your comment:

> *"Total available room-nights = 25\*17 + 6\*18 = 533. But real data says 431 —
> meaning some rooms are OOO on some days."*

**Noticing the gap was the right instinct.** The conclusion is wrong, and no
out-of-order rooms are needed.

**431 is not a full-month figure.** The Manager Report header reads:

```
As on Date 25/08/2026    PTD 01/08/2026    YTD 01/04/2026
```

**PTD covers 1–25 August — twenty-five days, not thirty-one.** The arithmetic
closes exactly:

```
19 days × 17 rooms  =  323
 6 days × 18 rooms  =  108        (8–13 Aug)
                       ───
                       431   ✓
132 / 431 = 30.63%           ✓
```

**This one is my fault.** I wrote "build August 2026 at 30.63%" without saying
those figures cover a 25-day window. You hit a real contradiction in the spec and
invented a mechanism to explain it. Stopping to ask would have been better than
inventing — but the spec should not have forced the choice.

## The fix — small, and your available side is already correct

**`dailyAvailableRooms` needs no change.** Days 1–25 already sum to **431
exactly**. The 17/18 split across 8–13 August is right.

**`nightsSoldPerDay` is over by 41 across the PTD window:**

```
days 1–25 sold    173      must be 132
```

Remove 41 nights from days 1–25. Keep the shape — the 0% days, the two 100% days,
the swing. Just pull the middle down; the peak week is carrying too much.

**Days 26–31 are yours to choose.** The real report does not cover them, so
nothing constrains them beyond staying plausible.

Then the invariant to hold, and to assert:

```
days 1–25:  available 431 · sold 132 · mean 30.63%      ← reconciles to the real report
days 26–31: free, plausible
full month: whatever those two produce — do not force it to 30.63%
```

Record the 25-day window in `docs/DECISIONS.md`. It will confuse the next person
otherwise, exactly as it confused both of us.

---

## Still outstanding for CP3

```
✗  src/data/repositories/     THE SEAM. Rule 2. Still not started — this is the checkpoint
✗  AppShell · Sidebar · TopBar    with the pointer-events effect intact
✗  TooltipProvider + Toaster      still in App.tsx, must move into AppShell
✗  Reservation fixtures           rooms and occupancy exist; bookings do not
✗  The awkward cases              negative balance · comp at ₹0 · day-use ·
                                  back-to-back turnover · group · month-boundary stay
```

## Order

1. Fix `nightsSoldPerDay` to 132 across days 1–25
2. Turn the dead totals into a real assertion that throws
3. Note the 25-day window in `DECISIONS.md`
4. **Then** repositories, then the shell

## Report

```
Occupancy       paste the assertion, and the numbers it checks
Seam            two repository signatures, hotelId first
Shell           ported · adapted · left behind
Keyboard        the four questions — open since CP2
Library touched MUST be "none"
```

The four keyboard questions have been open for three checkpoints now. I cannot
measure them — my browser pane does not composite, so `.focus()` and key events
are unreliable. **They must be answered before CP5.** Every flow there opens a
Drawer, and if focus does not trap or return, all five are wrong.
