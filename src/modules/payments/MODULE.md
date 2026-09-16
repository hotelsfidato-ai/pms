# Online payments

Taking money from guests by card and UPI through a payment gateway.

**NOT BUILT. A Coming soon page only.** **Parked by the owner on 8 September** — its page says so. The owner chose on
16 September to give every service the system does not have a Coming soon
page, in one section at the foot of the menu for the owner, admins and
general managers. This folder holds this brief, an empty front door
(`index.ts`), its own `CHANGELOG.md` and `DEFECTS.md`, and the page with
its menu entry and address — no working feature, no server code.

**Folder name:** `payments` — the word the other two places will use if it
is ever built:

```
src/modules/payments/          this brief, and the Coming soon page (menu entry, address)
api/src/modules/payments/      does not exist
db/tests/modules/payments.sql  does not exist
```

---

## What it would be

Today the system **records** money that has already changed hands — cash,
card or UPI taken at the desk or the till, written against a bill. It never
**takes** money. A payment gateway would let a guest pay a deposit to hold a
room, pay from a link, have a card held against a no-show, or be refunded
(`PROGRESS.md`, "What a market-leading HMS has that this does not", item 3,
which names Razorpay, PayU, CCAvenue and UPI links as the Indian options —
domain knowledge, not a decision).

---

## Status, and where it comes from

- **Excluded by the owner, 8 September.** `PENDING.md` § 3: "Payment gateway
  — excluded for now. Said plainly by the owner on 8 September." CHANGELOG
  2026-09-08 "Three gates aimed at an act…", "Decided by the owner":
  "Channel manager and payment gateway: excluded for now". `HANDOVER.md` § 4:
  "channel manager and payment gateway excluded".
- `docs/SERVICE-FOLDERS-PLAN.md`: "Online payments | `payments` | parked by
  the owner".

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Online payments | `/coming-soon/payments` | `pages/Payments.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "payment gateway", "razorpay", "upi link", "deposit", "refund". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. The owner's go-ahead. Online payments were parked by the owner on 8 September.
2. The payment gateway (Razorpay, PayU and CCAvenue are the usual choices in India) and its merchant account.
3. The account keys, kept in the server's settings, never on a screen or in a message.

---

## What it would lean on

- **finance** — where money is recorded today: payments against a folio, the
  cashier's drawer, receipts and refunds.
- **reservations** — a deposit taken at booking lands on the booking's bill,
  which opens when the booking is made (root MEMORY 144).
- **pos** — card and UPI are already tenders at the till's settle.
- **guest-messaging** — a payment link has to reach the guest somehow.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Keys and secrets live in the server's environment** (`api/.env`), never in
  the repo, a screen or a chat (`HANDOVER.md` § 5).
- **Money is never taken offline.** `src/lib/offline.ts` refuses a payment and
  a cash, card or UPI settlement with the line down, because a drawer is
  counted against what the server knows.
- **The ledger is append-only** — a wrong posting is reversed by its own row,
  never edited (root MEMORY 15, 24).
- **Never invent a figure; a missing one is a dash** (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b` and `npx vitest run` — `src/test/boundaries.test.ts` fails if
this folder loses its `index.ts` or this `MODULE.md`.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
