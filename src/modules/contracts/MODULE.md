# Contracts: companies, agents and the rates they agreed

**BUILT 30 September 2026** (D27-178; the owner's answers D27-184, C-1 to
C-13, all as the lane recommended). Branch `contracts/rates-30sep`.

A company's record (add, edit), a contract per company and hotel, and the
booking priced by it. Allotments (rooms held until a release date) are
**not** built: later, when there is such a contract (C-12).

```
src/modules/contracts/                  the screens, the dialogs, the client
api/src/modules/contracts/contracts.ts  the routes
db/migrations/177_contracts.sql         (was 173 before the merge of 2 Oct)
db/tests/modules/contracts.sql          what only the database can promise
api/test/modules/contracts/             the routes, the booking, the credit refusal
```

---

## The owner's answers (D27-184)

| # | Rule |
|---|---|
| C-1 | A contract prices by **fixed rates** or by **a % off the day's rate**, one or the other, per contract |
| C-2 | Fixed rates are **single and double** per room type and meal plan, either may be a dash; a third guest pays the rate calendar's extra-person price |
| C-3 | The contract **in force on the arrival date** prices every night (the booking keeps the first night's price, D27-61) |
| C-4 | No contract figure for the room type and plan: **the day's calendar price**, and the desk is told so |
| C-5 | The Rate box and the Discount box work on a contract price exactly as on the calendar's (D27-62) |
| C-6 | **Owner, admin, GM** add and edit companies and contracts; reception, hotel manager, accountant and viewer read them; the revenue manager does not see them |
| C-7 | **Reception may add a company**: name, GSTIN and address only, never credit (`front_desk` holds `company: create`) |
| C-8 | An agent's contract may carry a **commission %**, stamped on the booking in place of the booking source's (082's rule) |
| C-9 | Credit is **the company's, for the group**: allowed or not, days, limit. **Bill to company is refused** for a company not allowed credit; days and limit are shown, not enforced, until company payments are recorded (D27-152). Companies already billed on credit start with it allowed |
| C-10 | One contact person per company |
| C-11 | No two companies with one name or one GSTIN (asked by the route, not an index: an index could fail a deploy on rows nobody has seen) |
| C-12 | Allotments later |
| C-13 | Add company on Contracts and on Companies and agents, the same dialog |

---

## Screens

| Menu name | Address | Page file | Who sees it |
|---|---|---|---|
| Contracts (Distribution) | `/contracts` | `pages/Contracts.tsx` | whoever holds `company: view` |
| (a company) | `/contracts/:companyId` | `pages/CompanyContracts.tsx` | the same |

Dialogs: `components/CompanyDialog.tsx` (exported: guests' Companies and
agents opens it too) and `components/ContractDialog.tsx`.

## Routes (each has its roleGate line, pinned in roleGate.test.ts)

```
GET   /api/hotels/:code/company-records         companies, each with its contract here today   company: view
POST  /api/hotels/:code/companies               add (reception without credit)                 company: create
PATCH /api/hotels/:code/companies/:id           edit                                           company: edit
GET   /api/hotels/:code/companies/:id/contracts a company, its contracts here, the grid's lists company: view
POST  /api/hotels/:code/contracts               add a contract                                 company: edit
PUT   /api/hotels/:code/contracts/:id           change one (bookings keep their stamped rate)  company: edit
GET   /api/hotels/:code/contract-price          the booking page's quote under the contract    as /tariff
```

## Where it reaches other services (their lines, claimed for this job)

- **reservations**: `book.ts` asks `app.contract_in_force` for a booking
  naming a company, prices a line with no typed rate by `app.contract_price`,
  and stamps `contract_id` and the contract's commission.
  `BookingPage.tsx` quotes through `/contract-price` when a company is named
  and shows "Contract: <name>".
- **finance**: `postings.ts` refuses Bill to company for a company not
  allowed credit.
- **guests**: the Add company button on Companies and agents.

## Rules that bind it

- **A rate is stamped onto the booking, never looked up later** (`agreed_rate`,
  `commission_pct`, `contract_id`): changing a contract changes only the next
  booking.
- **No default prices.** A figure not agreed is NULL and reads as a dash; the
  database refuses a contract price or a credit figure of 0.
- **A day use is never priced by a contract** (D27-229: its price is typed
  every time). The booking page does not ask `/contract-price` for it, and
  `book.ts` refuses an untyped day use before the pricing branch; the booking
  is still stamped with the contract and its commission.
- **Contract rates are before GST** (D27-233). "Rate includes GST" applies to
  a typed rate and the list price only: on a line the contract prices, the
  page greys it ("Contract rates are before GST") and `book.ts` ignores it
  (`from_contract`), so a contract rate is never split. Where the contract has
  no figure (C-4) the line carries the list price, and the tick applies.
- **One contract in force per company, hotel and date** (`contracts_one_in_force`).
- Reach other services only through their `index.ts`.

## Gates

`npx tsc -b --force`; `npx vitest run src/modules/contracts
src/modules/reservations/contractPrice.test.tsx`; `cd api && npm test --
contracts roleGate`; `bash db/tests/run.sh`.

## Requests from other services

None.
