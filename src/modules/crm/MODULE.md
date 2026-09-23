# Central CRM

> **21 September — BUILT, phase 1** (`docs/briefs/crm.md`, branch
> `crm/phase-1`). Returning-guest matching, the "possible same person"
> list with undoable joins, the blacklist as a warning, "stayed with the
> group before", "do not send me offers", the WhatsApp tick, and Guest 360.
> Its home is the **Guests & CRM** menu section (D21-79).
>
> **22 September — CRM-2 and CRM-3 built** (the owner's D22-8, branch
> `crm/crm-2-crm-3`): a "Not the same person" answer on the same-person
> list, undoable; and a warning on Arrivals and at check-in when a booking
> site's guest matches a blacklisted guest.

One record for each guest across every hotel of the group. The design is
`docs/architecture/central-crm.md`; the owner's answers are D21-1 to D21-5,
D21-12, D21-13, D21-20 to D21-22, D21-27, D21-72 and D21-79 in
`docs/briefs/decisions-2026-09-21.md`, and the eleven below.

---

## The fact it stands on

`guests` has no `hotel_id` and was meant to hold a person once for the whole
group (004). **It did not**: every booking and every walk-in inserted a fresh
row with no lookup, so the same person twice was two rows, and
`guests.is_blacklisted` was set by no screen and read by no route (root
MEMORY 311). Phase 1 makes "one person" true from here on, and gives a
manager the tools to make it true of the past.

---

## The owner's answers of 21 September (this chat)

Asked with a recommendation each; every one went as recommended. **For the
master to copy into `docs/briefs/decisions-2026-09-21.md`** — numbered here
CRM-Q1 … CRM-Q11 only so they can be pointed at.

| # | Question | Answer |
|---|---|---|
| CRM-Q1 | When is a typed phone "the same" as one on file? | **The same 10-digit number**: +91 98765 43210, 098765 43210 and 9876543210 are one; anything else digit for digit; under 10 digits, or all one digit, suggests nobody |
| CRM-Q2 | What does "stayed 3 times" count? | **Checked-in visits** at any hotel; several rooms booked together once; cancelled, no-show, voided and future bookings not |
| CRM-Q3 | The group's name (no setting holds it; D21-27) | **"the group"** - "Stayed with the group 3 times" |
| CRM-Q4 | The walk-in has no phone or email | **Add both, optional; drop the name list** under Guest (it matched a shared surname, at one hotel, and still made a duplicate) |
| CRM-Q5 | Who works the "possible same person" list | **Owner, admin, GM** |
| CRM-Q6 | What a join does to details and marks | **The manager picks which record's name, phone and email stand; a blacklist or VIP on either stays on the joined guest and comes off on undo; if only one record has an ID on file, that one stands; if both, the manager picks and the other is kept for an undo** |
| CRM-Q7 | Who records "do not send me offers", and where | **The desk, with a tick on the booking form and the walk-in; owner, admin and GM also set or clear it on Guest 360** |
| CRM-Q8 | May the desk change the WhatsApp tick later | **Yes, on the stay panel, at any time** |
| CRM-Q9 | Guest 360's "spent" | **The Guests screen's own "total spend"**, moved to one place both read (`app.stay_charged`) |
| CRM-Q10 | How Guest 360 is reached | **A "Guest 360" entry that searches by name, phone or email, plus links** from the stay panel and the same-person list, for the three only |
| CRM-Q11 | A typed phone matches but the email differs from the one on file | **Suggest nothing** (doubt); on a confirmed match a blank phone or email is filled in; nothing on file is overwritten |

---

## Where it lives

The CRM crosses four services. Each part sits with the service that owns what
it touches; this folder holds the two managers' screens.

```
db/migrations/122_one_guest_one_record.sql   ONE migration; 122, given by the master (online check-in took 121)
db/migrations/128_not_the_same_person.sql    CRM-2 and CRM-3 (D22-8); written as 128, renumbered at merge
db/tests/modules/crm.sql                      what only the database can promise (14 assertions)

api/src/modules/guests/people.ts              every CRM route - see below. In GUESTS, not in
                                              api/src/modules/crm/: that folder would need a line in
                                              the master's server.ts first, and guests is mounted
api/src/modules/reservations/book.ts          a booking may use the returning guest the clerk confirmed
api/src/modules/reservations/groups.ts        ...and carries the two ticks
api/src/modules/front-desk/operations.ts      the walk-in: phone, email, the returning guest, the ticks
api/src/modules/front-desk/stayExtras.ts      the stay panel's marks and the WhatsApp tick
api/src/modules/guests/directory.ts           "total spend" now reads app.stay_charged

src/modules/crm/                              Guest 360 and "Possible same person"
src/modules/guests/components/ReturningGuest.tsx   the suggestion and the two ticks (front door)
src/modules/guests/components/BookingSiteBlacklist.tsx   CRM-3's warning (front door), placed by
                                              front desk on Arrivals.tsx and in CheckInFlow.tsx
src/modules/guests/logic/contactKeys.ts       the phone key in TypeScript, for marketing's gate
src/modules/reservations/pages/NewBooking.tsx the suggestion and the ticks on the booking form
src/modules/front-desk/flows/WalkInFlow.tsx   ...and on the walk-in
src/modules/front-desk/flows/GuestMarks.tsx   the stay panel: stayed before, the tick, Guest 360
```

## Screens

| Menu entry (section) | Address | Page file | Who (`nav.ts`) |
|---|---|---|---|
| Guest 360 (Guests & CRM) | `/crm/guests`, `/crm/guests/:id` | `pages/Guest360.tsx` | owner, admin, GM (`seesGuest360`) |
| Possible same person (Guests & CRM) | `/crm/same-person` | `pages/SamePerson.tsx` | owner, admin, GM |

Both carry `resource: "customer"`, which reception and the hotel manager hold
too, so `canSee` narrows each to the three (`access.ts`); each route's guard
asks the navigation (`RequireAccess`), and the server refuses the others
(`app.is_crm_manager()`). Reception still sees only "Guests" in the section.

## Server routes (`api/src/modules/guests/people.ts`)

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/:code/guests/returning?phone=&email=` | any staff | the suggestion: a name and a count (D21-13), and a blacklist warning with its reason on any match |
| GET | `/:code/crm/same-person` | managers | records that stand and share a phone or email, each with whether an ID is on file |
| POST | `/:code/crm/joins` | managers | `{ keptId, joinedId }` - moves the stays, carries the marks, records all of it |
| GET | `/:code/crm/joins` | managers | the joins that stand, newest first |
| POST | `/:code/crm/joins/:id/undo` | managers | exactly the stays it moved go back |
| POST | `/:code/crm/not-same` | managers | `{ aId, bId }` - two people, not one: the pair leaves the list (CRM-2) |
| GET | `/:code/crm/not-same` | managers | the answers that stand, newest first, with who and when |
| POST | `/:code/crm/not-same/:id/undo` | managers | the pair is listed again |
| GET | `/:code/guests/blacklist-warnings?from=&to=` | any staff | bookings from a booking site arriving in the dates whose guest's phone or email is a blacklisted guest's, with the reason (CRM-3) |
| GET | `/:code/crm/guests?q=` | managers | Guest 360's search |
| GET | `/:code/crm/guests/:id` | managers | Guest 360 |
| POST / DELETE | `/:code/crm/guests/:id/blacklist` | managers | set with a reason / clear |
| POST | `/:code/crm/no-offers` | managers | record "no offers" for a phone and an email |
| DELETE | `/:code/crm/no-offers/:id` | managers | clear one |
| GET | `/:code/crm/no-offers` | managers | the keys, for marketing's gate |

And in front desk (`stayExtras.ts`): `GET /:code/stays/:id/guest-marks`
(stayed before, not counting this visit; the tick) and
`POST /:code/stays/:id/whatsapp`. The booking and the walk-in take `guestId`,
`whatsappAgreed` and `noOffers`.

## Database (migration "one guest, one record")

| What | Where |
|---|---|
| the phone and email keys | `app.phone_key`, `app.email_key`; expression indexes on `guests` |
| a joined-away record | `guests.joined_into`; `app.guest_standing` follows it |
| the three managers | `app.is_crm_manager()` = `is_manager()` or the admin role. `app.guard_blacklist` now asks it - 013's refused an administrator |
| stayed N times | `app.guest_visits(guest, except)` - SECURITY DEFINER, a number only |
| the suggestion | `app.guest_suggestions(phone, email)`; `app.use_returning_guest` checks it again and fills blanks |
| joins | `guest_joins` (select for managers; written only by `app.guest_join` / `app.guest_join_undo`) |
| same person, Guest 360 | `app.same_person_pairs`, `app.guest_cards`, `app.guest_search`, `app.guest_360` - each answers nobody but the three |
| one "charged" | `app.stay_charged(reservation)` - the Guests screen and Guest 360 both |
| no offers | `offer_opt_outs` (kind, key) - read and recorded by any staff, cleared by managers; audited; `app.record_no_offers` |
| the WhatsApp tick | `reservations.whatsapp_agreed`, false unless ticked; audited by 011's trigger |
| not the same person (CRM-2) | `guest_not_same` (select for managers; written only by `app.guest_not_same` / `app.guest_not_same_undo`); `app.same_person_pairs` leaves answered pairs out, following each record to the one that stands |
| a booking site's blacklisted guest (CRM-3) | `app.booking_site_blacklist(hotel, from, to)` - INVOKER, so row security keeps it to the asker's hotel; the match is `app.guest_suggestions`' |

## Rules that bind it

- **Never automatic** (D21-2): the database suggests, a person confirms, and
  every join can be undone. **A wrong join is worse than a missed one**: in
  doubt, nothing is suggested (CRM-Q11). Nothing reads a name.
- **The desk sees a name and a count, nothing more** (D21-13).
- **The blacklist warns; it never refuses** (D21-21). That includes a booking
  site's guest on Arrivals and at check-in (D22-8): a warning, not a join and
  not a refusal.
- **Every answer on the same-person list can be taken back**: a join, and
  "not the same person" (D22-8).
- **Identity documents do not move and are never shown** - only "an ID is on
  file" (the brief, rule 1).
- **Nothing names Fidato** (D21-27): "the group", from CRM-Q3.
- **The leads app's conversations are a link, never a copy** (D21-5). It is
  not connected, so there is no link yet.

## Requests — for the master

1. **`src/components/app/navigation.test.ts`** (the master's) - I changed the
   Guests & CRM line for the GM's section to add "Guest 360" and "Possible
   same person" and asserted reception does not get them. It could not pass
   otherwise; please take it at merge or rewrite it your way.
2. **Marketing's gate** (`src/modules/marketing/logic/lists.ts`,
   `mayBeWrittenTo`) - make it refuse `refusesOffers(noOffers, guest.phone,
   guest.email)` from `@/modules/guests`, with `noOffers` read from
   `GET /api/hotels/:code/crm/no-offers` when marketing gets its data call.
   Marketing is not claimed and has no data call yet, so I did not add one
   (a data function with no caller fails `repositories.test.ts`).
3. **The decisions file** - CRM-Q1 … CRM-Q11 above.
4. **`api/src/modules/crm/`** does not exist: the routes are in guests,
   because a new server folder needs a line in `server.ts`. Move them if you
   prefer, at merge.
5. **Front desk (22 September, CRM-3)** - front desk was claimed by another
   helper (`front-desk/in-house-rule-fd8`), so its two files carry only one
   import and one placed component each: `pages/Arrivals.tsx` (above the
   list) and `flows/CheckInFlow.tsx` (top of the dialog), both
   `BookingSiteBlacklist` from `@/modules/guests`. Front desk's `MODULE.md`
   and `CHANGELOG.md` were not touched; its owner may want a line.
6. **`api/src/roleGate.ts`** - the two new writes (`POST /crm/not-same`,
   `POST /crm/not-same/:id/undo`) are mapped as `own(... app.is_crm_manager)`,
   like the joins.

## Gates

`npx tsc -b --force`, `npx vitest run`, `cd api; npm test`,
`bash db/tests/run.sh`, `bash db/tests/rerun.sh` (a migration was added). The
CRM's own tests: `api/test/modules/guests/oneGuestOneRecord.test.ts` (26),
`db/tests/modules/crm.sql` (14), `src/modules/crm/crm.test.tsx` (6),
`src/modules/front-desk/walkInReturning.test.tsx` (5),
`src/modules/front-desk/guestMarks.test.tsx` (2),
`src/modules/reservations/newBookingReturning.test.tsx` (1),
`src/modules/guests/logic/contactKeys.test.ts` (13). CRM-2 and CRM-3 (22
September): `api/test/modules/guests/notSamePersonAndBookingSites.test.ts`
(11), `db/tests/modules/crm.sql` (now 22), `src/modules/crm/crm.test.tsx`
(now 7), `src/modules/guests/bookingSiteBlacklist.test.tsx` (3).
