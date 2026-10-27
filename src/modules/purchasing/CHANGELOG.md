# Changelog — Purchasing

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

---

## 2026-10-28 · Supplier dues: goods on credit, and paying for them (the owner's D27-370)

**Asked for:** the owner's D27-370 (27 October): a delivery on credit records the supplier's bill (number, date, amount, due date); a Supplier dues list of what is owed to each supplier; a payment later (cash, cheque, bank, UPI), marked paid, with a report. The Accountant, GM, owner and Admin see the dues and pay; the Inventory Manager records the bill but does not pay. No cash drawer changes. Helper branch for the master.

**Shipped:** migration 246 (`supplier_bills`: one bill on credit from a delivery OR a bar bill, its payment four columns all-or-none, paid once - a trigger; the app may insert a bill and update only its payment columns, never delete; RLS forced; trading for a test hotel). `api/src/modules/purchasing/supplierDues.ts` (`GET /:code/purchasing/dues`, `POST /:code/purchasing/dues/:id/payment`, `creditProblem`, `recordCredit`), mounted from `index.ts`. The delivery route takes `credit: { billNo, billDate, amount, dueOn }`; a bar bill takes `dueOn` and uses its own number, date and printed total (**bar bills are deliveries too: they count in the dues**). `DUES_ROLES` (owner, admin, gm, finance) in `purchasingGrants.ts`, held equal to `approve` on `invoice`. Screens: "On credit" in Record the delivery and Record a bar bill; the delivered order and the bar bill say "On credit, due ... - not paid yet / paid on ..."; a **Supplier dues** tab on Purchasing (`components/SupplierDues.tsx`) for the four, each supplier's bills and total, the total owed, overdue in red, Record payment. The **Supplier dues** report (reports service, below). Manual A9.11 and A11.6; picture plans A9-45, A9-46, A9-47, A11-25.

**Proved:** `api/test/modules/purchasing/supplierDues.test.ts` 6/6; `supplierDues.test.tsx` 2/2, `purchasing.test.tsx` and `barBills.test.tsx` each one new test; "supplier dues" in `db/tests/modules/purchasing.sql` 12/12. Seen failing with each guard taken out, then restored: the payment's role check (the Inventory Manager's payment answered 200), the dues list's role check and the report's roleGate rule (200 for the hotel manager), the due-before-bill check (the database's constraint still refused it, as a 500), the tab's role check on screen, and the paid-once trigger ("a paid bill is not paid again: statement succeeded").

**Left open (the owner's):** part payments; editing or deleting a recorded bill or payment; credit notes and returns; GST on the bill beyond the delivery's lines; a supplier with no due date; suppliers' own statements; TDS; whether a reference is required for cheque, bank and UPI. **Pictures:** A9-45 to A9-47 and A11-25 to be taken by the master.

## 2026-10-21 · Bar bills, with their photo (the owner's D27-354)

**Shipped** Purchasing's two tabs, Restaurant and hotel (as before) and Bar; Record a bar bill: supplier, number, date, photo, drinks picked or added ("Add another drink"), bottles and cost per bottle; into the bar's store at once - migration 234, `barBills.ts`, `components/BarBills.tsx`. **Proved** `api/test/modules/purchasing/barBills.test.ts`, `barBills.test.tsx`, "bar bill" in `db/tests/modules/purchasing.sql`. The root `CHANGELOG.md` has the whole entry.

## 2026-09-26 · PUR-2 held by a test; PUR-3 found

**Asked for:** the owner's D25-27 (a test for each fix built but held by none, then close it; no behaviour changed), in the five-tests session, branch `tests/five-25sep`. **Shipped:** `purchasing.test.tsx`, "lists a waiting purchase on the Approvals screen and decides it through the core (PUR-2)". **Proved:** seen failing with the `/h/:code/approvals` route taken out of `App.tsx`; passes on the fix. PUR-2 moved to Fixed. **Found:** PUR-3 - the Approvals screen links a purchase to `/h/<code>/purchasing/requests/<id>`, which nothing mounts (the core's `approvals.ts`); not fixed, for the master and the owner. **Commits:** `689f837`.

---

## 2026-09-24 · Housekeeping sees and raises requests (D22-11, PUR-1)

On `admin/finish-24sep` (the helper's `admin/hotel-admin-menus`, finished):
housekeeping holds `purchasing: view, create` (`api/src/permissions.ts`),
`VIEW_ROLES` and the refusal's sentence name them, and - the owner, 24
September - Purchasing is in housekeeping's menu. Raising still waits on their
switch in "Who may ask to buy" (D18-2, off by default). **Proved:**
`purchasingGrants.test.ts` "lets housekeeping raise one once the setting names
them"; `navigation.test.ts` pins their menu. Screen:
`.local/screenshots/2026-09-24-admin/12-purchasing-housekeeping-*` ("Your role
cannot raise a purchase request at this property" until switched on).

---

## 2026-09-18 · Built: a request, the GM's approval, a PDF order, a delivery

**Asked for:** § 1 of `docs/BUILD-PLAN-2026-09-18.md` — purchasing first, and
the smallest thing that works end to end. The owner's D18-2, D18-3 and D18-4,
in that order: the setting for who may raise, then the request, then the
approval through the engine that exists, then the PDF order, then the delivery
as a Store receipt.

**Shipped**

- **The setting first (D18-2).** `purchase_requesters`, a row per role per
  property, switched off and never deleted. Every property starts with the
  Inventory Manager, the GM, the owner and an administrator — and so does every
  property created after, by a trigger, 095's shape. `app.may_raise_purchase`
  is the one place the question is answered, so a screen, a later endpoint and
  a script cannot give three answers. Its own screen, `/h/:code/purchasing/who-may-ask`.
- **The request.** `purchase_requests` and `purchase_request_lines`. One row
  from "we need rice" to "it arrived", with its own reference
  (`PO-5EL-2609-0001`, its own count per hotel, and `lpad` used the way
  MEMORY 280 says).
- **The approval.** Raised through `app.request_approval` with kind `purchase`
  — defined since 076 and wired to nothing until now. Every property gets the
  owner's rule: **the GM, at any amount** (D18-4, `over_amount` null, which is
  not 0).
- **Where a request has got to is DERIVED ONCE**, on the server, from its own
  status and the approval it points at. What the GM said is never copied onto
  the request.
- **The order (D18-3).** A PDF in the group's layout, made by the **shared**
  renderer — `orderDocument` builds a `ReportDoc` and `api/src/reportRender.ts`
  draws it, so no second renderer exists. Sent by hand; nothing waits on n8n,
  and the paper says so.
- **The delivery.** What came may differ from what was ordered and **both stay**
  — `received_quantity` sits beside `quantity`, never over it. The stock lands
  as a receipt **through the Store's own front door**, carrying the supplier and
  the order's reference, so the Store's history points back at the order.

**Found**

- **A DEPLOY-STOPPER THAT IS NOT THIS SERVICE'S**, found because it blocked 115
  from applying: `078_roles.sql` re-adds `staff_hotels_role_valid` from
  `app.assignable_roles()`, and **093** is what added `revenue_manager` to that
  function. Every deploy replays from 001, so 078 runs with the narrow list and
  validates it against the rows that are there — one person given the Revenue
  Manager role and **every deploy after that fails and rolls back**. MEMORY
  293's family. Reproduced clean (fresh database → 115 migrations, exit 0 → one
  `revenue_manager` row → replay → `ERROR: check constraint
  "staff_hotels_role_valid" … is violated by some row` at 078:105, exit 3).
  Reported to the master, **fixed by them on cp6 (f5a7f99)** — and their sweep
  found a fourth of the same family in 056/060. Root `MEMORY.md` 299.
- **`db/migrate.sh` hid the real error.** On failure it ran
  `grep -iE "ERROR|HINT|^psql:" | head -6`, and every NOTICE matches `^psql:`,
  so six "already exists, skipping" lines filled the window and the ERROR never
  printed. Reported; fixed by the master.
- **PUR-2: there is no approvals SCREEN.** The brief says the GM approves "in
  the approvals inbox that exists". The engine and its routes are real; nothing
  draws a shared inbox — equipment decides its own on the equipment screen.
  Found by opening `/h/5EL/approvals` and being redirected to the Dashboard.
  Purchasing now decides on the order, the same shape, reading `mayDecide` from
  the core queue rather than copying its rule.
- **PUR-1: housekeeping can be switched on and still be refused.** D18-2 lets
  the owner switch them on; `src/lib/permissions.ts` gives them no `purchasing`
  grant at all. One line, the owner's call, not made here.
- **Two things wrong on the screen, found by opening it, not by a test:** Send
  was offered on an approved order that still had an unpriced line — a button
  the database refuses — and the roles on the setting screen were sorted by
  their stored key, so Reception sat between Accountant and General Manager.
  Both fixed; the first has a test.

**Proved** — on the tree that was committed, exit codes read, not summaries.

```
npx tsc -b --force         clean            web
cd api; npx tsc -b --force clean            server
cd api; npm run strip-check 121 files       the server loads without types
npx vitest run             382 passed       43 files, exit 0
cd api; npm test           1067 passed      67 files, exit 0 (see below)
bash db/tests/run.sh       879 assertions   42 of them purchasing, exit 0
bash db/tests/rerun.sh     115/115 replay   exit 0
npm run build              clean            "no test sign-in in dist"
```

⚠ **The API suite failed once and passed on a clean re-run.** The failure was
`api/test/modules/finance/invoices.test.ts` ("nothing to invoice", expected 409)
— not a file this service touches, and green on the run above and in its own
run. Recorded rather than quietly re-run: it looks like the load flake the
night-audit screen test has shown before.

**Guards seen to refuse something** — each broken, watched to fail, put back
(copied aside, never `git stash` — MEMORY 294):

| Guard | With it removed |
|---|---|
| `app.mark_purchase_ordered`'s unpriced check | database suite exits 1 and stops at the assertion that an approved-but-unpriced order cannot be sent |
| the screen's `r.unpriced === 0` on Send | "does not offer Send on an approved order that still has an unpriced line" fails: *expected button to be null* |
| `VIEW_ROLES` parity with the matrix | two API tests fail: *expected [housekeeping, 200] to equal [housekeeping, 403]*, and the parity assertion itself |

**Opened on screen, at 1353px and at 375px**, signed in as the Inventory
Manager, the GM and the owner: raised PO-5EL-2609-0001 (rice unpriced, oil at
₹140 — total read "-", not ₹1,400), the GM approved it, priced the rice at ₹62
(total ₹4,500), sent it to Akkalkot Traders, downloaded the order (200,
`application/pdf`, `PO-5EL-2609-0001.pdf`, one page), received 45 kg of the 50
ordered with a note, and **the Store then showed 45 kg at ₹64/kg in the Main
store** with the movement carrying the supplier and the order's reference. On a
phone: no sideways scroll, nothing outside the viewport, every control at the
shared touch size.

**Left open**

- **PUR-1** (housekeeping's grant) and **PUR-2** (a shared approvals screen) —
  both the owner's, both in `DEFECTS.md`.
- **Eight files outside this lane**, every one listed in `MODULE.md` under
  Requests, made on the owner's word of 18 September and confirmed by the master
  for review at merge. Pushed with `--no-verify`, which is what the master said
  to do for this branch.
- **The migration is numbered 115 here and becomes 116 at merge** — cp6's 115 is
  the master's laundry and spa. The master does the renaming; it is not touched
  here.

## 2026-09-16 · A folder and a Coming soon page

**Asked for:** the owner approved the stock-and-equipment plan, with Purchasing
as its own service (S8). The master chat built the folder, the page, the menu
entry and the address in phase 0, so the chat that builds phase 2C starts in a
folder that already exists.
