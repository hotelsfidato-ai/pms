# Defects — banquet

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `BQ-1`, `BQ-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — check that file
for the next free number before taking one. Fixed entries stay here: they are
the reason the fault does not come back.

---

## Open — not fixed

None, 28 September.

---

## Fixed

### BQ-9 · A function's bill could not be reached: no advance, no settle, no invoice — FIXED 28 September (round E)

**Found** — the QA of 28 September (QA BQ-1, BLOCKS WORK): after Confirm the page said "A bill is open for this function." and nothing more; the bill was on no screen, and every finance path (charge, payment, invoice) was keyed to a stay, which a function does not have.

**Decided** — the owner, 28 September (D27-132 to D27-138): everything on the function's own page; Owner, Admin and GM take an advance, bill it and settle it, the Accountant also issues the invoice; an advance is a payment on the bill, as a room's is, with no GST receipt voucher until the CA answers (B5); restaurant orders settled to a function go onto its bill as a room charge does; SAC 996334 with food, 997212 for a hall alone (CA to confirm); a function with an advance may be cancelled (the advance stays as credit), a billed one may not; not listed on Folios; "Bill the function" any time after Confirm.

**What was done** — a Bill card (`components/FunctionBill.tsx`): Take an advance, Bill the function, Settle, Issue tax invoice, and a link to the invoice, whose page carries the credit note. Three routes in `banquet.ts` (`/bill`, `/payments`, `/invoice`) call finance's per-bill door (round A: `postFolioCharge`, `takeFolioPayment`, `issueFolioInvoice`, `folioBalance`) - no tax is added up in banquet. Billing is refused, before any write, while anything is unpriced, while the banquet GST rule is not set, or while a restaurant order on it is open; it posts the hall and each course under the `banquet` rule and marks the function Completed, after which its price, courses, times and cancelling are refused. The cash limit counts the function's own bill (s.186's one event). The till posts an order settled to a function onto its bill the way a room is charged (`pos/till.ts`), and the day book leaves 'function' out of the till's side as it does 'room' (`reports/figures.ts`). Write rules in `api/src/roleGate.ts`.

**Proved** — `api/test/modules/banquet/bill.test.ts` (8), `api/test/modules/pos/functionOrders.test.ts` (on the folio, counted once), `src/modules/banquet/banquet.test.tsx` (the card by role). On screen in the copy, as the GM: a function registered, confirmed, ₹25,000 advance, billed (₹1,27,500 + ₹22,950 GST), settled, invoice 5EL/2026-27/00001 (SAC 996334, CGST 9% + SGST 9%), credit note 00002, "Issue tax invoice" offered again.

**Left open** — (1) correcting a billed function's figures: a credit note cancels the invoice, but nothing yet reverses the hall or a course on the bill so a corrected invoice can differ; (2) refunding an advance on a cancelled function (waits for the CA's refund voucher, C2); (3) the invoice page's place-of-supply sentence names s.12(3)(b) until round A keys it on the SAC. Questions for the owner, not built.

**The rule** — a bill that has no stay still goes through finance's doors, by the folio.

### BQ-10 · A function showed no GST and nothing said the banquet tax was unset — FIXED 28 September (round E)

**Found** — the QA of 28 September (QA BQ-3): Total ₹1,95,000 with no GST line; the Banquet GST heading "Not set", and nothing warned.

**Fixed** — the owner's D27-124: registering a function while the property has no banquet GST rule says "Banquet tax is not set: ask the GM to set it before the bill." (beside any clash warning), and the function's page shows the same line; billing is refused with it. Asked with finance's `app.gst_rate_or_null`.

**Proved** — `api/test/modules/banquet/qaFixes.test.ts` "banquet tax not set"; `banquet.test.tsx` "warns while the banquet tax is not set"; on screen.

### BQ-11 · A hall price of 0 was saved as a free hall without anybody saying so — FIXED 28 September (round E)

**Found** — the QA of 28 September (QA BQ-8, the owner's question Q-8).

**Fixed** — the owner's D27-120: a 0 is kept only when ticked "Free" - a function's hall price, a hall's usual rate, a package's and a course's rate a head. Round D's `priceProblem` (api/src/validate.ts) on the server; a Free tick beside each box that puts 0 in it and locks it. A host telephone that is not one is refused as well (X-2, `phoneProblem`, `emailProblem`).

**Proved** — `qaFixes.test.ts`; `banquet.test.tsx` "sends a hall price of 0 only with Free ticked"; on screen (a usual rate of 0 refused with the sentence, "abc" refused as a telephone).

### BQ-6 · A function's reference had no lock, and cut long numbers — FIXED 28 September (round E)

**Found** — 17 September, by reading the register route while fixing BQ-7. Measured: `select lpad('10000', 4, '0')` is `1000`.

`POST /:code/banquet/events` makes `BQ-<YYMM>-<n>` as `lpad((max + 1)::text, 4, '0')` with no lock — the two faults 092 fixed for bookings (root `MEMORY.md` 280). Two functions registered at the same moment read the same maximum, and `be_reference_unique` refuses the second with a database message. After the 9,999th function at one property, every new number is cut to four digits and refused as a duplicate.

**Decided** — the owner, 17 September: record it, fix later. Rare today (one GM registers functions), and the fix needs a migration — a per-hotel lock like 092's.

**The fix, when it is done** — a locked, non-cutting reference maker in a migration, and the route switched to it.

**The rule** — `lpad` is a formatting call with a length limit, not a padding call; and a "max + 1" without a lock is a duplicate waiting for a busy minute.

---

**Fixed** — round E, 28 September, in the register route itself (no migration): a per-property advisory lock for the transaction, and the number padded only when it is shorter than four digits. `qaFixes.test.ts`: two registrations at once after BQ-0000-9999 get 10000 and 10001.

### BQ-1 · A restaurant bill cannot be charged to a banquet function — FIXED 17 September (both halves)

**Found** — 15 September, writing the brief, by reading.

Nothing in the till sets `pos_orders.event_id`, so food ordered for a function cannot land on its bill. `PROGRESS.md` says it can.

**Decided** — the owner, 17 September (D17-21): **build it**, banquet first, then the POS chat. And which functions the till may offer: **confirmed, bill open, running on the business date** (from its first day to its last).

**What was done — banquet's half, 17 September**
- The function's screen lists every open and settled restaurant order attached to it (outlet, table, time, amount, status), says an open one is not in the total until settled, and leaves abandoned ones out. The money line "From the till" became "Restaurant orders" — the same words as the list.
- The rule is written once, in `api/src/modules/banquet/attach.ts`: `GET /:code/banquet/attachable` for the till's screen, and `whyNotAttachable` for the till's server, which refuses in a sentence that says which part of the rule failed.
- Exported through both front doors (MODULE.md, "Front door").
- `api/test/modules/banquet/attach.test.ts` — seen to fail with the status filter removed (a cancelled function offered), with the midnight rule removed (a function that ended at midnight offered the next day), and with abandoned orders let through.

**Then still open** — the till attaching an order (the POS chat). Until it ships, `PROGRESS.md`'s claim is still untrue, and `getAttachableFunctions` has no caller: `repositories.test.ts` Rule 2b fails on it, correctly (MODULE.md, Requests).

**The till's half, done the same day** — the POS chat, commit `f671b19` (17 September), on cp6. Tables, the Terminal and the Till attach an order to a function (`components/FunctionPicker.tsx` reads `getAttachableFunctions`, so it has its caller); `till.ts` asks `whyNotAttachable` through banquet's front door before writing the order and again before settling it; an order on a function is paid on the function's bill only (payment "To a function", migration 099) - cash, card, UPI, room and split are refused for it.

**Proved** — `api/test/modules/pos/functionOrders.test.ts` ("attaching an order to a banquet function", "paying for an order on a function - on the function's bill only", which settles one and finds the function's bill counts it once) and `src/modules/pos/functionOrders.test.tsx` (Tables, the Terminal, the Till); the commit records each seen to fail with its fault put back. Moved here 25 September.

**The rule** — A document that claims a feature the code does not have is a defect in the document.

### BQ-8 · A function's time was stored in the SERVER's time zone — FIXED 18 September

**Found** 18 September, by the first CI run, on a Linux machine. The banquet
tests passed here and failed there: a function registered as ending at
`00:00` was offered to the till as running *today*, one day after it ended.

`banquet.ts` writes `$7::timestamptz` from a bare time — `2026-09-17T19:00`
with no offset — and Postgres reads a bare time in the SESSION's zone. This
laptop's session is Asia/Kolkata, so it happens to mean the hotel's clock.
**The hotel's own server runs its database in GMT** (checked on the box,
18 September: `show timezone` → GMT). There, a clerk's 19:00 is stored as
19:00 GMT, which is 00:30 the next morning in Akkalkot.

Then the two readers disagree about the same row:

* the diary (`banquet.ts`) prints `to_char(starts_at, …)` — the session's zone,
  so it shows 19:00 and looks right;
* the till (`attach.ts`) converts `at time zone h.timezone` — the property's
  zone, correctly — and gets 00:30 the next day.

So the screen and the till would place the same function on different days.
Nothing is live on banquet yet, which is the only reason this has not bitten.

**Fixed** the same day, on the owner's word. **Migration 113** holds the rule
in one place — `app.hotel_moment(hotel, text)` reads a bare time on the
property's clock and takes one that carries an offset as the moment it names;
`app.hotel_clock` and `app.hotel_day` read it back. Every write and every read
in `banquet.ts` and `attach.ts` goes through them, so the diary and the till
cannot place one function on two days. Three spellings of the rule became one.

**Nothing was re-read.** The live database holds no banquet events and no
venues (checked on the box before touching anything), so no stored row changed
meaning. Had there been rows, the shift would have been the owner's decision,
not a tidy-up.

**And the suite now asks the question the server asks:**
`api/scripts/with-test-db.sh` sets the scratch database to **UTC**, as the
hotel's box runs it. All 1,038 API tests pass that way, and with the fix taken
out the new `propertyClock.test.ts` fails with the production symptom itself —
`expected '2029-03-18T00:30' to be '2029-03-17T19:00'`.

**The rule:** a bare timestamp means the server's zone, and the server is not
the hotel. Every time written or read belongs to a property, so it carries that
property's zone at both ends. Root `MEMORY.md` 297.

### BQ-2 · Diary opens a screen headed "Banquet" — FIXED 17 September

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

The menu said "Diary"; the page said "Banquet".

**What was done** — the owner decided (D17-22): the heading is the menu name. The Diary is headed "Diary" in all three of its states, which also sets the browser tab. `banquet.test.tsx` "is headed with the menu's word" — seen to fail with the old heading put back alone.

**The rule** — A screen's heading is the menu entry that opened it.

### BQ-3 · A failed load said "This property has no banquet hall" — FIXED 17 September

**Found** — 16 September, by reading, while listing the screens for the owner.

`getBanquetDiary`, `getBanquetEvent` and `getBanquetSetup` ended in `catch { return null }`, and each page read `null` as "the module is off". So a server error, an expired sign-in or no network drew **"This property has no banquet hall"** on the Diary and on Halls and packages, and **"No such function"** on a function that exists. Same shape as root `MEMORY.md` 251 and the critique's `/stay` P0.

**What was done** — the owner chose the restaurant's words (POS-4). The reads throw. Each screen tells refused (the server's own sentence, which is how "no banquet hall" now arrives — only when it is true), unreachable and failed apart, with Try again; a read React Query paused offline counts as unreachable; a failed refresh keeps what was shown under "Not up to date". `components/ReadProblem.tsx` is a named copy of the till's (MODULE.md, Requests). `banquet.test.tsx` — every failed-state test seen to fail on the old pages.

**The rule** — A read that turns every error into "nothing" gives a wrong reason, and a wrong reason is worse than none.

### BQ-4 · One function's screen called its account a "bill" and a "folio" — FIXED 17 September

**Found** — 16 September, by reading `pages/BanquetEvent.tsx`.

Confirming toasted "The hall is held, and a bill is open."; the money card said "A folio is open for this function."

**What was done** — the owner chose "bill": "A bill is open for this function." `banquet.test.tsx` asserts no "folio" on the screen.

**The rule** — One thing, one name, everywhere.

### BQ-5 · The Diary printed raw dates, and each page formatted dates its own way — FIXED 17 September

**Found** — 16 September, by reading.

The Diary read "Nothing confirmed between 2026-09-16 and 2026-10-16."; the pages carried their own 24-hour formatters.

**What was done** — the owner chose the shared formats, 12-hour times included: `dateShort`, `timeOnly` and `dateTime` from `src/lib/format.ts` — "between 16 Sep 2026 and 16 Oct 2026", "14 Nov 2026, 6:00 PM → 11:00 PM". The API now sends "Registered at" as `YYYY-MM-DDTHH:MM` rather than a sentence, so the screen can format it.

**Not covered** — sentences the SERVER writes still carry their own times: the clash warning on registering ("… 14 Nov 18:00 to 14 Nov 23:00") and the confirm refusal from `app.confirm_banquet_event` (060). Changing the second is a migration.

**The rule** — A date on screen goes through `format.ts`.

### BQ-7 · A function the owner registered opened as "No such function" for the GM — FIXED 17 September

**Found** — 17 September, by reading `GET /:code/banquet/events/:id`, then measured: signed in as the GM, the `staff` rows readable were agra, desk and gm — not the owner's; as a desk clerk, only their own.

The function route joined `staff` for "Registered by", and `staff` is row-secured (027). Where the viewer could not read that person's row, the join returned nothing and the WHOLE FUNCTION came back 404. The catering list joined `staff` for "Added by" the same way, so a course a colleague added vanished while the total still counted it. The diary's "Registered by" came back blank for the same reason. Root `MEMORY.md` 283's fault, in this service.

**What was done** — the owner chose to fix it and keep the names. No join to `staff`: the names come from `app.colleague_name` (096), which answers for anybody rostered at the property or a group administrator, and null (a dash) otherwise. `api/test/modules/banquet/names.test.ts`, run as the GM and as a clerk — on the old route both got 404 and the diary no name.

**The rule** — Never join a row-secured table for a label. Test a screen as the role it is for, not as the owner, who sees every row.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **120** · A teardown that cleared the table instead of cleaning up after itself
- **121** · A shared action bar that could not wrap
- **214** · A switch that said "not built yet" about something that was built
- **250** · Any clerk could switch a hotel's modules on or off
- **280** · Postgres `lpad` does not only pad — it cuts (BQ-6 is the same fault)
- **283** · A join to `staff` silently hides rows for most roles (BQ-7 is the same fault)

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
