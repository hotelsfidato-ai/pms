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

### FIN-24 · The Bill tab's charges-to-come box counts a night that was taken off as still to come (numbered for now)

**Found** - 30 September, planning D27-204 (the owner's D27-205 keeps the
audit's rule: a night somebody reversed is not charged again).

**What is wrong** - the box (`useChargesToCome`, `flows/FolioPanel.tsx`) counts
the stay's LIVE room lines: nights to come = the stay's nights less those. The
night audit asks a different question: is there ANY room line for this night,
reversed or not (`POSTS_TONIGHT`, `night-audit/roomNight.ts`). So after a
clerk reverses a night - the first night on the arrival day, or a night taken
off on Closed days - the box shows one more night to come than the audit will
ever post, and its "Due" is a night too high. The printed bill's "to be posted
tonight" asks the audit's own rule and is right.

**The fix, when it is done** - the server says how many nights are still to
come, by the audit's rule (one read beside `tonight` on the bill route), and
the box shows that. Not done here: the master said a follow-up.

## Fixed

### FIN-23 · Edit and Reverse could not find a stay's own room night on its group's bill — FIXED 30 September (D27-204; numbered for now)

**Found** - 30 September, writing D27-204's tests: Change rate on the arrival
day for a room routed to its group answered "Nothing changed. The night of 26
August: Posting not found."

**What was wrong** - `reverseFolioCharge` and `editFolioCharge`
(`api/src/modules/finance/postings.ts`) looked a stay's line up by the FOLIO's
stay (`f.reservation_id = $2`). A room routed to its group is charged on the
group's master folio, which belongs to no stay, so the line was never found.
It could not be met before: only the night audit posted a routed room's night,
on a day that is closed the moment it is posted, and Change rate corrects a
closed night another way. D27-204 posts the first night at check-in, on an
open day.

**The fix** - `coalesce(f.reservation_id, fp.reservation_id) = $2` in both
lookups: a stay's own folio by the folio, a line on a bill with no stay by the
stay the line itself names.

**Proved** - front desk's `firstNight.test.ts`, "Change rate on the arrival
day, for a room on the group's bill": 409 "Posting not found" with
`postings.ts` put back, 200 and the night at ₹2,500.00 on the master with it.

### FIN-22 · Cashiering told a receptionist their drawer was "handed to nobody" when it had been handed to a colleague — FIXED 30 September (cash lane, D27-202; numbered for now)

**Found** — building D27-202's "both ends on record": the line under Cashiering's closed view read the colleague's name from `staff`, and row security shows a clerk only their own staff row (housekeeping's HK-14, the owner's D27-97). So `handed_to` came back with no name and the screen said "handed to nobody" about a drawer that had a name on it.

**Fixed** — the name comes through `app.hotel_people` (149), as the hand-over list already did; the same line now says the float kept, for whom, and the rest to deposit.

**Proved** — on screen, `fidato_s47`, as Reception: "Your last shift closed … with ₹890 counted: ₹500.00 kept for Test GM, ₹390.00 to deposit."

**The rule** — A colleague's name is read through `app.hotel_people`, never `staff`: a join that returns no row says "nobody", which is a different fact.

### FIN-21 · The desk's drawer opened on a blank float as ₹0 — FIXED 30 September (D27-190, D27-191; numbered for now)

**Found** — the cash lane, reading the drawer for D27-190: Cashiering's "Opening float" sent `Number(opening || 0)` and the server read `input.opening ?? 0`, so an untouched box opened the drawer on ₹0. That is a figure nobody counted, and the close then measured the drawer against it.

**Fixed** — the server refuses a float that is not a typed number ("Count the opening float first - enter 0 if the drawer is empty"); the screen counts it on the note grid the close uses and does not open until something is typed. 0 opens only when somebody types it.

**Proved** — `api/test/modules/finance/cashCounts.test.ts`: a blank float refused and no drawer opened; 0 typed opens. It failed with the old `?? 0` put back.

**The rule** — A count is what somebody counted. Blank is "not counted", never zero.

### FIN-20 · After a payment, the Settle dialog offered the same money again "as the guest's credit" — FIXED 29 September (the speed lane's finding 7)

**Found** — the speed lane (docs/qa/speed-2026-09-29.md, W-3): Take payment answered 200, balance ₹0, and the dialog stayed up showing "₹1,953 more than the bill". Reproduced on `fidato_s31`, sampling the dialog every 500 ms after a UPI payment of ₹3,286.24: at 1.0 s it was `data-state=closed` but on screen, reading "₹0 outstanding … This is ₹3,286.24 more than the bill; it will be held as the guest's credit". On success it closed and refreshed the bill in the same moment; while it animated out the balance arrived at ₹0 and the typed amount had not moved. On a slow machine or a hidden pane (animations frozen) that frame stays, and a tick and a press take the money again under a new press key. A second way in: `settle()` read the whole bill again after the POST, for a line nobody used; if that read failed the payment stood and the dialog never closed.

**Fixed** — on success the dialog clears the amount and the credit tick before it closes; `settle()` answers once the POST is taken.

**Proved** — `settleOnce.test.tsx`: the closing dialog held on screen (an exit animation Radix waits on, never ended) shows no credit offer and a switched-off Take payment; `settle()` answers ok with the re-read failing. Both seen to fail on the old code.

**The rule** — A form that has done its job empties itself before it goes: the screen under it moves, and a closing dialog is still a dialog.

### FIN-19 · A charge could be reversed after its bill's tax invoice was issued — FIXED 29 September (D27-162)

**Found** — planning D27-157 (29 September): `reverseFolioCharge` (↺, and the banquet's reopened bill) asked nothing about a tax invoice, so a charge taken off after the invoice left the bill and the invoice saying two things.

**Fixed** — the owner's D27-162: once a tax invoice stands on the line's bill (issued, not credited: `STANDING_INVOICE`, folios.ts), a charge or discount is refused, "This bill has tax invoice X. Only a credit note corrects it now." A payment or refund reversal stays for the four money roles (D27-125): it is on no invoice, and a bounced card must still be recorded. Edit goes through the same function, so it refuses the same.

**Proved** — `api/test/modules/finance/editCharge.test.ts` "once a tax invoice stands" (↺ and Edit refused, the payment still reversed).

**The rule** — Once a legal document states a figure, only its own correcting document moves it.

### FIN-15 · A split bill was invoiced, settled and listed as one stay — FIXED 28 September (QA FI-1, FI-2, FI-3, FI-7; round A)

**Found** — the QA of 28 September. A split stay's tax invoice went to the booking's company (Agoda) with the guest's coffee on it, and the room was on no invoice: `POST /stays/:id/invoice` took the stay's first folio in no order and read the booking's company for it. Settle on Agoda's tab paid the guest's bill (`folioFor` = the first folio) and asked for the whole stay. Invoices had one row per stay. FI-7 (no re-issue after a credit note) did not reproduce on a one-bill stay; it lived in the same stay-for-bill confusion.

**Fixed** — the payment and the invoice take a `folioId`; one Invoices row per bill with "Billed to"; Settle works on the open tab's bill. The recipient rule is one SQL expression (`RECIPIENT_COMPANY`, invoices.ts), read by the issuing route and the list: a company's bill → that company; a guest's bill → the booking's company only while the stay has no company bill. The per-bill cores are exported for the banquet's function bill (round E).

**Proved** — `api/test/modules/finance/perBill.test.ts` (9 of 10 failed on the old routes), `src/modules/finance/perBill.test.tsx` (both failed on the old screens). Seen in fidato_s25.

**The rule** — money is per BILL, not per stay: a stay can carry two.

### FIN-16 · Money came off a bill by a minus sign, or on one click with no reason — FIXED 28 September (QA FI-4, FI-5, FI-6; D27-117, D27-125)

**Found** — the QA: a −₹50 "charge" was posted; ↺ reversed any charge or payment at once; the running "bal" left a reversed original out and added its reversal.

**Fixed** — the charge door refuses less than nothing; a reversal needs a reason (server and dialog), kept on the reversal's own line; a payment is reversed only by the owner, an administrator, the GM or the accountant; the running balance counts every line.

**Proved** — `api/test/modules/finance/billControls.test.ts` and `src/modules/finance/billControls.test.tsx`, each failed on the old code.

**The rule** — the only way money comes off a bill is a reversal, and a reversal says why.

### FIN-17 · Cash with no drawer, a negative count, a number too large — FIXED 28 September (D27-118, QA FI-10, FI-12)

Cash is refused while the person taking it holds no open drawer (`takeFolioPayment`); a drawer count refuses negatives whole, before it replaces anything (the screen had dropped a −3 and saved nothing); Postgres 22003 is a 400 "That number is too large" in `server.ts` for every route. `billControls.test.ts`; `api/test/drawer.ts` opens a drawer for tests that take cash. **The rule** — refuse the person's figure plainly; a 500 is for the server's faults.

### FIN-18 · The interim bill could not be printed, and printed two totals — FIXED 28 September (QA FI-8, FI-9, FI-16; D27-126)

A Print opening `/h/:code/stays/:id/bill`; Total is the exact figure, no round-off (the owner's D27-126); the town and state print once (`place.ts`, the tax invoice's rule, now shared with the VAT bill). `printedBills.test.tsx`.

### FIN-10 · An invoice test passed or failed by the order the test files ran in — FIXED 28 September

The route took the stay's first bill in no order. Now an unnamed bill is the stay's only CHARGED bill (an empty second bill does not count), and two charged bills are refused ("Say which bill to invoice") - FIN-15.


### FIN-14 · A tax invoice or credit note went out with no hotel GSTIN — FIXED 28 September (release fixes)

**Found** — 28 September, the compliance check before the one release (D27-89). `invoices.ts` copied `hotels.gstin` into the invoice even when it was null, and the document printed "-" as the supplier's GSTIN (CGST Rule 46(a); a credit note, Rule 53).

**Fixed** — both routes refuse before `app.next_invoice_number`, the first write (MEMORY 243), so no number is spent: "This property has no GSTIN, and a tax invoice must carry one. Enter it on the Properties screen, then issue the invoice." The credit note says the same of itself. The owner chose the wording and that credit notes are refused too.

**Proved** — `api/test/modules/finance/invoiceRecipient.test.ts`: with 5EL's GSTIN blanked, both refused and the series' next number unchanged; on the old code the invoice was issued (200).

**The rule** — A statutory field that can be empty is a refusal before the number, not a dash on the document.

### FIN-13 · A company's tax invoice printed the guest's home address — FIXED 28 September (release fixes)

**Found** — 28 September, the same check. `recipient_name` was the company, `recipient_address` the guest's `guest_documents.address_line`; `companies.address_line` was never read (CGST Rule 46(e)).

**Fixed** — when the company is the recipient, its address line and city ("12 MG Road, Pune"; the owner's choice), or "-" when it has neither - never the guest's.

**Proved** — `invoiceRecipient.test.ts`: the issued invoice carries the company's address; the old code gave the guest's.

**The rule** — The recipient's name and address come from the same party.

### FIN-12 · A double tap on Post charge or Take payment posted twice — FIXED 28 September (release fixes)

**Found** — 28 September, the deep audit. Neither button was disabled while its request was on the way, and neither route read an idempotency key, though `folio_postings.idempotency_key` and its unique index exist since 011.

**Fixed** — both buttons show `loading` while sending, and send one key per press (kept until one lands). `postings.ts` answers a repeat of a stored key with the first line before anything is written; the payment asks after the guest's lock and before the cash counts, so the repeat of an accepted cash payment is not counted against the limit.

**Proved** — `src/modules/finance/onePress.test.tsx` (two clicks, one call; on the old dialog the button stayed enabled) and `api/test/modules/finance/onePress.test.ts` (the same key twice, one line; on the old routes the key was not stored).

**The rule** — Money buttons wait for their answer, and money routes remember the press.

### FIN-11 · the drawer hand-over list (cashier.ts) showed nobody but the caller - FIXED 28 September (D27-97)

Read from `staff` joined to `staff_hotels`, whose row security shows each person only their own line unless they run the hotel (housekeeping HK-14). Now reads `app.hotel_people` (149), names only. `api/test/modules/finance/drawerColleagues.test.ts` - failed on the old code, passes now.


### FIN-9 · The Bill tab offered housekeeping every act the server refuses — FIXED 25 September

**Found** — 24 September, by the front desk's polish (D24-27): the stay
panel's Bill tab (`FolioPanel`) drew Add charge, Settle, Interim bill, Split
the bill, Check out, and a Reverse on every line, for every role. Housekeeping
pressed any of them and the server's gate (roleGate) said no.

**Fixed** — D24-18: each act asks roleGate's own question of its write, from
the one matrix (`can(role, ...)`, as `StayView.tsx` and `StayActions.tsx`
do): Add charge and Split the bill `invoice: create`, Settle `payment:
create`, a line's Reverse and Move `invoice: edit`, Check out `reservation:
edit`. The Interim bill is a read the server does not gate; the owner's D25-29:
whoever may see bills, `invoice: view`; and hide Reverse and Move too. So the accountant keeps everything but Check out, a viewer keeps only the
print, housekeeping sees the balance and the lines. Who may do what is
unchanged.

**Proved** — `billTabControls.test.tsx`: reception offered all seven,
housekeeping none, the accountant all but Check out, a viewer only the
Interim bill. On the old panel both tests fail (housekeeping and the
accountant were offered everything).

**The rule** — a button asks the question the server asks of the write it
makes, from the one matrix; a print the server does not gate asks the owner.

### FIN-8 · The GST invoice series for a new financial year existed only after a deploy — FIXED 24 September

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

**Fixed** — the owner's D24-22: the year's series opens itself with its
first invoice, as the VAT bill's does; numbers unchanged. Migration "a
hotel's GST invoice series for a new year opens itself" (138 in this branch)
replaces `app.next_invoice_number` with the same signature and return type:
it inserts the year's row (the prefix the hotel's latest year used, else its
code) before it counts.

**Proved** — `db/tests/modules/finance.sql`, "finance gst": a year with no
series row numbers its first invoice NFY-X/2097-98/00001 and the next 00002,
and the year before does not move. With the insert switched off the suite
stops at that check ("No such hotel").

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

**And the night's room charge** (reported by the night-audit session, 24
September): the audit signs its room lines with whoever pressed Run, and on
cp6's route the line read "room · <a staff uuid>". The owner chose "Night
audit" for them: the route answers that word for a line with
`source_type = 'night_audit'`, and a person's name for every other.

**And the same on Payments** (found 24 September, fixed with the owner's
yes): `GET /:code/payments` answered `user: "admin"` for every receipt, so the
"Taken by" column named nobody who took anything. It now answers
`app.posted_by_name` too, a dash for nobody.

**Proved** — `signedLines.test.ts`, "names the person signed in when it was
posted, and a dash for nobody": a charge posted by the owner reads "Group
Owner"; a line inserted with nobody signed in reads null; and "a payment on
the Payments list names the person who took it". Each fails with its change
taken out. On screen: a laundry line posted as Test Reception read "Test
Reception" (first pass); the retaken `01-…` shows the till's line as "Group
Owner" and the demo's own room line as "-".

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
readers now carry null: the property record answers `null`, and the Lodging
tax heading names no rate at all since the owner's D24-23 ("CGST", REP-13). Billing with no rate was already refused, with where to set
it, by `postCharge` and the night audit (067); an invoice never read the pair.

**Proved** — `db/tests/modules/finance.sql`, "a new property is made with no
CGST or SGST rate" (asked of `app.provision_property_unchecked` directly;
fails with the migration's statement taken out). The helper's second check,
"a rate a hotel already holds is kept", read FH01, which 017 deletes, so it
could never pass and was removed; what it meant was proved by replaying all
136 migrations over `fidato_s1`, whose 5EL kept 2.50 / 2.50;
`api/test/modules/reports/lodgingTaxAlcohol.test.ts` asserts the heading
"CGST" at a new property.

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
