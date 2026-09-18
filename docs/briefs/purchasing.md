# Purchasing — the brief

**Read `docs/briefs/README.md` first** (the rules every lane shares), then this,
then `src/modules/purchasing/MODULE.md`. Your decisions are **D18-1 to D18-4**
in `docs/briefs/decisions-2026-09-18.md`, and the shape of the whole thing is
`docs/BUILD-PLAN-2026-09-18.md` § 1.

---

## What this service is

**A purchase request becomes an approved order becomes goods arriving in a
store.** Nothing here invents a new way to do any of that: the parts exist and
have been live since 17 September.

- **Suppliers and stores** — `locations` and `suppliers`, with the Places and
  suppliers screen (`/h/:code/places`).
- **The approvals engine** — migration 076, and the one approvals inbox a GM
  already uses for stock adjustments, equipment and cash expenses. Its
  `purchase` kind is already defined and is **not wired to anything**. That is
  your job.
- **Stock arriving** — the Store's receipt, per store since migration 112. A
  delivery is a receipt with an order behind it.

**You own** `src/modules/purchasing/` and `api/src/modules/purchasing/`, and
`db/tests/modules/purchasing.sql`. Everything else belongs to somebody.

---

## The first version, and nothing more

The owner's rule for all of this work: **the smallest thing that works end to
end.** A purchase that can be raised, approved, ordered and received is worth
more than nine screens nobody has used.

1. **Raise a request** — what, how many, which store it is for, and why.
   - **Who may is a SETTING, per property** (D18-2). Default: the **Inventory
     Manager, the GM, the owner and an administrator**. The owner can switch on
     department heads (kitchen manager, housekeeping) at any time, on the
     Settings screen, **without a deploy**. Build the setting first; it is the
     one thing here that is not obvious later.
2. **The GM approves** (D18-4) — in the approvals inbox that exists, through the
   engine that exists. Nobody approves their own request (076 already refuses
   it). No owner limit: the GM approves every purchase, whatever the amount.
3. **An order to a supplier** — a **PDF in the group's layout** (D18-3): the
   supplier, the items, the agreed prices, where to deliver, and the order's own
   reference. **Sent by hand** — printed, or attached to a WhatsApp by whoever
   orders. Nothing in this service waits on n8n.
   - The PDF is made by the shared renderer, `api/src/reportRender.ts`. **Do not
     write a second one.** Ask the master if the document shape it takes does
     not fit an order.
4. **Delivery** — the store keeper receives against the order: what was ordered,
   what actually came, and what it cost. **They may differ, and both stay on the
   record.** Stock lands as a receipt in the Store, in the store it was ordered
   for.

**No price is invented, anywhere** (the owner's oldest rule). An item with no
agreed price shows **"-"**, never 0, and an order with an unpriced line cannot
be sent until somebody prices it.

## Not in the first version

Say so on screen where a person would look for them, rather than pretending:

- **Supplier bills and payments** — that is finance's, and it waits on the
  owner (S10 in `docs/STOCK-AND-EQUIPMENT-PLAN.md`).
- Part deliveries against one order, rate contracts per supplier, reorder
  levels that raise a request by themselves.

---

## Where to start

1. `npm run claim -- purchasing "…"` (the master has claimed it for you; check
   `npm run claims`).
2. Read `docs/STOCK-AND-EQUIPMENT-PLAN.md` § 2C — the phase this is — and the
   approvals engine in migration 076 and `api/src/routes/approvals.ts`.
3. **The setting first** (D18-2), then the request, then the approval, then the
   order, then the delivery. Each one end to end before the next.

## What will break other chats if you touch it

- `api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
  `src/components/app/navigation.ts`, anything in `src/components/ui/` —
  **the master's**. Ask; do not edit.
- `src/modules/stores/`, `src/modules/equipment/`, `src/modules/finance/` —
  other services. A delivery lands in the Store **through its front door**
  (`api/src/modules/stores/index.ts`), not by writing its tables.
- **Migrations**: ask the master for your number before you write one. Never
  take the next free number yourself — four chats did that on 17 September and
  the master renumbered all four.

## The gates

Every gate now runs **in GitHub, on Linux, on every push**
(`.github/workflows/ci.yml`): lint, both type checks, strip-check, the website
suite, the API suite, the database suite, the replay, the build and the lane
check. **A push that touches another service's folder is refused by the hook
before it leaves your machine.**

Run these locally to find out fast; the Action is the proof:

```powershell
npx tsc -b --force
npx vitest run
cd api; npm test
bash db/tests/run.sh
npm run build
```

**A guard is not a guard until it has refused something.** Break each one you
write, watch it fail, put it back, and say so in your CHANGELOG.

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md` and `MODULE.md`; `npm run lane -- purchasing`;
`npm run release -- purchasing`. **You do not merge and you do not deploy** —
commit on your branch and tell the master, with your gate numbers.
