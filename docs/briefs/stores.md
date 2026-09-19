# Store — your brief (phase 1A, then 2A)

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


> **17 September, the owner:** after stock per place, go **straight on to phase 2A,
> crockery and cutlery** (D17-69): breakage with who and where, in use per outlet,
> par per outlet, the monthly count. **Clean the long dash from your folder** as part
> of your next job (D17-59, D17-60 — see the README). Purchasing starts only after
> your stock per place is merged (D17-67).

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

**Then read `docs/STOCK-AND-EQUIPMENT-PLAN.md`** — the owner approved it on
16 September, all eleven decisions and the table of who may do what. You are
**phase 1A**. An equipment chat runs **1B** at the same time, in its own folder.

---

## What you own

```
src/modules/stores/          the Store screen, its data, its tests
api/src/modules/stores/      your routes on the server
api/test/modules/stores/     your server tests (create it)
db/tests/modules/stores.sql  your database checks (create it)
db/migrations/               ONLY the new files this plan needs — see "Migrations"
```

Your screen: **Store** (`/h/:code/stores`), now in the menu section **Store and
equipment**. Read `src/modules/stores/MODULE.md`, then `DEFECTS.md` — the ten
entries you measured are your first work.

---

## What changed under you on 16 September — read before your first write

Merge it first (`git merge cp6` in your copy). Phase 0, built by the master:

- **Stock has its own permission, `stock`.** It used to share `inventory` with
  room availability, which is how reception and the Viewer could change stock.
  Who holds what is `src/lib/permissions.ts`, pinned by
  `src/lib/permissions.test.ts`, and set out in plain words in plan § 6.
  **You read those grants. You never change them** — a change is the owner's,
  made by the master.
- **Suppliers and locations exist** (migration 094, tables `suppliers` and
  `locations`, with `kind` store · kitchen · bar · restaurant · public_area ·
  office · other). **Use them. Never make your own copy.** Purchasing and
  Equipment use the same two.
- **The menu:** "Inventory" reads **Rooms and rates**; the Store sits in **Store
  and equipment**. Your `nav.ts` already says `resource: "stock"`.

- **Your users' role is now called Inventory Manager** (key `stores`
  unchanged, 16 September, S13): the same person looks after stock and
  equipment, and approves equipment leaving the store — that approval is the
  equipment chat's and the master's, not yours. **Stock going out needs no
  approval (S12); do not add one.**
- **STO-4 — the owner answered YES (16 September):** the store keeper sees who
  moved stock. Use `app.colleague_name(<staff id>, <hotel id>)` (migration 096):
  it gives the name of someone rostered at that property, and nothing else.
  Show it to the **Inventory Manager** (and whoever sees names already — the GM,
  the owner); anybody else keeps today's view unless the owner says more.
- **Your refusal sentences say "the store manager"** — the role is the
  **Inventory Manager** now. Change the words, not the key.

**One word, two meanings, still:** `inventory` is rooms and prices. You are the
Store, and stock. Never call stock "inventory" on a screen, a route, a table or a
commit.

---

## Your work, in this order

### 1 · STO-1 first — it is still open

**Phase 0 did not close it.** Opened as reception afterwards, `/h/5EL/stores`
still loaded: the route has no guard, and no server route asks the role.

**Done when all three hold:**

1. **The page.** `routes.tsx` wraps the Store in
   `<RequireAccess path="/h/:code/stores" resource="stock">`, the way
   `src/modules/inventory/routes.tsx` guards Pricing.
2. **The server.** Every store route refuses a role without the grant it needs
   — reading needs `view`, adding and receiving and issuing need `create`, an
   undo or a correction needs `edit`, an export needs `export` — with a 403 and a
   sentence naming who may do it. Copy the pattern of
   `api/src/modules/inventory/rateSetters.ts`: the server cannot import the
   website, so it holds a copy of the role lists, and a test fails the moment the
   copy and `grantsFor(role, "stock")` differ. **If a route does not fit one of
   the four clearly, ask the owner which** — do not pick.
3. **The proof.** A server test that tries every write as **every role a person
   can be given**, and shows the refused ones leave nothing behind. A file that
   only proves the GM can write passes with no guard at all.

Then open the Store as `dev-desk` (reception) and as a Viewer in your own
database, and see it refused. That is the evidence, not the test count.

### 2 · STO-2 to STO-10

The owner approved fixing them as the first part of 1A. **Where a defect entry
leaves more than one way to fix it, bring the owner the choice with your
recommendation before building.** STO-9 (the dialog Close button and box sizes)
is in `src/components/ui/`, the shared kit — write it as a request to the master
in `MODULE.md`; do not edit the kit.

### 3 · Stock held per location

- On hand **per location**, still summed from movements, never a column.
- **A transfer** (main store → kitchen) is two movements that cannot exist apart.
- **The stock already recorded has no location.** Where it goes (the
  recommendation is the Main store) is **the owner's call — ask before the
  migration moves anything.**
- **S3 approved three places to start: Main store, kitchen store, bar store.**
  Whether they are created for every property by the migration, or added by a
  manager on a screen, is **a question for the owner**, with your recommendation.

### 4 · Par levels per location

A minimum for an item at a place, and the list of what is below it. **No level is
invented** — an item with none set shows a dash, and is never "below".

### 5 · The count sheet

Print or fill a count per location; compare with on hand; **one adjustment
movement per difference**, with who counted and when. Nothing is edited.

### 6 · Gas by cylinder (S5)

Full and empty cylinders counted, received and returned. **How a cylinder is
priced — a refill, a deposit — ask the owner.** No figure until they say.

**Not yours in 1A:** crockery and cutlery (phase 2A, yours later), purchase
requests (2C, `purchasing`), recipes (S9, later), supplier payments (S10, Tally).

---

## Migrations

You will need at least one. **The number is the next after the highest on cp6
when you write the file** — 097 now: the master took 095 and 096 for
approvals and names. The equipment chat
may take the same number; **that is expected** — the master renumbers whichever
merges second. So:

- Refer to your migration by what it does, never by its number, in test names
  and comments. A renumbering then touches one filename.
- **Never edit 046, 069 or 094.** A change to them is a new file.
- `revoke delete on <table> from pms_app;` for every new table — migration 010's
  default privileges grant DELETE on anything new, and stock is a ledger.
- Your database: `DB=fidato_stores ./db/migrate.sh` (Git Bash, in your copy)
  after every merge of cp6.

---

## What your service stands on

Migrations **046**, **069** (the ledger — read both before any route) and
**094** (suppliers, locations).

**An item has no price. A delivery has a price.** Weighted average cost (S4)
comes from the receipts. An item nobody has received is worth **a dash, never a
zero** — the project's oldest rule.

---

## Yours to touch, and nothing else

**Yes:** everything under your folders above, and your own new migration files.

**No — these break other chats:**

- `src/modules/equipment/`, `api/src/modules/equipment/` — **the equipment chat,
  running now.** It uses `locations` too; you never change that table.
- `src/modules/purchasing/`, `src/modules/room-systems/` — not built.
- `src/modules/inventory/` — the other meaning of the word.
- `src/modules/housekeeping/` — your users use theirs; its front door only.
- `src/lib/permissions.ts` and its test — the owner's table, the master's file.
- `src/components/app/navigation.ts` and `navigation.test.ts` — the menu is
  pinned per role (`menu("stores")` is `Store, Notifications`). A change to what a
  role's menu shows is a question for the owner, made by the master.
- `src/components/ui/`, `src/lib/`, `api/src/server.ts` — shared.

---

## Start here

1. In **your existing copy** `D:\fidato-stores`: commit or stash nothing
   half-done, then `git merge cp6`. Then `DB=fidato_stores ./db/migrate.sh`.
2. A new branch for the phase: `git switch -c stores/phase-1a`.
3. Your claim is still on `stores/measure-375`, so re-take it:
   `npm run release -- stores`, then
   `npm run claim -- stores "Phase 1A: STO-1 first, then STO-2..10, stock per location"`.
4. Read the plan, `MODULE.md`, `DEFECTS.md`.
5. **STO-1**, as above, with the proof. Tell the owner when it is closed.
6. Before every commit: `npm run lane -- stores`, and every gate in the README.
7. When you stop: your `CHANGELOG.md`, `DEFECTS.md` moved to Fixed, release the
   claim, and tell the master the branch name — the master merges.
