# Changelog — Marketing

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **The three lists of D18-17 are built; the screen, the server
route and the send are not, and each waits on somebody else** (`MODULE.md`,
Requests).

---

## 2026-09-19 - the three lists, and the four things this service cannot decide for itself

**Asked for:** D18-17, the owner, 18 September - "guest lists that can be acted
on - stayed twice, not returned in a year, came from which site - with an
export, and a send through n8n when an offer goes out". The brief is
`docs/briefs/marketing.md`.

**Shipped** - `logic/lists.ts` and `logic/lists.test.ts`, and nothing else in
code:

- The three lists of D18-17. **Stayed twice** is two or more. **Not returned in
  a year** is a last stay older than the same date last year *and nothing
  booked ahead* - somebody who left in 2024 and arrives next month has
  returned, and an offer to come back is the wrong thing to send them.
  **Came from a site** matches the label the desk already uses
  (`app.booking_source_label`, written once in migration 082), so this service
  is not a sixth place that decides what a channel is called.
- **One gate every list goes through**, `mayBeWrittenTo`. It is where the
  consent condition goes when the master answers, and putting it in each list
  instead would have made that four places.
- The rows of the export. **No CSV writer** - `src/lib/csv.ts` already holds
  the quoting, the formula-injection guard a guest called `=cmd` needs, the
  CRLF and the BOM Excel wants, and a second writer is a second set of answers
  to all three.
- **No `Date` is built anywhere in the file.** A year is taken off an ISO date
  by changing the four characters that say which year it is. `new Date("2026-09-19")`
  is midnight UTC, and this hotel's day belongs to its property (migration 113,
  root MEMORY 297).

**Found** - four things, each written up in `DEFECTS.md` and put to the master
with a recommendation in `MODULE.md`:

- **MKT-1. Nothing records a guest who has asked not to be written to** - no
  opt-out, no consent, no do-not-contact in any of the 119 migrations. Worse,
  the obvious column would not work: `guests` carries **a row per booking**, so
  a flag on one row leaves the same person's other rows writable. Recommended:
  record it against the **address**, not the person. **The owner's decision.**
  Nothing here is put behind a send until it is answered.
- **MKT-2. Birthdays this month cannot be built** - there is no date of birth
  anywhere in this system. It is also not in D18-17, which names three lists;
  the brief widened past the decision.
- **MKT-3. No menu section and no permission resource**, so the screens have
  nowhere to live. The same place laundry and spa stopped on 18 September.
- **MKT-4. The guests door answers without a telephone number or an email**, so
  its list cannot be written to. Asked for it to be widened in the shape
  `postCharge` (D18-7) and the reports door (R1) already took, rather than
  writing a sixth copy of "what counts as a stay".
- **MKT-5. The Coming soon page still describes the service D18-17 replaced** -
  it tells the owner marketing needs Meta Ads access, which it no longer does.
  The copy was not rewritten: the page is due to be replaced outright by the
  real screens, and what a person reads is the owner's.

**Proved** - on this machine, 19 September, and there is no Action to check it
against (the owner's rule: nothing leaves this machine).

| Gate | Result |
|---|---|
| `npx tsc -b --force` | clean |
| `npx vitest run src/modules/marketing` | 17 passed |
| `npx vitest run` (the full web suite) | **46 files, 418 passed**, exit 0, 658s |
| `npm run lane -- marketing` | **yours (4)** - exit 2 against `main`, see below |

**Three guards seen to fail with the fault put back:**

- the gate taken out of all three lists - *"keeps every list behind it"* failed,
  16 passed;
- `!g.nextStay` removed from "not returned in a year" - *"leaves a guest who is
  arriving next month"* failed, 16 passed;
- the dash turned into a blank in the export - both export tests failed, 15
  passed.

**The lane check exits 2, and not because this service strayed.** `npm run lane`
compares against `main`, and this branch carries cp6's own commits - the
laundry, spa and revenue-management merges - so it counts 82 changed files and
names three other services. **The four it lists under "yours" are the only
files this session touched**, and `git diff --stat cp6` is three modified files
and two new ones, all under `src/modules/marketing/`.

**Left open:** the screen, the server route and the send, each waiting on one
of MKT-1 to MKT-4. **No migration number was taken**: this service writes no
table, and whether it needs one at all depends on the master's answer to MKT-1.
Not pushed, not merged, not deployed.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/marketing`, guarded), `pages/Marketing.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
