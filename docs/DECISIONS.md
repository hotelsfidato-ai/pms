# Decisions

## Recharts v3

**Date:** 2026-08-27
**Decision:** Pin `recharts@^3` instead of `^2`

**Reason:** `recharts@2.x` predates React 19 and has compatibility issues. The CRS runs `^3.10.1` in production. Recharts v3 provides React 19 support and is the actively maintained branch.

**Impact:** Breaking changes from v2 to v3 documented in the [Recharts migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide).

## Toast via zustand, not Radix Toast

**Date:** 2026-08-27
**Decision:** Use the CRS zustand-based Toast implementation instead of `@radix-ui/react-toast`

**Reason:** The CRS Toast system is a zustand store that can be triggered from anywhere in the app without needing to wire a React context through the tree. The Radix Toast primitive requires a provider at the root and is designed for static toast containers, not the dynamic queue behavior a multi-property PMS needs. Ported from CRS to maintain consistency.

**Impact:** Removed `@radix-ui/react-toast` dependency. The `toast()` function from `@/components/ui` is the sanctioned API.

## NativeSelect, not Radix Select

**Date:** 2026-08-27
**Decision:** Use a styled native `<select>` element instead of `@radix-ui/react-select`

**Reason:** The CRS NativeSelect is a plain HTML select styled to match the design system. Radix Select is powerful but adds significant bundle weight and interaction complexity for dropdowns that rarely need custom rendering. For the simple property/room/status selects the PMS uses most, native works better and is faster. Ported from CRS.

**Impact:** Removed `@radix-ui/react-select` dependency.

## TooltipProvider and Toaster hoisted to App.tsx

**Date:** 2026-08-27
**Decision:** Mount `TooltipProvider` and `Toaster` at the root in `App.tsx` at Checkpoint 1, before AppShell exists

**Reason:** The ported UI primitives require these providers. TooltipProvider wraps all Radix Tooltip instances; Toaster renders the toast queue from the zustand store. Both were mounted in the CRS AppShell, but AppShell is Checkpoint 3. Rather than block CP1 on CP3, the providers are hoisted to App temporarily. `delayDuration={400}` matches the CRS value - tooltip timing is part of the design system.

**Impact:** Providers will move into AppShell at Checkpoint 3. This is a temporary staging arrangement to unblock CP1 verification.

## PTD window is 25 days, not full month

**Date:** 2026-08-27
**Decision:** The Manager Report "30.63% occupancy, 132 nights sold, 431 available" covers August 1–25 only (PTD = period-to-date), not the full 31-day month.

**Reason:** The real export header reads `As on Date 25/08/2026  PTD 01/08/2026  YTD 01/04/2026`. PTD is explicitly a 25-day window. The arithmetic closes: 19 days × 17 rooms + 6 days × 18 rooms (8–13 Aug) = 323 + 108 = 431 available room-nights. 132 / 431 = 30.63%.

**Impact:** Demo data calibrates the PTD window (days 1–25) to exactly 132 nights sold. Days 26–31 are plausible continuation, not constrained by any report. Fixture includes an executable assertion that throws if the PTD totals drift from 132/431.

## Room 308 — how availability reaches 18

**Date:** 2026-08-27
**Decision:** Model 18 physical rooms, one held out of service, rather than 17 rooms and an unexplained availability spike.

**Reason:** The Manager Report says `Total Room 17`, taken on 25 August. The Monthly Statistics export shows `Available Rooms` of 18 on 8–13 August. Both are true. A hotel cannot sell more rooms than it has, so an 18th room exists and is normally not sellable.

`roomInventory` therefore carries 18 rooms with 308 marked `out-of-service`, and `BASE_ROOM_COUNT` derives from the sellable count (17). `EXTRA_ROOM_DATES` names the six days it returned to inventory.

**Impact:** Occupancy arithmetic closes exactly — 19 days × 17 + 6 days × 18 = 431 available room-nights, matching the report. Nothing hardcodes 17 or 18.

## The PTD window is 25 days, not a month

**Date:** 2026-08-27
**Decision:** Calibrate demo occupancy against 1–25 August, not 1–31 August.

**Reason:** The Manager Report header reads `As on Date 25/08/2026  PTD 01/08/2026`. Its 431 available room-nights and 132 nights sold cover twenty-five days. Reading them as a full month produces a 33% overstatement and invites an invented explanation — an earlier pass concluded rooms must have been out of order, which was wrong.

**Impact:** `nightsSoldPerDay` days 1–25 sum to exactly 132. Days 26–31 are plausible continuation and constrained by nothing. Both fixture modules assert this at import time, and the assertions are reachable because tests import them.

## Fixtures assert at import, and tests make the assertions reachable

**Date:** 2026-08-27
**Decision:** Every fixture that claims to reconcile to a real report throws on drift, and every fixture has a test that imports it.

**Reason:** An earlier version carried a `// Verify totals` block that computed three values into unused variables. It looked checked and proved nothing — the numbers it asserted were wrong by 13 nights. A later version had a correct `throw` that never executed, because nothing imported the module.

A check is only as good as the path that reaches it. Both failure modes were verified by deliberately breaking the fixture and confirming the suite fails.

**Impact:** `npm test` fails if demo data stops matching the production exports it claims to reproduce.

## Role is a preview control, not identity

**Date:** 2026-08-27
**Decision:** `useUi.role` holds the previewed role. Stage 1 has no authentication.

**Reason:** Rule 1 forbids auth in Stage 1, but the navigation and Rule 6's `{ allowed, reason }` shape both need a role to read from. A preview control lets a reviewer see how the product changes between a front-desk clerk and an owner, which is a demo requirement in its own right.

**Impact:** When real auth arrives, `useUi(s => s.role)` becomes `useSession(s => s.role)` and nothing else changes. The CRS `lib/session.ts` was deliberately NOT ported — it is 451 lines carrying Firebase.

## The seam is enforced by a test, not a convention

**Date:** 2026-08-27
**Decision:** A test walks `src/` and fails if any file outside `src/data` imports a fixture.

**Reason:** Rule 2 is what let the CRS replace its entire backend by rewriting one folder. It only works if nothing reaches around it, and a screen importing a fixture directly fails silently — everything still renders.

**Impact:** Bypassing the repositories breaks the build rather than quietly working.

## Routes carry the property, per §1.2

**Date:** 2026-08-27
**Decision:** `/` is the group dashboard; the tape chart is `/h/:code/stay`, with the open reservation in `?res=`.

**Reason:** An earlier pass put Stay View at `/` and kept `hotelId` only in the Zustand store. That contradicted `PHASE-1-FRONTEND.md` §1.2, which is headed "do not deviate without asking", and it broke two specified behaviours: a stay was not linkable, and switching property could not preserve the task.

**Impact:** `navigationFor(role, code)` resolves `:code` into every property-scoped path. A deep link to a stay outside the fortnight on screen moves the window to that stay rather than opening an empty panel.

## Filter pills and their counts read one source

**Date:** 2026-08-27
**Decision:** `ChartRoom.state` holds occupied / reserved / dueOut / dirty on the business date. Both the pill counts and the filtering read it.

**Reason:** The first version computed counts in the repository and filtered in the page using "has any bar in the window". The Occupied pill read 6 and filtered to 9 rows. A clerk would see that immediately and stop trusting the numbers.

**Impact:** A pill cannot disagree with what it shows. Asserted for all seven pills.

## Out-of-service rooms are outside the sellable house

**Date:** 2026-08-27
**Decision:** Room 308 appears only under the "Blocked" filter. "All" shows 17.

**Reason:** Eighteen rooms exist physically; seventeen are sellable on an ordinary day. Showing all eighteen by default contradicts the Manager Report's `Total Room 17` and the checkpoint's own assertion.

**Impact:** `[data-room-row]` is 17 by default and 1 under Blocked.
