# Laundry

One place for everything that goes to the laundry — a guest's bag and the
hotel's own linen — behind a per-hotel switch (D17-54). Run by reception and
housekeeping (D18-8); no new roles.

**Where it stands, 18 September: the database and the server are built and
proved. There is no screen yet**, and the menu still shows the Coming soon
page, because two of the master's files have to change before a screen can be
reached at all (see **Requests** below). The brief is `docs/briefs/laundry.md`;
the decisions are **D17-54**, **D18-5**, **D18-7**, **D18-8**.

```
src/modules/laundry/            the Coming soon page still — no working screens yet
api/src/modules/laundry/        BUILT: laundry.ts, mounted on this service's own front door
db/migrations/118_laundry…      BUILT: the price list, the dockets, the guards
db/tests/modules/laundry.sql    BUILT: 29 assertions
api/test/modules/laundry/       BUILT: 23 tests
```

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
| Laundry | `/coming-soon/laundry` | `pages/Laundry.tsx` | owner, admin, GM — still the Coming soon section |

**This table is what is true today, not what is planned.** The working screens
(a price list, a docket list split into the guests' bags and the hotel's linen,
and one docket) are written the moment the two requests below are answered.

---

## Not in the first version

Say so on screen where a person would look, when the screens exist: linen par
levels per room type, an outside laundry's bills, express surcharges, and a
guest sending a bag from their own page (that arrives with the guest's door —
the master says when it can carry a request).

---

## Requests — what this service needs from the master

Three, in the order they block. Each is in a file this lane may not touch.

### 1 · A menu section, so a screen can be reached at all

`src/components/app/navigation.ts` — `SectionKey` and `SECTION_LAYOUT`.

```ts
export type SectionKey = … | "laundry" | …
{ key: "laundry", label: "Laundry", module: "laundry" },
```

**Why it cannot be worked around.** `RequireAccess` asks `mayReach(role, path)`,
which reads the navigation — so a route whose section does not exist is refused
to everybody, and a nav entry in an existing section would show at properties
that have laundry switched off. The `module` key is the only per-section gate
there is. **The spa chat needs the identical change**, which is why it is one
request to the master and not two edits.

### 2 · A permission resource

`src/lib/permissions.ts` — `RESOURCES`, `RESOURCE_LABELS`, and the grants.

```
"laundry"  ·  label "Laundry"
granted to: owner, admin, gm, hotel_manager, front_desk, housekeeping
```

**D18-8 already answers who** — "reception and housekeeping, no new staff
roles" — so this is the owner's decision written down, not a new one. No
existing resource fits: the only ones both reception and housekeeping hold are
`reservation`, `inventory`, `report` and `notification`, and putting laundry
behind any of them would hand it to roles the owner did not name.

### 3 · A way to post a charge, on finance's front door

`api/src/modules/finance/index.ts` exports its routers and nothing else, so
there is **no function** to call.

```ts
export async function postCharge(client, {
  hotelId, stayId, category, description, amount, taxable, businessDate,
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }>
```

That is exactly what `POST /:code/stays/:id/charges` already does between
reading the body and answering (`api/src/modules/finance/postings.ts`) — the
same closed-folio and cancelled-booking refusals, the same `app.gst_rate(hotel,
'room', amount)`, the same append-only insert.

**Why this lane will not do it another way.** D18-7 says the charge goes
straight onto the room bill as its own line, and the Extra Charges report
already reads `category = 'laundry'`
(`api/src/modules/reports/builders/manager.ts`, `EXTRA_KINDS`). Writing
`folio_postings` from this service would put a second author on finance's
ledger; calling its own HTTP endpoint from inside the server is a way around a
front door, not a use of one. Until the function exists,
`POST …/dockets/:id/charge` makes every refusal that is this service's own —
the hotel's linen, a cancelled docket, one already charged, one with anything
unpriced in it — and then says plainly that the connection is not there.

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
