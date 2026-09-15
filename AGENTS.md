# Agents — how to divide this work without destroying it

Two agents wrote `src/data/` simultaneously for two hours on 27 August. It
destroyed a day's work and was unrecoverable. This file exists so it does not
happen twice.

**Start with the top section of `HANDOVER.md`** — it is the current brief:
where things stand, what to do next, the owner's decisions and rules. Then
`MEMORY.md`. Every line in it cost something.

---

## Before your first write — five minutes that save a day

**Read in this order.** All four are short except one, and that one is the
useful one.

| | |
|---|---|
| `HANDOVER.md` | **the top section only** — the current state, what is next, and the rules. Kept current; everything under "Archive" is history |
| `CONTEXT.md` | what this system is, and who it is for |
| `MEMORY.md` | **258 numbered defects.** Not history — the mistakes this codebase has already made. About a third were made *twice* before being written down. |
| `CHANGELOG.md` | what the last agent did, and what they left in flight |
| `START-HERE.md` | how to run it, and where everything lives |

**Then write your own `CHANGELOG.md` entry as you work**, not at the end from
memory. The next agent's first question is always *what was in flight?* and
only you can answer it.

### The four habits that catch the most here

1. **Open the screen before saying it works.** Most defects in `MEMORY.md`
   were found by using the system, not by a gate. The gates are necessary and
   they are not sufficient.
2. **A guard is not a guard until it has refused something.** Add the test,
   then break the code and watch it fail. Eleven guards in this project passed
   with the bug reintroduced.
3. **Ask how many copies there are, not whether two agree.** The commonest
   fault here is one rule written in two places. Twice this month, fixing two
   copies left a third.
4. **Run the numbers you quote.** "254 tests pass" is a claim until you have
   run them in the session you are claiming it.

### What the gates cannot see

Every gate in this repository runs on the machine the code was written on.
**Eight faults were found in one afternoon of deploying** — missing executable
bits, Windows-only paths, a disabled package repository, SELinux, a dump an
older PostgreSQL could not read — and 483 database assertions, 254 API tests
and three clean builds passed throughout. If you touch `deploy/`, `db/*.sh` or
anything a server runs, read defects 187–193 first.

---

## The rule that matters most

**One agent owns one folder at a time. Never two.**

Not "coordinate carefully" — *own*. Claim it in writing before your first
write, release it when your checkpoint closes.

```
CLAIMED   src/pages/reports/, docs/REPORTS-SPEC.md      agent-reports
CLAIMED   src/pages/admin/                              agent-admin
FREE      src/data/, src/components/ui/
```

Keep that block current in `HANDOVER.md`. If a folder you need is claimed,
**stop and say so** rather than writing into it. Waiting costs minutes;
colliding cost a day.

---

## Before your first write

```bash
cd "D:\fidato pms"
git status                 # must be clean
git checkout -b <your-lane>
```

Work on a branch. `main` holds the last verified state. Commit at every
checkpoint, not at the end.

---

## Lanes — all four are now built

The four lanes below ran and closed during CP6. **They are recorded here so
nobody rebuilds them under a different filename.** The files that exist are not
always the ones the lane predicted: several screens were grouped into one file
because they share their data and their chrome.

### Lane A — reports · closed

```
src/pages/reports/ManagerReport.tsx    the daily flash
src/pages/reports/Statistics.tsx       MonthlyOccupancy · Monthly · Yearly
src/pages/reports/Ledgers.tsx          CityLedger · NoShow · LodgingTax
src/pages/reports/Index.tsx            the taxonomy, starrable
src/components/reports/ReportShell.tsx chrome · print · Amount (null vs zero)
```

Lodging Tax is a bespoke table — `DataTable` cannot span columns, and widening
a ported CRS file to make it would have been drift.

### Lane B — admin · closed

```
src/pages/admin/Admin.tsx    Users · Roles · AuditLog · Integrations
                             Settings · AdminProperties     (six exports)
src/data/repositories/directory.ts   staff · audit · integrations · settings
```

### Lane C — guests, companies, inventory · closed

```
src/pages/Directory.tsx      Guests · Companies · Properties · Notifications
                             RoomTypes · RatePlans           (six exports)
src/data/repositories/directory.ts   shared with Lane B
```

### Lane D — the remaining property screens · closed

```
src/pages/Reservations.tsx           the whole book, five filters
src/pages/Billing.tsx                Payments · Invoices · PropertyCityLedger
src/pages/Rates.tsx                  rack against achieved
src/pages/NightAudit.tsx             the pre-flight checklist
src/pages/WalkIns.tsx                the record; the flow is in Stay view
src/data/repositories/billing.ts     payments · billable · rates · audit
```

`cashiering` and `pos` remain placeholders — unspecified, and an honest
placeholder naming what a screen will carry is a correct answer.

---

## Where the next work is

**`HANDOVER.md` § 3, in order.** As of 15 September: the clarity plan's steps
2–4 (one primary button per screen, a menu per role, help in place), then the
staff-first programme's phases 2–4 (reports in the owner's layout with PDF and
Excel, documents on the voucher template, three screens per reservation task).
Items marked "ask first" there need the owner's answer before any code.

If a new lane is needed, claim a folder in `HANDOVER.md` first. The rule at the
top of this file has not relaxed.

---

## Shared, and therefore frozen

**Nobody edits these without saying so first.**

```
src/components/ui/          ported from the CRS · 13/15 byte-identical
src/data/repositories/      the seam · additive only, never restructure
src/data/store.ts           the mutable store
src/data/fixtures/          calibrated demo data with import-time assertions
src/lib/rules.ts            every business rule (Rule 3)
src/App.tsx                 routes — append yours, touch nothing else
src/components/app/         AppShell, Sidebar, TopBar, navigation
```

**`src/App.tsx` is the one file every lane needs.** Add your route, add your
import, change nothing else. Keep the diff to the lines you added.

---

## Reusable pieces — check before you build

Someone already built these. Rebuilding one is drift.

```
src/components/lists/StayTable.tsx   configurable stay list — columns, filter,
                                     search, row → panel. Six screens use it:
                                     arrivals, upcoming, in-house, due-out,
                                     reservations, walk-ins.
src/components/flows/CheckInFlow     five-step check-in, gates on clean rooms
src/components/flows/FolioPanel      ledger, charge, reverse, settle, check out
src/components/flows/WalkInFlow      one-action walk-in with rate override
src/components/ui/                   32 primitives — every one on /design-system
src/components/reports/ReportShell   report chrome, print styling, and Amount —
                                     which prints a dash for null, never a zero
```

The seam already exposes ~68 functions. `listArrivals`, `listOpenFolios`,
`getPeriodStatistics`, `getFolioPostings` and the rest are written and tested.

---

## The ten rules, and which ones bite

Full list in `MASTER.md` §2. In practice these four cause the failures:

**Rule 2 — screens import only from `@/data/repositories`.** Enforced by a test
that walks `src/`. Do not work around it.

**Rule 5 — `hotelId` in every query key.** `queryKeys` in the seam index builds
them so a screen cannot forget. Use it.

**Rule 6 — a blocked action is shown disabled with its reason, never hidden.**
The rules return `{ allowed, reason }`. The same function that disables the
button refuses the write.

**Rule 8 — never claim unrun code works.** Three defects have passed `tsc`, the
tests and the build while the page was broken. See `MEMORY.md`.

---

## Definition of done, per screen

```
Screen           route and file
Reads            which repository functions — must be @/data/repositories
Rules            which src/lib/rules.ts functions gate which controls
What I saw       what you observed in the browser, not what the commands printed
States           empty · loading · error, all three, with different words
Library touched  MUST be "none"
```

**Open every screen you build.** Not the tests — the screen.

Gates, all three, pasted real:

```bash
npx tsc -b        # must produce no output at all
npx vitest run    # all passing
npm run build     # clean
```

---

## If you find a defect in a ported file

`src/components/ui/` runs in production in the CRS. A genuine failure there is a
**CRS bug too**.

**Report it, name the file and line, and stop.** Fixing it in one tree and not
the other is exactly the drift the port was meant to prevent — found later by a
stakeholder rather than by a test.

Two are already open and unfixed for this reason: `Checkbox`/`Switch` have no
accessible name, and nothing uses `focus-visible:`. Both are live in the CRS
today. See `MEMORY.md`.

---

## When something is unspecified

**An honest placeholder naming what a screen will carry is a correct answer. An
invented flow is not.**

The same goes for data. Six of the seven properties have no confirmed name or
room count — `Property Two · awaiting confirmation` is right; inventing
"Hotel Hill Top" is not. The one number that must never appear anywhere is the
unverified 175-room group total.

---

## Handover format

When you finish or stop, update `HANDOVER.md` with:

```
Lane            which one, which branch
Done            screens completed, verified in a browser
In progress     what is half-built, and where exactly you stopped
Blocked         what you could not do and why
Released        folders you are no longer holding
Gates           tsc / tests / build, pasted
```

Release your claim in the same edit. A folder still marked claimed by an agent
that has stopped is worse than one nobody claimed.
