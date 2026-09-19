# Spa

Treatments, a day diary, and a bill settled at the spa or put on the room —
behind a per-hotel switch (D17-54).

**BUILT, 19 September, EXCEPT CLOSING A TREATMENT.** A treatment is entered,
priced, booked by the desk and cancelled, all on screen. It is **not yet
settled at the spa or charged to the room** — that route does not exist on the
server, and nothing here pretends it does (see the requests at the foot).

```
db/migrations/119_the_spa.sql      the tables and the guards
db/tests/modules/spa.sql           30 assertions
api/src/modules/spa/spa.ts         the routes, mounted through this service's own door
api/test/modules/spa/spa.test.ts   18 tests
src/modules/spa/data/spa.ts        the typed client, and the property's clock
src/modules/spa/pages/SpaDiary.tsx the day diary, the booking, the cancellation
src/modules/spa/pages/SpaSetup.tsx treatments and therapists
src/modules/spa/spa.test.tsx       14 tests
```

Before any edit: claim the service (`npm run claim -- spa "what"`), and read
`docs/briefs/spa.md`.

---

## What it is

**The owner's D18-6:** a guest books the spa from their own page or by telephone
to the desk, and either settles at the spa or has it charged to the room.
**D18-8:** run by reception; no therapist logins and no new staff roles.

**Run by** reception, who book and close; **housekeeping sees the diary and
cannot touch it** (the owner, 18 September, asked because D18-8 says "reception
and housekeeping" for laundry and spa together while this service's brief says
reception). Owner, administrator and GM as always; the GM, an administrator or
the owner set the price list.

---

## The model, and why it is shaped this way

The long form is the header of `db/migrations/119_the_spa.sql`. In short:

| | |
|---|---|
| **`spa_treatments`** | name, **how long**, price. **No treatment is shipped**, and `price` is NULL until somebody types one — a dash, never a zero. |
| **`spa_therapists`** | **a name, not an account** (D18-8). A list rather than a text box, because the guard is "this person is already busy" and that cannot be asked of a string somebody typed two ways. |
| **`spa_appointments`** | who, which treatment, which therapist, what time. A time **range**, not a date. Against a stay, always. |

Four things the schema insists on:

1. **One therapist is not in two places at once** — an exclusion constraint,
   and `app.book_spa_appointment` **names** the appointment in the way rather
   than letting Postgres answer "conflicting key value violates exclusion
   constraint", which is true and useless on a telephone.
2. **The length comes from the treatment, not the caller.** A caller that could
   say when it ends could book ninety minutes into a thirty-minute slot.
3. **A booking holds the therapist from the moment it is taken** — unlike the
   hall in 060, which holds only on `confirmed`, because a hall has enquiries
   and a telephone booking is the booking. A cancellation releases the hour; a
   treatment already given does not, because it occupied it.
4. **Every appointment is against a stay** (`reservation_id` NOT NULL). A
   walk-in who is not staying is a bill with no stay behind it, and the brief
   excludes it until the owner is asked — so the schema cannot express one.

**A time belongs to the property** (113, root MEMORY 297). Written through
`app.hotel_moment`, read through `app.hotel_clock`. Both test files set their
session to UTC on purpose, so a bare timestamp fails on this laptop rather than
in Akkalkot.

**The spa bills under its own GST rule** (the owner, 18 September) — `spa` is
its own `tax_rules.kind`, set per property. A property that has not set it
**cannot bill a treatment**: `app.gst_rate` raises rather than falling back,
which is the no-default-prices rule applied to tax.

---

## The routes

All under the module gate — `app.module_enabled(hotel, 'spa')`, refused
independently of the menu, because a hidden entry is still a URL anybody can
type.

```
GET    /api/hotels/:code/spa                          the diary (from, to)
GET    /api/hotels/:code/spa/treatments               the price list
POST   /api/hotels/:code/spa/treatments               add one
PATCH  /api/hotels/:code/spa/treatments/:id           change or retire one
GET    /api/hotels/:code/spa/therapists
POST   /api/hotels/:code/spa/therapists
PATCH  /api/hotels/:code/spa/therapists/:id
POST   /api/hotels/:code/spa/appointments             take a booking
POST   /api/hotels/:code/spa/appointments/:id/cancel  with a reason
```

**403 is "you may not"; 409 is "that cannot be done."** The two are kept apart
all the way to the status line, so a screen can tell "ask your manager" from
"that hour is taken". The first version of `spa.ts` conflated them and its own
test caught it.

---

## Screens

| Menu name | Address | Page file | Who sees it |
|---|---|---|---|
| Diary | `/h/:code/spa` | `pages/SpaDiary.tsx` | owner, admin, GM, hotel manager, reception, housekeeping |
| Treatments and therapists | `/h/:code/spa/setup` | `pages/SpaSetup.tsx` | owner, admin, GM |

Both sit in the `spa` section, which carries `module: "spa"` — the whole
service is **absent** at a property that has not switched it on, not greyed out
with a reason nobody can act on. That is the tidy half only: every route asks
`app.module_enabled` of its own, because a hidden entry is still a URL anybody
can type.

`canSee` on each entry reads `SEES_THE_DIARY` and `SETS_THE_LIST` in
`data/spa.ts` — the menu's copy of the server's own three lists, **not**
`canAccess(role, "spa")`. The shared matrix is wider than the server here;
that is **SPA-2** in `DEFECTS.md`.

**A time on these screens is never parsed.** `app.hotel_clock` writes
`YYYY-MM-DDTHH:MM` with no offset, so `format.ts`'s `dateShort()` and
`timeOnly()` — which build a `Date` first — would read the property's day in
whatever zone the browser happens to be in. `clockTime`, `clockDate` and
`shiftDay` in `data/spa.ts` work on the string; the test file runs in
`TZ=America/New_York` to prove it.

---

## Requests — the master's, raised 18 September

1. ~~**A migration number.**~~ **Answered: 119**, settled at the merge on 19
   September. `116` was taken from cp6 to run the gates; it is the
   master's to confirm or renumber. Purchasing and laundry are numbering in the
   same window.
2. ~~**A `spa` section in `navigation.ts`**~~ **Answered:** the master wrote it
   on 18 September, gated `module: "spa"`. The screens use it.
3. ~~**A front door for posting a charge.**~~ **Answered:** `postCharge` is
   exported from `api/src/modules/finance/index.ts` since 18 September. **It is
   not called yet** — see 5.
4. **Which existing door records money taken AT the spa** — the brief says ask
   before inventing a second way of taking a payment. Still unanswered.
5. **A ROUTE FOR CLOSING A TREATMENT.** Raised 19 September by the chat that
   built the screens. `api/src/modules/spa/spa.ts` has nine routes and none of
   them closes an appointment: nothing writes `settlement`, `closed_by`,
   `closed_at` or `posting_id`, and nothing calls `postCharge`. So D18-6's
   second half — settled at the spa, or charged to the room — **has no door to
   knock on**, and no button was drawn for it: a button that answers 404 is
   worse on a live desk than no button at all. The diary already SHOWS a
   settlement where the database has one.

   What it needs, all of it already decided: `POST
   /:code/spa/appointments/:id/close` taking `{ settlement: "room" | "spa" }`,
   in `SPA_BOOK_ROLES`; refusing an appointment whose `agreed_amount` is null
   (the migration's own rule — an unpriced treatment cannot be closed);
   `postCharge` with `taxKind: "spa"` and `category: "Spa"` for the room, whose
   refusal already names Settings → Tax (D18-21); and question 4's answer for
   the money taken at the spa. Server work, and the screens' lane could not
   touch it.

---

## Requests from other services

None yet.
