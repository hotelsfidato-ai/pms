# Agents — how to divide this work without destroying it

Two agents wrote `src/data/` simultaneously for two hours on 27 August. It
destroyed a day's work and was unrecoverable. This file exists so it does not
happen twice.

**Read `CONTEXT.md` and `MEMORY.md` before starting. They are short and every
line in them cost something.**

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

CP6 is complete; there is no screen backlog left to divide. The open items are
in `HANDOVER.md` and none of them is a lane:

- Stage 8 owns the night audit posting run, invoice issuing, and editable tax.
- Stage 9 owns the channel bridge, which unblocks editable rates and commission.
- Four keyboard checks and six property names need a human, not an agent.

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
