# Defects — finance

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `FIN-1`, `FIN-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### FIN-8 · The GST invoice series for a new financial year exists only after a deploy

(Written as FIN-5 by the VAT-bill helper; the rule-breakers helper took FIN-5
the same day for the default rate below. Renumbered 24 September.)

**Found** — 23 September, reading the numbering to reuse it for D22-44's VAT
bill. `app.next_invoice_number` raises "No invoice series for hotel X in
2027-28" when the year's `invoice_series` row is missing, and only two things
create one: provisioning a hotel (its current year), and 025's
`insert ... app.current_fin_year(...)`, which runs on every deploy's replay.
Nothing opens the row on 1 April. So the first tax invoice of a new financial
year fails at every hotel unless a deploy has happened since 1 April. Not
seen on a screen; read in the code and the migrations.

**The fix, when it is done** — open the year's row inside the function, as
the VAT series does (`app.next_vat_bill_number`, "a separate VAT bill for
alcohol"): a new function or a new migration keeping its signature. A
statutory series: the master's and the owner's call.

## Fixed

### FIN-7 · A charge refused for a missing GST rule left an empty folio behind — FIXED 24 September

**Found** — 23 September, auditing the finance routes for MEMORY 243's shape
(D22-9, "the three finance rule-breakers"). `postCharge`
(`api/src/modules/finance/postings.ts`) called `folioFor` — which INSERTS a
folio where the stay has none — and only then asked `app.gst_rate_or_null`,
refusing when no rule covers the charge. Inside `withSession` a refusal is a
commit, so the folio stayed. Three doors reach it: the desk's
`POST /:code/stays/:id/charges`, the laundry's and the spa's.

**Fixed** — `folioFor` moved below the rate check; every refusal in
`postCharge` is now above its first write. The other finance write routes
were read for the same shape and hold none: a payment's `folioFor` returns
null only before it inserts; open-a-folio, transfer, invoice, credit note,
the drawer's four and the tax card's two all refuse before they write (the
drawer's "already open" and a second reversal refuse AFTER a failed insert,
which has aborted the transaction, so the commit writes nothing).

**Proved** — `api/test/modules/finance/signedLines.test.ts`, "writes nothing -
not even the folio it would have gone on": a charge at a property with no
room rule is refused 409, says where the rate is set, and the stay still has
no folio. With `folioFor` put back above the rate check, it fails (24
September). The route audit was repeated on 24 September and agrees.

**The rule:** a helper that "opens one on demand" is a write. Count it when
checking that every refusal sits above the first write.

### FIN-6 · A bill line was signed with a uuid, or "admin" — and the Bill tab sent "front desk" — FIXED 24 September

**Found** — MEMORY 256 named `const USER = "front desk"` in
`flows/FolioPanel.tsx`; D22-9 queued it. **What it actually was**, read before
fixing (FD-2's lesson): the literal went as `user` on a charge, a payment and
a reversal, and **no server route ever read it** — `posted_by` defaults to the
signed-in person (101). What the bill line printed under each posting was
`GET /:code/stays/:id/postings`'s `user`: `posted_by::text`, a uuid, or the
word `"admin"` when nobody was recorded.

**Fixed** — the literal and the three dead `user` fields are gone
(`FolioPanel.tsx`, `data/postings.ts`), as FD-2 did for check-in and the
walk-in. The route answers `app.posted_by_name(fp.id)` — the name the Audit
log prints (ADM-1), which names somebody who has since lost access — and null
for nobody; the line prints a dash for null. `Posting.user` in the core's
`types.ts` is `string | null`.

**And the same on Payments** (found 24 September, fixed with the owner's
yes): `GET /:code/payments` answered `user: "admin"` for every receipt, so the
"Taken by" column named nobody who took anything. It now answers
`app.posted_by_name` too, a dash for nobody.

**Proved** — `signedLines.test.ts`, "names the person signed in when it was
posted, and a dash for nobody": a charge posted by the owner reads "Group
Owner"; a line inserted with nobody signed in reads null; and "a payment on
the Payments list names the person who took it". Each fails with its change
taken out. On screen: a laundry line posted as Test Reception reads "Test
Reception" (`.local/screenshots/2026-09-24-finance/01-…`).

**The rule:** before fixing where a value comes from, find where it goes
(FD-2) - here it went nowhere, and the real fault was on the way back.

### FIN-5 · Every new hotel was born charging 2.5% + 2.5% GST — FIXED 24 September

**Found** — D22-9 queued it. `019_property_details.sql` gave
`hotels.cgst_rate` and `sgst_rate` `not null default 2.5`: a rate the system
chose. 067 moved what a posting carries to `tax_rules`, so no charge, invoice
or night audit reads the pair any more — but the Lodging tax heading
(`reports/figures.ts` read it as `coalesce(…, 0)`) and the property record
(`GET /api/hotels/:code`, `Number(null)` is 0) still did.

**Fixed** — a new migration ("a new hotel has no GST rate until somebody sets
one") drops the default and the NOT NULL; stored rates are untouched. Both
readers now carry null: the Lodging tax heading says "CGST @-", the property
record `null`. Billing with no rate was already refused, with where to set
it, by `postCharge` and the night audit (067); an invoice never read the pair.

**Proved** — `db/tests/modules/finance.sql`, "a new property is made with no
CGST or SGST rate" (asked of `app.provision_property_unchecked` directly;
fails with the migration's statement taken out). The helper's second check,
"a rate a hotel already holds is kept", read FH01, which 017 deletes, so it
could never pass and was removed; what it meant was proved by replaying all
131 migrations over `fidato_s1`, whose 5EL kept 2.50 / 2.50;
`api/test/modules/reports/lodgingTaxAlcohol.test.ts` asserts the heading "CGST
@-" at a new property.

**The rule:** a column default is a price if the column is one.

### FIN-4 · The Add charge window previewed "CGST 2.5% + SGST 2.5%" on every charge — FIXED 22 September

**Found** — 21 September, left open in this service's CHANGELOG (the bill as
it stands). The dialog's tick box read "Taxable - CGST 2.5% + SGST 2.5%" and
its preview worked the tax out with `taxOn`/`splitTax` from `src/lib/rules.ts`
— a fixed 5% — while the posting itself (`postCharge`) takes the room's rule
from `app.gst_rate`, which turns on the amount. So an ₹8,000 charge at a
property whose room rule is 18% above ₹7,500 previewed at 5% and posted at
18%, and a property with no rule at all previewed 5% and was then refused.

**Fixed** — the dialog asks `GET /:code/tax/room/rate?amount=` (new, in
`api/src/modules/finance/tax.ts`), which is `app.gst_rate_or_null` — the one
place the slab is worked out — and shows that rate, its CGST/SGST halves and
the total; a dash where nobody has set a rate, "…" while it asks, "not
loaded" if the question failed. `taxOn`/`splitTax` stay in the core's
`rules.ts` (not this service's file); finance no longer calls them.

**Proved** — `src/modules/finance/addCharge.test.tsx` (3): ₹8,000 previews
GST 18% as CGST 9% + SGST 9%, ₹400 previews 5%, an unset rule previews "-".
All three fail with the old label put back. The route:
`api/test/modules/finance/alcoholVat.test.ts`, "the rate a charge will
carry" (2), both fail with the route removed.

**The rule:** a preview asks the rule the posting will use; it never carries
its own copy of the rate.

### FIN-3 · `/in-house` showed ₹7,085 owed by a guest who had paid — the list was an old copy — FIXED 17 September

**Found** — 16 September, the critique's P0, answered by a query (read-only
session, development database `fidato`). **Not yet reproduced in a browser.**

The guest is `FH-2608-4858`, room 201. The database says the balance is
**₹0.00**: charges ₹7,084.69 (room ₹6,747.32 + tax ₹337.37), and one cash
payment of ₹7,084.69. Both ways of grouping the postings agree (by the
posting's stay, which the API uses, and by the folio's stay). **So the drawer
was right and the list was wrong.**

The two screens do not read different figures. `/in-house` calls
`getFolioBalance`, and the drawer calls `getFolio`. Both go to
`GET /:code/stays/:id/folio`. The critique's "the list reads `openFolios`" is
not true of `/in-house` (only front desk's `stayview.ts` reads it). What
differs is **when** each one asked:

- The payment was posted at **06:15 UTC (11:45 IST) on 16 September**.
  Before it, this stay's balance was exactly ₹7,084.69, which prints as ₹7,085.
- `src/App.tsx` sets every query to `staleTime: Infinity` with
  `refetchOnWindowFocus: false`, and keeps the cache for a week. A list
  fetched before a payment keeps that figure until something invalidates it.
  `FolioPanel` invalidates everything, but only in the tab where the payment
  was taken. Another tab or another desk goes on showing the old balance, and
  a reload brings it back from the kept cache.
- The drawer's folio has its own query key, so it asked fresh when it first
  opened.

**The fix, when it is done** — not finance's alone. The cache rule is in
`src/App.tsx` (the master's), and the column is front desk's. It belongs to the
paired front-desk + finance job (`HANDOVER.md` § 3.0g), and the owner decides
how fresh a money figure must be. First, reproduce it: open `/in-house` in one
tab, take a payment in another, and go back.

**Also seen on the same folio** — 26 test lines from 05:27–05:28 UTC on 16
September ("Test outlet — TEST-24536-…", "Reversal — till test"). This is root
`MEMORY.md` 277's run of the API suite against the development database, landing on a real demo guest's
bill. The lines net to zero. They are development data only, but they sit on
the bill a critique opens.

**The rule** — Two screens that call the same endpoint can still disagree, if
one of them asked earlier. Before blaming the query, check how long each
screen keeps its answer.

**Fixed by the master, 17 September — the owner's D17-58: a money figure is
re-checked every time a screen is opened or brought back into view.**
`src/lib/freshness.ts` makes every money query (folio, balances, open folios, In
house, Due out, payments, city ledger, the drawer, invoices, the Dashboard's report)
stale at once and refetched on focus; App.tsx applies it. Rooms, menus and the floor
keep their quiet default. Proved: `freshness.test.ts`; opening In house twice
locally fetched the folio from the server both times.

---

### FIN-2 · `getFolioBalance` returns 0 for a stay with no bill — FIXED 17 September

**Found** — 15 September, writing the brief. **The owner decided on 17 September
(D17-16): a dash, never ₹0.**

Check-out and In house read it. A stay with no folio may therefore read as a zero balance rather than as nothing to settle.

**Traced on 17 September, in code and data. Not yet seen on a screen.** The
database does not promise every stay a folio. Defect 144's bookings were taken
without one, and nothing refuses a reservation that has none. The zero does not
come from `?? 0`, which is only reached when the stay is unknown. It starts
earlier: `GET /:code/stays/:id/folio` checks that the reservation exists, finds
no lines, and returns a folio of zeros marked `settled`. So a stay with no folio
reads:

- **₹0 "Settled"**, in green, at the top of the Bill tab (`FolioPanel`, finance's).
- **Charged ₹0 · Paid ₹0 · Balance ₹0** in the stay panel's footer (`StayDrawer`, front desk's). That code already prints dashes for a null folio. It never gets one.
- **₹0**, in green, in the In house list (`InHouse.tsx`, front desk's).
- **Nothing owed, so check-out is allowed** (`operations.ts` → `canCheckOut` in `src/lib/rules.ts`, the core).

To reproduce: in your own database, remove an empty folio (`FH-1409-5032` in a
copy of the 17 September development data) and open that stay.

**The fix, when it is done** — The API answers "no bill" rather than a folio of
zeros, and the Bill tab prints a dash. The In house column and check-out need
`getFolioBalance` to return `null`, which changes two front-desk files and one
core rule. That part is the master's to split.

**The rule** — Zero and 'nothing here' are different answers; a balance may not blur them.

**Fixed by the master, 17 September (D17-16).** `GET /:code/stays/:id/folio`
answers a stay with nothing posted as 404 `{ noBill: true }`, not a folio of
zeros; `getFolioBalance` returns `null`; the Bill tab says **No bill yet** with the
no-figure mark; In house prints the mark; check-out still sees nothing owed.
Proved: `api/test/modules/finance/noBill.test.ts` (no bill, unknown stay, billed
stay unchanged); opened FH-1409-5032's Bill tab locally — "No bill yet", no
"Settled".

---

### FIN-1 · A stale comment at the top of billing.ts

**Found** — 15 September, writing the brief.

The header still said no invoice number is issued and the night audit does not run. Both stopped being true at stage 8.

**What was done** — 17 September: the header of
`api/src/modules/finance/billing.ts` now names its two reads, `payments` and
`billable`. It says that issuing lives in `invoices.ts` (both the invoice and
the credit note are numbered by `app.next_invoice_number()`, checked in that
file) and that the night audit is its own service. It also says what the old
header claimed, so a reader of an old copy is not misled.

**The rule** — A comment that is out of date is a lie with a good reputation.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **6** · Three defects the ledger hid until new screens read it — Rule: a fixture is only as honest as the screens that have read it. Expect each new screen to find something, and fix the seed rather than the screen.
- **15** · A permission refusal that was a design note — Rule: when a permission refuses something reasonable, ask what the permission knows that you do not. Widening a grant to make an error go away removes the only thing that was telling you.
- **19** · The wall clock standing in for the business date, on four write paths
- **24** · A convenience UPDATE against an append-only ledger
- **30** · The same wrong question, asked in a second place
- **31** · An invoice that taxed the tax
- **33** · A partial index cannot see other rows
- **35** · A counter that was honest until it wasn't
- **36** · A list that invited a button it could only refuse
- **38** · A credit note whose lines did not sum to its own total
- **39** · The application shell would have printed with the invoice
- **55** · One posting cannot carry two tax rates
- **57** · Rupees on a document somebody pays from
- **78** · I wrote a folio posting from memory, again
- **82** · A field called `folioId` that held a stay id
- **83** · A picker keyed by a slug, into a column expecting a uuid
- **102** · A new column with a name the join already had
- **103** · The backfill only fixes rows that already exist
- **144** · A booking with nowhere to put money
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
