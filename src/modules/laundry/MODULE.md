# Laundry

One place for everything that goes to the laundry — a guest's bag and the
hotel's own linen — behind a per-hotel switch (D17-54). Run by reception and
housekeeping (D18-8); no new roles.

**Where it stands, 19 September: the screens are built.** The menu section and
the permission resource the master was asked for both landed, so the three
screens were written against the server that was already there. The Coming
soon page is gone. The brief is `docs/briefs/laundry.md`; the decisions are
**D17-54**, **D18-5**, **D18-7**, **D18-8**.

```
src/modules/laundry/            BUILT: data/laundry.ts and three screens
api/src/modules/laundry/        BUILT: laundry.ts, mounted on this service's own front door
db/migrations/118_laundry…      BUILT: the price list, the dockets, the guards
db/tests/modules/laundry.sql    BUILT: 29 assertions
api/test/modules/laundry/       BUILT: 23 tests
src/modules/laundry/laundry.test.tsx   BUILT: 8 screen tests
```

**One thing a guest's bag still cannot do: reach the bill.** `postCharge` is
on finance's door now (the master opened it on 18 September), but this
service's `POST …/dockets/:id/charge` has not been changed to call it — it
makes every refusal that is its own and then says plainly that the connection
is not there. The button is on the screen, it goes through the API, and what
the API says is what the screen says. See **Requests** below.

**Migration 118**, settled at the merge on 19 September. It was written as 116
in this service's own copy, and so was the spa's — three chats reached for the
same number in one hour because none had been given one (MEMORY 301). Numbers
are settled in merge order now, never reserved ahead: a reserved number is a
gap, and `src/test/migrationNumbers.test.ts` refuses gaps (MEMORY 302).

---

## What is built

### The switch (D17-54)

The master wrote it (migration 115), so this chat and the spa chat never
rewrote one constraint in two files — MEMORY 284, 293 and 299. It is on the
Settings screen already. Every route asks
`app.module_enabled(hotel, 'laundry')` before it answers and refuses with a
reason where it is off, **independently of any screen hiding it**: a hidden
menu entry is still a URL anybody can type.

### The price list — and nothing on it is priced

A row per **(item, service)** — Shirt / wash, Saree / dry-clean — so a property
that presses shirts and does not dry-clean them has no blank line to explain.
`price` is **NULL until somebody sets it**: a dash on screen, never a zero, and
a docket carrying it cannot be charged. `0` is allowed and means something
different — somebody decided it is free, which is a decision and is recorded as
one.

### The docket — and it always says whose it is (D18-5)

`belongs_to` is a **NOT NULL column**, not a tag: `guest` or `hotel`. A guest's
docket names the stay and cannot exist without one; the hotel's own names none
and **can never carry a charge** — the table refuses it, not the screen.

What is in the bag has its **description, service and price copied at
collection**. Renaming an item or re-pricing it next month does not rewrite a
docket somebody was handed, and cannot move a bill that has been posted.

### What came back (the hotel's linen, and a guest's bag, on one mechanism)

Each line carries `quantity` and `returned_quantity`. What is still out is the
difference. Nothing comes back that never went out, and a docket becomes
`returned` when nothing is still out — **worked out, never typed**.

### The total

`app.laundry_docket_total` is **NULL when the bag is empty or ANY line is
unpriced** — the banquet's rule, for the same reason: a part-total looks like a
total. A trigger refuses to attach a charge to a docket with no total, so the
rule cannot be gone around by a route that forgets to ask.

---

## Screens

| Menu name | Address | Page file | Who sees it |
|---|---|---|---|
| Dockets | `/h/:code/laundry` | `pages/Dockets.tsx` | anyone holding `laundry` — D18-8 |
| Price list | `/h/:code/laundry/price-list` | `pages/PriceList.tsx` | the same |
| (a docket) | `/h/:code/laundry/:id` | `pages/Docket.tsx` | the same |

**The whole section is absent where the property has laundry switched off** —
`module: "laundry"` sits on the section in `navigation.ts`, which is the only
place a whole service hides (D17-54). The routes are guarded by `mayReach`, and
the API refuses every one of them on its own, because a hidden menu entry is
still a URL anybody can type.

**Working menus (D22-22, 22 September; Dockets only, the owner, 24
September):** Dockets is in reception's and housekeeping's menus where the
hotel has laundry on. The GM and the hotel manager have no working menu - they
see the whole Laundry section. The Price list stays one search away, and the
Dockets page links to it.

### What each screen refuses to do

- **The price list** draws `null` as `-`. The price field is a text box that
  starts EMPTY for an unpriced item, never `0` — and `0` typed in is kept, and
  shown, because it means somebody decided it is free.
- **The dockets list** puts whose it is in its own column on every row, in
  every filter, and sorts what is still out to the top.
- **Collecting a bag** asks whose it is FIRST and with no answer filled in, and
  shows nothing else until it is answered. What goes in the bag comes off the
  price list — one catalogue, nothing typed free-hand onto a bill — and an
  unpriced item says "not priced" in the list you pick it from.
- **One docket** offers Charge to the room only when the server would take it:
  a guest's bag, not cancelled, not already on a bill, and with a total. The
  hotel's own linen gets a card saying why there is no button, rather than a
  button that answers with a refusal.

---

## Not in the first version

Said on screen where a person would look — the foot of every docket: linen par
levels per room type, an outside laundry's bills, express surcharges, and a
guest sending a bag from their own page (that arrives with the guest's door —
the master says when it can carry a request).

---

## Requests — what this service needs from the master

**Two of the three are answered.** `src/components/app/navigation.ts` has the
`laundry` section with `module: "laundry"` on it, and `src/lib/permissions.ts`
has the `laundry` resource granted as D18-8 said — reception and housekeeping,
and no new roles. The screens exist because of those two edits.

What is left is in files this lane may not touch:

### 1 · The charge still does not reach the bill — the door is open, nobody walked through it

`postCharge` is exported from `api/src/modules/finance/index.ts` (the master,
18 September). **`api/src/modules/laundry/laundry.ts` has not been changed to
call it.** Its `POST …/dockets/:id/charge` makes every refusal that is this
service's own — the hotel's linen, a cancelled docket, one already charged, one
with anything unpriced in it — and then answers:

> Charging to the room is not connected yet: finance's door does not hand out a
> way to post a charge.

That sentence was true when it was written and is not any more. The route needs
its last `refuse(...)` replaced by the call: `category: "Laundry"`, `taxKind`
left alone because laundry follows the room rule (the spa is the one service
with its own, D18-21), then `charge_posting_id` set on the docket — the
database's own `laundry_charge_needs_a_total` trigger refuses the whole thing if
anything in the bag is unpriced. **Seen on screen, 19 September**, on a priced
guest docket: the button is there, it goes through the API, and the screen shows
that sentence back.

### 2 · The Settings switch cannot turn laundry on — `LAU-3`

`api/src/modules/admin/moduleSwitches.ts`. Its `GET /:code/modules` lists six
modules including `laundry` and `spa`; its `POST /:code/modules/:module` has a
list of its own that was never widened:

```ts
if (!["pos", "banquet", "reception_pos"].includes(module)) {
  return c.json({ reason: `There is no "${module}" module.` }, 409);
}
```

So the switch draws, and refuses. `DEFECTS.md` → **LAU-3** has what was seen.

---

## What it leans on, on the screen side

- **the front desk**, over HTTP — `GET /:code/stays`, for the stays a guest's
  docket may name. Read through its own door, never by importing its data layer
  (`src/test/boundaries.test.ts` refuses that, and is right to).
- **`@/data/repositories/types`** for the `Stay` shape — the shared core, not
  another service.

---

## What it leans on

- **finance** — the charge on the folio (request 3 above).
- **front desk** — the stay a guest's docket names; read, never written.
- **reports** — the Extra Charges "Laundry" row reads `folio_postings`
  directly. Nothing here is needed for it beyond the category being right.

---

## Gates

Run in this lane's own copy, against its own database:

```powershell
npx tsc -b --force
npx vitest run src/modules/laundry src/test
cd api; npm test -- modules/laundry
bash db/tests/run.sh
```

`src/test/boundaries.test.ts` fails if this folder loses its `index.ts`, its
`MODULE.md` or its `DEFECTS.md`, or if anything here reaches past another
service's front door. `src/test/migrationNumbers.test.ts` refuses a duplicate
number **and a gap**.
