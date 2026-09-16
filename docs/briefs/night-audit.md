# Night audit — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/night-audit/          one screen, its data, its tests
api/src/modules/night-audit/      your routes on the server
db/tests/modules/night-audit.sql  new database checks (create it if absent)
```

Your screen: **Night audit** (`/h/:code/night-audit`, first under Reports).
Read `src/modules/night-audit/MODULE.md`, then its `DEFECTS.md`.

**This is the one service where a mistake is expensive to undo.** Closing the
day posts one night's room charge for every guest in house, marks the arrivals
who never came as no-shows, and **moves the business date on**. Charges land on
real folios. A no-show releases rooms (migration 073). A date that moves cannot
quietly move back.

**Change nothing about what the audit posts, marks or moves without the
owner's explicit yes.** Not a figure, not an order of steps, not a condition.

---

## What the defect log and the critique say

### NA-1 · Two night-audit routes have no caller — start here, READ-ONLY FIRST

The route audit of 16 September found two routes nothing calls. That is one of
two things, and they need opposite answers:

- **dead code** — a route superseded and never removed, or
- **a missing button** — a step a person should be able to take and cannot.

**Find out which before touching either.** Read each route, what it does to the
database, and the git history of the screen that should call it. Report the
answer to the owner. **Do not delete a route that writes to folios on the
strength of "nothing calls it".**

### From the critique — why this service is where it hurts

The night audit is **the coldest point in the product**. The night auditor
reconciling the house at 11pm meets:

- "in house" reading **5, 8, 9 and 5** on four screens,
- a paid guest listed under `BALANCE` with her charges,
- a booking that is `In house` on one screen and `Checked out` on another.

**None of those is yours to fix** — they cross front-desk, reservations,
finance and reports, and the master owns them. But you are the service that
*acts* on those numbers. **If your screen reads any of them, say which source
it reads**, in your `MODULE.md`, so the master's fix reaches you too.

---

## What your service stands on

Migrations **023** (the business date), **050** (day end), **073** (a no-show
releases its rooms), **074** (nobody slept there), **006** and **021** (the
folio and a reversal happening once). Read them before you read your own
route.

`api/src/businessDate.ts` is **core** — every service reads the business date
from it. You move the date; you do not own how it is read.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders.

**No — and these will break other chats:**

- `api/src/businessDate.ts` and `src/data/repositories/businessDate.ts` — core.
- `src/modules/finance/` — the folios the audit posts to.
- `src/modules/front-desk/`, `reservations/` — the stays and arrivals it reads.
- `db/migrations/` — ask the master. **Never edit 023, 050, 073 or 074.**
- **The production database.** The audit runs there nightly on real money. A
  read-only look is allowed; any write needs the owner's explicit yes.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- night-audit "one line: what you are doing"`.
3. Read `MODULE.md`, `DEFECTS.md`, and the six migrations above.
4. **NA-1 — investigation only.** Dead code or a missing button? Report it.
5. Write down which sources your screen reads for its figures.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
