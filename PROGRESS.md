# Progress

Updated after every finished section. **Nothing here is a claim until the gates
below are green and the screen has been opened.**

Last updated: **31 August 2026** · **Phase 1 complete · Phase 2 complete · the buildable backlog closed — out-of-order rooms, housekeeping assignment, cancellation terms, report CSV**

---

## Gates

```
FRONTEND   tsc -b            0 errors
           vitest run        122 passed · 9 files
           build             clean

API        tsc --noEmit      0 errors
           npm test          83 passed   (live Postgres, as pms_app)
                             loads the demo fixture first — see below

DATABASE   db/tests/run.sh   37 migrations · 146 assertions
                             9 isolation checks · exit 0
BACKUP     verify-backup.sh  dumped, RESTORED, 13 checks · exit 0
           load-demo         431 available · 132 sold · 30.63% ✓
```

⚠ **The database gate was lying until this checkpoint.** `run.sh` filtered psql
errors with a pattern that could not match psql's output format, and never read
the exit status. A whole `do $$` block aborted, seven assertions vanished, and
the run printed *"all 44 assertions passed"*. Fixed and then proved by
reintroducing the exact bug. Defect 18 in `MEMORY.md`.

**The seam measure:** `diff` of all 46 files under `src/pages` and
`src/components` against the CP9 baseline — **ZERO changed**. All twelve
repository modules have moved from an in-memory store onto a real database, and
now the business date has too — a value read in **70 places** across those 46
files, moved from a hardcoded constant to a per-property database query without
one screen noticing.

---

## The buildable backlog, closed ✅

Five things had been named as buildable-without-an-answer. All five are built,
opened in a browser, and behind the gates.

### Rooms come out of inventory, and go back

`room_blocks` had been modelled since migration 022 and the tape chart drew
from it. **Nothing had ever written a row** — a housekeeper finding a broken
shower had nowhere to record it, and every block in the database came from the
demo loader.

A block is a **period**, not a switch: a room out from Thursday for the
plumber, or out with no return date at all for refurbishment. A switch cannot
say either, and cannot answer what was sellable last Tuesday — which is what
occupancy divides by.

* Refused while a guest is in the room, and the refusal **names them**.
* The room returns **dirty, never clean**. A fortnight of refurbishment needs
  looking at before somebody sleeps in it, and "clean" is a claim nobody has
  checked. The toast says so.
* The board's old *"Out of order"* was a text label — a state a room could get
  into with nothing offering a way out. It is a button now.

Driven through the browser both ways: vacant-clean 10 → 9 and out-of-service
1 → 2 on the way out; dirty 0 → 1 on the way back.

### The housekeeping board became a work list

It showed every room in the property to whoever opened it. That is a status
display. A housekeeper arriving at eight has one question — **which rooms are
mine** — and the board could not answer it, so the answer stayed on the
supervisor's paper sheet and the board was decoration beside it.

Asked directly, the answer was *rooms assigned to a named housekeeper*. Not a
floor, not a wing, not a shift.

* The assignment carries a **date**. A room is not assigned to somebody
  forever; and dated, the record can answer who was responsible for 204 on the
  night a guest complained.
* One housekeeper per room per day, held by a constraint. Two people told to
  clean 204 is how 204 is cleaned twice and 205 not at all.
* Filter chips per person, with counts, plus **Unassigned** — the one a
  supervisor needs before the shift, because those are the rooms that go
  uncleaned when everybody assumes somebody else has them.

**Who can be assigned is everyone with access to the property**, not only
staff whose role is `housekeeping`. Checked before building: across all three
properties that role is held by **nobody**. Filtering on it would have shipped
a dropdown empty at every property on day one.

The control is a native `<select>` on purpose — it opens the OS picker on a
phone, thumb-sized and one-handed, and is the same control on the desk.

### Cancellation terms, and the no-show charge that follows

Stage 5 said *"No retention is charged on a no-show — whether one is billed
depends on the rate's cancellation terms, which this system does not model. A
guessed charge would be worse than none."* It is modelled now.

**It ships empty, and that is the feature.** A property that has not written
its terms down has none, and the audit charges nothing — exactly what it did
before. Same rule as the prices: the system must not invent a figure nobody at
the hotel agreed to.

* **Cancelling and not turning up are priced separately.** Different acts,
  different money.
* **NULL is not zero.** A booking with no terms has no agreement behind it; a
  booking with terms saying *nothing* has one. The audit reports them apart —
  `retentionCharged` beside `noShowsWithoutTerms` — because rolling them
  together hides the second entirely.
* **Terms are frozen onto the booking**, the same reason `agreed_rate` is a
  column: terms a guest agreed to in March are the March terms. A hotel
  changing its mind in June must not move them. Held by a test.
* The retention posts as **`misc`, not `room`** — no room was occupied, and
  posting it as room revenue would inflate ADR on a night nobody slept there.
  Taxed at the accommodation rate, per CBIC circular 178/10/2022; posting it
  at zero would be a tax determination too, and a wrong one.

**A property-chosen default is not a shipped default.** One policy may be
marked *use for new bookings*; a trigger copies it onto every booking however
it is made. Without that the whole feature could never fire — see defect 81.

### Split billing, five migrations after it was modelled

Migration 006 said it plainly in 2025: *"a company pays the room while the
guest pays their own bar tab, which is two folios on one stay. Model that from
the start; retrofitting split billing is genuinely painful."* The model was
built. **Nothing ever used it** — every stay got one folio, and `bill_to` and
`company_id` were columns no code had ever written, so the commonest corporate
arrangement in an Indian hotel was settled by issuing one bill and letting the
company argue about the bar.

**A transfer is two postings, never a move.** The ledger is append-only and a
folio may already have been invoiced, so a charge leaving one bill is
*reversed* there and *posted fresh* on the other. Three rows exist afterwards
and all three are true: the charge happened, it came off this bill, it went
onto that one.

Both rows land on the **current** business date, never the charge's own — D4
refuses any posting to a night the audit has closed, and its message says
exactly what to do. It is also the right accounting: a transfer agreed this
morning is this morning's movement, not a retrospective edit of a night
already reported.

The suite's assertion is **conservation**: two folios together must hold
exactly what the one folio held. Driven in the browser on a real stay —
Everything ₹7,085 before and after, Guest ₹0, Agoda ₹7,085.

### Reports export

Every report printed and nothing else — the Lodging Tax report is specified as
a statutory **Excel** export and had a Print button, which is the one thing an
accountant cannot paste into a return. Seven reports now export CSV with a BOM
(verified by bytes: `EF BB BF`), CRLF endings, and leading `=`/`+`/`-`/`@`
neutralised so a guest named `=cmd` cannot execute on open.

Found on the way: `Ledgers.tsx` had `onExportExcel={() => window.print()}` — an
Excel button that opened a print dialogue.

---

## The repository seam — 12 of 12 on Postgres ✅

```
✅ properties        one property, its rooms, its tax rates
✅ rooms             reads AND writes; housekeeping marks land in Postgres
✅ stays             a reservation joined to its assignment
✅ folios            derived from the append-only ledger
✅ stayview          the tape chart, one fetch then pure computation
✅ operations        all six flows write — check-in, walk-in, charge,
                     reverse, settle, check-out
✅ statistics        occupancy, ADR, RevPAR — derived, not constants
✅ reportData        monthly, yearly, city ledger, no-show, lodging tax
✅ managerReport     three columns, one derivation per window
✅ directory         guests, companies, room types, audit log, settings

✅ billing           payments, billable folios, rate grid, night-audit checks
✅ notifications     derived conditions
```

**`isDemoProperty()` is deleted** — its removal condition, written on it when
it was added, has been met. The only thing any repository still takes from
`src/data/store.ts` is the `Posting` **type**. No screen, and no repository,
reads that store's data any more.

---

## CP11 — the business date ✅

`BUSINESS_DATE` was `"2026-08-25"`, a literal in a fixtures file, read in 70
places. It is now `app.business_date(hotel)`: **the day after the last
COMPLETED night audit**, falling back to the property's configured date.

Three properties, three different operating days, live right now:

```
5EL   5 Elements Akkalkot     2026-08-25    configured; no audit has run
AGR   Fidato Agra             2027-04-02    the day after its completed audit
PUN   Fidato Pune             2026-08-28    configured
```

A failed or still-running audit does **not** advance the day. That is asserted,
not assumed — five database assertions and six API tests.

**The defect this uncovered was worse than the constant.** Four write paths
dated postings from the server's wall clock:

> A clerk settles a bill at 00:40. The night audit for the 25th has not run, so
> the hotel is still operating in the 25th. The clock says the 26th. The receipt
> lands on the 26th, the night audit closes the 25th without it, and the day's
> cash never balances.

All four now resolve the date from the database inside the same transaction as
the write. Proved by restoring the wall clock in one line and watching the test
fail.

---

## Administration — the writes, and the key that gates them ⏳

The admin section was read-only **in the interface and underneath it**.
`grep -c '<input|<form'` on the admin page returned 0, there was not one admin
write endpoint, and every policy on `staff` and `staff_hotels` was a SELECT
policy. Building the form first would have produced a screen that looked
finished and failed on submit.

**Done**

| | |
|---|---|
| `029_provisioning_key.sql` | no structural change without a key — the hash is stored, never the key |
| `030_admin_writes.sql` | admins may write `staff` and `staff_hotels`; nobody promotes themselves; the last admin cannot be removed |
| `031_property_visibility.sql` | **a clerk sees only the properties they work at** |
| `api/src/routes/admin.ts` | create property · create staff · grant and revoke access · deactivate · the admin overview |

Assertions 81 → 92, and six new isolation checks that run as `pms_app` rather
than as the superuser.

**The key.** `app.require_group_admin()` asks *who*; the key asks whether this
*deployment* permits the act at all. A stolen admin session passes the first
and must not pass the second. Its most valuable state is absent: a box with no
key minted cannot have a property created on it by anyone, including whoever
holds the superuser password.

**A leak found by using it, not by testing it.** `hotels_read` was
`app.is_active_staff()` — every member of staff could list every property in
the group, GSTIN included. No guest data and no money ever crossed a boundary;
the roster did. Nothing failed. I created a clerk through the new API,
rostered them at one property, and asked what they could see: all four.

**The console** — `/admin/console`, **development builds only**

Overview (properties, rooms, people, and how many can sign in and reach
nothing), create a property, create a person, grant and revoke access,
deactivate, fourteen days of activity, and the most recent changes with the
person who made them.

Gated in three places, and the third is the one that holds:

```
navigation   devOnly, filtered by import.meta.env.DEV
route        wrapped in IS_DEV && (...) in App.tsx
bundle       the component is tree-shaken out of a production build
```

Verified by building and grepping: "Provisioning key" appears nowhere in
`dist/assets`. Hiding a link has never been access control, and this screen
manufactures tenants.

Driven through the real form: a wrong key is refused with its reason, the
right one creates the property and says what it did.

---

## Phase 2 — the POS built INTO the system ✅

You asked for the POS built in, not bolted on. The shape was decided by
a constraint that was already in the schema:

```
pos_tickets: check (status = 'rejected' or posting_id is not null)
```

*Anything not refused actually reached the ledger.* An **open** order has
not reached it and must not — the charge does not exist until somebody
settles. So the till could not use `pos_tickets` as its working state, and
rather than relax that invariant it got its own tables and posts **through
the same door an outside POS uses**.

That is the load-bearing decision. The in-house till has no privileged path
to the ledger: it earns its folio posting exactly as Sattva would, so the
idempotency, the one-room-two-guests refusal and the append-only posting did
not have to be written a second time.

```
pos_orders ──settle to room──► pos_tickets ──► folio_postings
  (open, being added to)         (Stage 7)      (append-only)
```

A CASH sale never touches a folio, so it never creates a ticket.

**What was built**

| | |
|---|---|
| `028_pos_till.sql` | menu, orders, lines · RLS forced · DELETE revoked · two triggers |
| `api/src/routes/till.ts` | menu, rooms, orders, lines, settle, abandon |
| `/h/:code/till` | the till — open, add, strike, settle |
| `/h/:code/menu` | the hotel's own prices |
| `/h/:code/till/bill/:id` | the printed bill, 80mm thermal |
| demo menu | in the **loader**, with the invented guest names |

**Three things the database taught this build**

`fp_tax_consistent` requires `tax_amount = round(amount × rate/100, 2)`, and
a posting carries ONE rate. A bill of 5% food and 18% water therefore cannot
be a single posting, and a blended rate does not rescue it — 680 at an
effective 5.76% computes to 39.17 against an actual 39.20. **The settle now
posts one row per rate**, which is also what GST says: two rates are two
supplies.

`pos_orders_room_has_ticket` refused a test teardown that tried to null the
ticket link. The constraint was right and the teardown was backwards.

`pos_order_lines_frozen` blocked the demo loader from deleting its own
property. The first fix made the trigger tolerate a missing parent — which
also let a settled order be deleted outright, and the db suite said so
immediately. The narrow answer was to lift it in the loader, which is what
that file already does for three other triggers.

**The bill prints paise.** The first version showed CGST 16 + SGST 16 +
CGST 4 + SGST 4 against a total of 719 — those add to 40 while the real tax
is 39.20. A guest checking the arithmetic on a document they are paying
finds it does not add up, and they are right.

---

## Phase 1 · item 7 — permissions verified per role ✅

There was **no route guard at all**. `grep -c 'RequireRole\|canAccess' src/App.tsx`
returned `0`. The sidebar filtered what it *showed*; nothing stopped a
front-desk clerk typing `/admin/users`. Verified live as the Agra clerk — the
page rendered.

Row Level Security saved the data (the clerk saw one staff row, their own), so
the leak was the page **shell**, not the roster. That is defence in depth doing
its job, and it is not a reason to hand a clerk the door.

`RequireAccess` asks the **navigation** — `mayReach(role, path)` — rather than
re-deriving the answer from the permission matrix. The first version asked
`canAccess(role, resource)` and let a clerk into `/admin/properties`, whose nav
entry overrides that with a stricter test. A hidden link and a reachable page
is the exact disagreement a guard exists to remove, and the guard had
reintroduced it. The test caught it.

It refuses rather than redirects: a silent bounce to the dashboard reads as a
bug, and Rule 6 says name what was refused and why.

Proved it can fail by removing the guard from `/admin/users` and watching the
test go red.

---

## Phase 1 · item 5 — the mobile pass ✅

23 screens opened at 375px. **No screen scrolls the body sideways** — that held
before this pass and still holds.

What did not hold was everything measured rather than looked at. Four defects,
all invisible in a screenshot except the last, which was invisible in a
measurement:

| | found |
|---|---|
| 48 | every `Button` size a mouse target — 60 primary actions at 32px |
| 49 | housekeeping's "offline" was a button, and a real drop threw silently |
| 50 | the tape chart gave each day **17px** on a phone |
| 51 | the pinned room column painted *underneath* the booking bars |

The fixes key off `pointer-coarse:`, not a breakpoint. What makes a control
hard to press is the finger, not the window width, and the browser already
knows which it has. Verified in both directions — coarse gives 44px, fine gives
32px — so the desktop keeps its density. The tape chart at 1440px is unchanged:
75px columns, no scrollbar.

Housekeeping's own room controls were already `size-11`. That screen was built
for a phone and measured like it.

**Known limit, stated rather than fixed:** inside the tape chart the day cells
(36px) and reservation bars (24px) are chart geometry, not list controls —
making them 44px would halve how many rooms fit on screen. The chart is now
pannable with the room column pinned, which is the thing that makes it usable
at all. A one-night booking is the marginal target; a multi-day one is wide.

---

## Phase 1 · item 4 — the POS view ✅

`/h/:code/pos` was a placeholder reading *"unspecified — Sattva is live in eZee
today, so this is a migration"*. Still true of the TILL. What changed is that
the bridge it posts across exists, was tested, and had no interface — so
settling a restaurant-charge dispute meant running SQL.

**The refusals are the point.** A bill that landed is already on the guest's
folio; a bill that was REFUSED is visible nowhere else, and *"the restaurant
says they charged it, the folio says otherwise"* is the argument this page ends.
They sit at the top of the screen with their reason, above everything else.

```
SAT-7002  Sameer Gokhale  room 202   ₹504     voided
SAT-7001  Sameer Gokhale  room 202   ₹1,302   on the folio
SAT-7003  nobody — refused           ₹900     refused
          Room 308 cannot be charged: nobody is checked in there.
```

An outlet with no API key shows **no key** in red: a restaurant that believes it
is connected and is not finds out at the end of a shift, with a till full of
charges nobody can place.

Not a till. No menu, no orders, no tables — those belong to the POS, which is a
separate system. **One placeholder route left, down from two.**

---

## Phase 1 · item 6 — the in-memory store is gone ✅

```
src/data/store.ts                DELETED (236 lines)
fixture imports in repositories  0   (was 6)
```

Four things were still derived from fixture constants, and **every one carried
a written condition that had been met**:

```
roomCountForDate      "moves when room blocks are modelled"    — 022 did
tape chart sellable   the same six hardcoded August dates      — 022 did
invoice series        "nothing issues one yet"                 — Stage 8 does
POS outlets           "a migration off eZee, not configured"   — the bridge is
staff list            "real the moment there are real accounts" — there are
```

Two were dead code with no callers at all. The rest now read the database: room
blocks arrive on every room, and the tape chart's predicate matches
`app.sellable_rooms` **inclusively on both ends** — the first version wrote
`date < b.to` from habit and would have shifted the boundary a day.

**Reading the real staff list found that nobody could read it.** `staff`
carried one policy, `staff_self`, so every caller saw one row — including the
owner, who could not administer users. A screen that invents its data cannot
discover that the data is unreachable.

Fixing it uncovered a **latent recursion cycle** dormant since migration 020:
`staff_hotels_admin` read `staff` inline, which was harmless until something on
`staff` read `staff_hotels`. Closed at its source.

---

## Phase 1 · items 2 and 3 — the four missing reports ✅

Each was on the reports index with a `stage:` note where its path should have
been. **Zero reports now carry one.**

```
/reports/guest-ledger    every folio that moved, opening to closing
/reports/cashier-shift   what each cashier took, by method
/reports/gst-sales       invoice-level GSTR-1 extract
/reports/c-form          foreign arrivals, documents, and what was filed
```

Two of those notes were CONDITIONS, and both had been met: the GST register
needed the invoice series live (Stage 8) and the C-Form report needed passport
capture (item 1, this morning).

**Building the Guest Ledger found a defect in the Manager Report.** It claimed
₹4,60,697.76 of revenue against a ledger holding ₹4,59,697.76. `w.discount` was
fetched, typed, and never read — so the total was higher than the ledger by
every discount the property had given, and its own rows did not subtract to its
own closing balance. Second time a Manager Report column has been selected and
not read.

The two now agree to the paisa: **₹4,59,697.76 − ₹3,97,041.93 = ₹62,655.83**,
and a test asserts they always will — proved by restoring the bug and watching
it fail.

---

## Phase 1 · item 1 — identity capture ✅

Check-in asked a clerk to "Capture ID document", flipped a boolean, and stored
NOTHING. `guest_documents` had existed since migration 013 and nothing had ever
written to it — so the Form C register printed "not on record" for every
foreign national, and the C-Form report still carried the note *"needs passport
capture at check-in"*.

The ID step now takes a real document: nationality, type, number, and — only
for a foreign national — passport expiry, visa number, visa expiry and address
abroad. **Capture is DERIVED from a document arriving, never asserted by the
client.** A type with no number is refused in a sentence before the database
refuses it as a constraint.

Driven in the browser end to end: an Aadhaar for an Indian guest (no visa
fields shown), a passport for a British one (FRRO block appears), and the
review step now prints what was recorded. The Form C register shows the real
number.

Two more defects found on the way. 013 had a SELECT and an INSERT policy and
**no UPDATE** — a returning guest's renewed visa could not be recorded at all.
And the demo loader **leaked its guests**: `guests` has no `hotel_id`, so
dropping the property left them standing, and eight reloads had put **279 rows
behind a demo that promises 30**.

---

## Tax invoices and Form C — Stage 8 ✅

`invoice_series` and `app.next_invoice_number()` had existed since migration
011 and **nothing had ever called them**. The schema was right and unused,
which looks finished.

```
POST /api/hotels/:code/stays/:id/invoice            issue
GET  /api/hotels/:code/invoices                     list
GET  /api/hotels/:code/invoices/:number             one, with its lines
POST /api/hotels/:code/invoices/:number/credit-note correct it
GET  /api/hotels/:code/form-c                       who owes a filing
POST /api/hotels/:code/form-c/:reservationId        record that one happened
```

A real invoice, driven end to end:

```
5EL/2026-27/00001   ·  29 Aug 2026
supplier    5 Elements Akkalkot, MH   GSTIN 27AAAAA0000A1Z5
recipient   go-MMT
place of supply  MH        SAC 996311

  Room 204 · 2 nights        4,762.00   @5.0%   tax 238.10
  Extras                        681.00   @0.0%   tax   0.00

  taxable value              5,443.00
  CGST @ 2.5%                  136.08
  SGST @ 2.5%                  136.07
  TOTAL                      5,715.15
```

**Place of supply is the PROPERTY's state, always** — IGST Act s.12(3)(b).
Accommodation is supplied where the hotel is, so a hotel invoice is intra-state
(CGST+SGST), never IGST, even for a guest who flew in from Delhi. Charging IGST
to out-of-state guests is the commonest GST error in Indian hospitality.

**An issued invoice cannot be changed by anyone**, superuser included — a
trigger, not a grant. A wrong one is corrected by a CREDIT NOTE carrying its
own number, with every figure negated so the two sum to nothing.

**And it prints.** `/h/:code/invoices/doc/<number>` is an A4 tax invoice a
guest can be handed: supplier block with GSTIN, consecutive number, recipient,
SAC 996311, place of supply with the statutory reason, line items, CGST and
SGST as SEPARATE lines with their rates, total, **amount in words in Indian
numbering** (crore and lakh, not million), and a signature block. Nothing on it
is recalculated — a print view doing its own arithmetic could disagree with the
ledger, and the guest would hold the wrong document while the accounts held the
right one.

A credit note prints as a credit note: every figure negative, "Minus ... Only"
in words, and a banner naming the invoice it cancels. The cancelled invoice
carries the matching banner, so neither can be read as live on its own.

**Both have screens now.** `/h/:code/invoices` lists what is ready to bill with
an Issue button per row, the property's real series from the database, and every
number ever allocated. `/h/:code/form-c` is the register. Driven through the
browser: issued `5EL/2026-27/00001`, watched the series advance to `00002`, and
recorded an FRRO reference against a foreign guest at Pune.

Rule 6 on both: an overpaid folio shows a DISABLED Issue button carrying its
reason; an already-billed stay shows its invoice NUMBER where the button was,
rather than vanishing from the list.

**Form C is a REGISTER, not a filing.** This system cannot file with the FRRO;
that happens on the government portal. It names every foreign national who owes
a filing, shows the 24-hour deadline, marks the overdue ones, and records the
acknowledgement reference — and refuses to record a filing without one,
because a register with no evidence reads as compliance and is not. The
response says so in its own body, not only in a comment.

---

## Backup, restore, and the races — Stage 12 begins ✅

```bash
./db/backup.sh                 # a dump
./db/verify-backup.sh          # dump → RESTORE → check → drop
./db/restore.sh --latest       # put it back
```

**`verify-backup.sh` is the only one that matters.** A backup that has never
been restored is not a backup. It restores into a scratch database and asserts
the figures that must come back — ₹4,19,578.76 room revenue, ₹3,97,041.93
receipts, 25 RLS tables, 37 policies, all three folio triggers. A dump that
restores cleanly but returns ₹0 in receipts has lost the payments table, and
only a check that names a figure would catch it. `pg_restore` exiting 0 would
not.

Proved by making a dump with `--exclude-table=payments` and watching it refuse:

```
x receipts   ERROR:  relation "payments" does not exist
1 check(s) failed. RESTORING THIS FILE WOULD NOT GIVE YOU YOUR HOTEL BACK.
```

`restore.sh` is written for whoever runs it at 03:00: it prints what the target
currently holds in properties and reservations, makes a safety copy of what it
is about to destroy, and requires the database NAME typed out. `--yes` is
refused for the live database.

**Two guards raced, and both proved by removing them:**

```
ra_no_double_booking          drop it → "The same room was assigned to two
                              guests for the same nights."
folio_postings_one_reversal   drop it → "The posting was reversed TWICE."
```

An EXCLUDE constraint does not reject the second writer — it BLOCKS it until
the first transaction ends. That is the guarantee, and it is why the first
version of the test helper hung for twenty seconds.

**And a constraint that was not there.** `005_reservations.sql` documents
`reservations_no_double_booking` at length; `pg_constraint` has never heard of
it, because 011 drops the column it depends on. The protection moved to
`room_assignments` — correct — but 005 read as though reservations were
guarded. A note now says otherwise. Found by testing it.

---

## The night audit — Stage 5 ✅

**A property can close a day.** Until now none ever had:
`app.business_date()` read an empty `night_audit_runs` and returned each
hotel's configured date. This is the only thing in the system that MOVES a
business date; everything else reads one.

```
GET  /api/hotels/:code/night-audit/can-run   may this day close?
POST /api/hotels/:code/night-audit/run       close it
GET  /api/hotels/:code/night-audit/runs      what has been closed
```

In one transaction: refuse if a human decision is outstanding → open the run →
post one night's room charge per in-house stay → mark the arrivals that never
came as no-shows → mark the run completed, **which is what advances the date**.

That order is not bookkeeping. `012_integrity.sql` rejects any posting onto a
date with a COMPLETED run, so the audit's own charges must land while the run
is still `running`. Flip the status first and the audit refuses its own work.

**What it will not do:** check anybody out. A guest still showing due-out is a
question for a person — did they leave, or are they staying? Those have
opposite consequences for the room and the bill. The audit refuses and names
the rooms (Rule 6), and the screen's button is disabled with that same reason,
computed by the same function the server refuses with.

**No retention is charged on a no-show.** Whether one is billed depends on the
rate's cancellation terms, which this system does not model. A guessed charge
would be worse than none.

Driven through the browser: 25 August closed, the date rolled to the 26th, and
Arrivals, the header and every report followed it.

**The Run button was disabled for six checkpoints** with its reason written on
it — *"the business date is a constant in this stage"*. CP11 met that
condition, so it is live. Same removal-condition discipline as
`isDemoProperty()`.

---

## The POS bridge — Stage 7 opens ✅

**The POS is not built here and will not be** — you are building it. What is
built is the boundary it posts across, so it can be written against a contract
instead of a guess. Full spec: `docs/POS-INTEGRATION.md`.

```
GET  /api/pos/rooms              which rooms can I charge?
POST /api/pos/tickets            charge this bill to that room
GET  /api/pos/tickets/:ref       did my last request land?
POST /api/pos/tickets/:ref/void  that bill was voided
```

Four guarantees, each asserted rather than asserted-to:

```
a retry after a timeout returns the SAME posting, never a second charge
a bill takes the HOTEL's operating day, not the POS's clock
a void REVERSES — two rows, net zero; nothing is ever deleted
a room with two open folios is REFUSED, not guessed at
```

**Authentication is a machine key**, sha256-hashed, resolving to a service
account with the `pos` role at exactly one property — so RLS scopes a POS the
way it scopes a clerk, and no endpoint takes a hotel code. A terminal in
Akkalkot cannot address a folio in Agra.

```bash
npm run pos:outlet -- --hotel 5EL --code SATTVA --name "Sattva Restaurant"
```

Prints the key once. It is never stored, only its digest — a database dump is
not the ability to charge guests.

**Driven end to end against the live database**, not just unit-tested: an
outlet provisioned, 8 chargeable rooms listed, a bill charged, retried
(same posting id), recovered after a simulated timeout, voided, and the void
retried. Ledger nets to zero, room revenue still ₹4,19,578.76.

---

## The stages

```
1  Frontend shell and screens        ████████████  61 routes · 1 placeholder, unlinked
2  Repository layer behind the seam  ████████████  12 of 12 modules
3  Auth bridge — Firebase            ███████████░  works; needs a service account
4  Front desk + folio, end to end    ████████████  flows, reports, dating
5  Night audit                       ███████████░  posts, rolls, retains
6  Housekeeping, mobile              ██████████░░  assigned, and rooms come out
7  POS — bridge, till and terminal   ████████████  its own category
8  Billing, GST, Form C              █████████░░░  invoices, split, Form C
9  Rates, availability, STAAH        ███████░░░░░  rates, seasons, plans
10 Group dashboard and reports       ███████████░  11 of 11 reports, all SQL
11 CRS bridge / SU                    ░░░░░░░░░░░░  now IN scope, after go-live
12 Hardening and go-live             █████████░░░  + launch.sh, preflight, nginx
13 POS upgrade — Petpooja-informed   ███░░░░░░░░░  tables, variations, day end
14 Modules + banquet                  ░░░░░░░░░░░░  per-hotel toggle, banquet hall
```

**Stages 13 and 14 are new scope, not newly-found incompletion.** Stage 7 met
the target it was given — bridge, till, terminal, kitchen pass. Then the target
moved: twenty screenshots of Petpooja set a higher bar, and two module
requirements arrived with it. Lowering stage 7 would misreport what happened, so
the new work is its own row. Detail in `POS-PROGRESS.md`.

**119 of 168 — 71%.** Add the filled blocks above and divide by 168. That sum is the number; it is not typed separately, because it was for three audits running and drifted to "about 90%" while the bars said 70.

**Go-live scope — 116 of 132, 88%.** What has to be true for a real hotel to run on this: stages 1–10 and 12. The CRS bridge (11), the POS upgrade (13) and the modules (14) are all real work, and not one of them stops a guest checking in, a folio settling or a night closing.

**The two figures are both honest and they measure different things.** 71% is progress against everything now asked for. 88% is readiness to open the doors. The gap between them is the upgrade programme, and it should not delay go-live.

A caveat that matters more than either figure: **every stage is weighted the
same and they are nowhere near the same size.** Stage 1 is 39 screens. Stage
11 is one bridge. Treat these as a map of what is untouched, not as a
schedule.

---

## The gates have an order, and it is not the obvious one

```
1  db/tests/run.sh          rebuilds `fidato` FROM ZERO
2  cd api && npm test       loads the demo, then tests
3  npx vitest run           frontend
4  db/verify-backup.sh      scratch database, drops it after
```

Step 1 drops the database the app uses. Run it *after* step 2 and the demo is
gone — the app shows two test properties and four reservations, and nothing
anywhere says why. Opening a screen at that point verifies an empty database,
which is a check that passes because there is nothing left to fail.

`run.sh` now says so on the way out. Recovery is `cd api && npm run load-demo`.

---

## Figures that must not move

Every one is now DERIVED from Postgres. If a change moves one, the query is
wrong — not the number.

```
available room-nights 1–25 Aug   431      19 days × 17 + 6 days × 18
room-nights sold                 132
occupancy                     30.63%
ADR                        ₹3,178.63      reconciles to the real export
RevPAR                       ₹973.50        to the paisa
room revenue             ₹4,19,578.76

rooms                        18 physical · 17 sellable · 308 held
tape chart          17 rooms × 14 dates · Occupied 7 · Due Out 3
guests                       30 · 2 flagged for overlapping stays
receipts             59 · ₹3,97,042 · all methods recorded
departed folios      60 · 58 settled · 1 outstanding · 1 overpaid
notifications         6 · 1 arrival · 3 owing · 1 refund · 1 room held

business date         5EL 2026-08-25 · AGR 2027-04-02 · PUN 2026-08-28
```

---

## What is left in this stage

```
1 · offline          Stage 6 asked for it. Zero service-worker files.
2 · channel manager  Stage 9. STAAH is quoted and unbuilt.
3 · retire src/data/store.ts and the in-memory fixtures it seeds.
4 · issue a credit note. Nothing in the interface can.
```

**A credit note can be READ and cannot be WRITTEN.** Found by this audit, not
by a gate. Everything exists except the act: the endpoint
(`POST /:code/invoices/:number/credit-note`), the repository function
(`issueCreditNote`), and an invoice screen that renders a credit note properly
— *"This is a credit note"*, the cancelled-invoice banner, the lot. But
`issueCreditNote` is referenced by **nothing**: not a screen, not a repository
object, not a test. The two credit notes in the database were put there by the
demo loader, which is the only thing that has ever made one.

So a clerk who bills the wrong guest cannot cancel the invoice. The same shape
as defect 81 — every piece built, and no path to the moment it fires.

**E-invoicing: asked and answered — NOT required.** Above ₹5 crore turnover an
Indian business must register each B2B invoice with the IRP and print the IRN
and its QR code. The group is under that threshold, so this is deliberately not
built. It becomes required the year turnover crosses it.

**What backup does NOT cover.** The dump lands on the same disk as the
database, which is a copy that dies in the same fire. Getting it off-box is one
line and depends on where production lives — still question 1 below. Nothing is
scheduled either; that is cron, or the managed provider's own backups.

**The audit is not scheduled.** Somebody presses the button. A hotel that
forgets simply stays on yesterday — which is safe, and visible on every
screen, but it is not automatic and should not be described as if it were.

**A POS screen in the PMS** is not built: no page lists outlets, their bills,
or their refusals. The bridge works without one — a POS posts, the charges
appear on the folio like any other — but somebody settling a dispute currently
needs SQL. Worth a screen once the POS exists to argue with.

Then Stage 4 closes and Stage 5 begins: the night audit *run*.

---

## Still needing a person

Ordered by what blocks the most. Nothing in this list is code — every one of
them is a fact only the group has.

1. **The Oracle instance: its public IP, and a domain name.** *Answered:*
   Oracle Cloud free tier is the choice. Still needed is the box itself —
   until there is an address, nothing can be deployed, TLS cannot be issued,
   and Firebase cannot be told which origin to trust. **This blocks all of
   Stage 12.** The free tier gives no managed backups, so `db/backup.sh` and
   a cron entry become the whole backup story rather than a second copy.
2. **A Firebase service account key** (JSON, from the Firebase console →
   Project settings → Service accounts). Until one exists nobody signs in with
   a password — the real `firebase_uid` path is written and only the token
   check is stubbed, and the API refuses to start stubbed with
   `NODE_ENV=production`. **This blocks real sign-in.**
3. **Names and room counts for six of the seven properties.** Only 5 Elements
   Akkalkot is configured. Each property needs its rooms entered — there are
   no default rooms and no default prices, by instruction.
4. **Cancellation terms per property, if any.** The screen is built and ships
   empty. A property that never bills a no-show needs nothing here; one that
   does needs somebody to write the numbers down, because the system will not
   invent them.
5. **Whether the admin console comes off its development-only gate.** It is
   `devOnly` today, for testing, as asked.
6. **Per-hotel custom roles: yes or no.** Recommendation on file, twice: no.
   The eight roles in `staff_hotels` cover the group, and per-property roles
   multiply the permission surface by seven for a case nobody has hit.
7. **The commercial question** — under ~₹4 lakh a year for the group, buying
   eZee wins and this stops.

---

## Working agreement

- **Commit locally. Do not push.** (Owner's instruction, 28 August.)
- Open the screen before claiming it works. Seventeen defects have passed
  `tsc`, the tests and a clean build while the page was broken — `MEMORY.md`.
- Never invent a number. A dash is an honest answer; a zero is not.
