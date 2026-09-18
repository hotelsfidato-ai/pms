# Laundry — the brief

**Read `docs/briefs/README.md` first**, then this, then
`src/modules/laundry/MODULE.md`. Your decisions are **D18-5, D18-7, D18-8** in
`docs/briefs/decisions-2026-09-18.md` and **D17-54** in the file before it. The
whole plan is `docs/BUILD-PLAN-2026-09-18.md` § 2; how the chats run together is
`docs/PARALLEL-PLAN-2026-09-18.md`.

**You own** `src/modules/laundry/`, `api/src/modules/laundry/` (its front door
is made and mounted, empty — add your routers to it; **never touch
`server.ts`**), and `db/tests/modules/laundry.sql`.

---

## What this service is

**One place for everything that goes to the laundry** — a guest's bag and the
hotel's own linen — behind a **per-hotel switch** (D17-54): it shows only where
it is switched on. Run by **reception and housekeeping** (D18-8); no new roles.

## The first version, and nothing more

The owner's rule: **the smallest thing that works end to end.**

1. **The switch is made** - the master wrote it (migration 115), so that you
   and the chat beside you never rewrite the same constraint. `laundry` is a
   module name; ask `app.module_enabled(hotel, 'laundry')` before every route
   answers, and hide the screens where it is off. It is on the Settings
   screen already. **Do not touch `hotel_modules_known`.**
2. **A price list per property** — item by item (shirt, trousers, saree…), by
   service (wash, press, dry-clean). **No default prices**: an item nobody has
   priced shows **"-"**, never 0, and cannot be charged until it is.
3. **A docket** — what is in the bag, when it was collected, when it came back.
   **Every docket says whose it is: a guest's, or the hotel's own** (D18-5).
   That is a required field, not a tag: a hotel docket is never charged, and a
   guest docket always names the stay.
4. **A guest's docket charges to the room** as its own line on the bill
   (D18-7), through **finance's / front desk's front door** for posting a
   charge — **not** by writing `folio_postings` yourself, and **not** through
   the restaurant till. The Extra Charges report already has a "Laundry" row;
   your charges must land in it.
5. **The hotel's linen** — the same docket, marked the hotel's: what went out,
   what came back, what is still out. Counts only.

## Not in the first version

Say so on screen where a person would look: linen par levels per room type, an
outside laundry's bills, express surcharges, a guest sending a bag from their
own page (that arrives with the guest's page — the master will tell you when
its door can take a request).

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
`src/components/app/navigation.ts`, `src/components/ui/` — **the master's**.
`src/modules/spa/` is another chat's, running beside you. A charge reaches a
bill **through a front door**; if the door you need does not exist, tell the
master what you need and why — do not write another service's tables.

## The gates

They run **in GitHub on every push** (`.github/workflows/ci.yml`), and a push
outside your lane is refused by the hook. Locally, to find out fast:

```powershell
npx tsc -b --force
npx vitest run src/modules/laundry src/test
cd api; npm test -- modules/laundry
bash db/tests/run.sh
```

**One full suite at a time on this machine** — four chats share it. Let the
Action run the whole thing. **A guard is not a guard until it has refused
something**: break each one, watch it fail, put it back, say so.

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- laundry`;
`npm run release -- laundry`. **You do not merge and you do not deploy.** Commit
on your branch, push, and send the master the head commit with your gate
numbers and the guards you saw fail.
