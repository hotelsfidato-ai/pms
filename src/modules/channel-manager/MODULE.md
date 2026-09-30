# Channel manager

The wire between this system and the booking sites (Agoda, Booking.com,
Expedia, Goibibo/MMT and the rest), through **SU** (Su channel manager): rooms
left, prices and restrictions out; bookings in.

**BUILT, NOT CONNECTED (30 September, D27-178, D27-183).** The owner chose SU
and asked for the connection on 17 September (D17-66); D22-29 held it, D27-178
lifted the hold. SU's API documents:
https://suissu.gitbook.io/su-api-documentation/su-channel-manager (the full
index is `llms.txt` beside it). Nothing is sent to SU or any booking site until
the owner has put SU's keys in the server's settings and the hotel is switched
on, and nothing goes live without the owner's yes.

**To switch it on for a hotel** (the owner's and the master's, in this order):

1. The owner gets SU's sandbox account and asks SU how its push identifies
   itself (the header), which addresses it pushes from, and registers
   `https://api.fidatohotels.com/api/channel/su/reservations` with SU.
2. On the server, in `api/.env`, by the owner: `SU_ENVIRONMENT=sandbox`,
   `SU_CLIENT_ID`, `SU_CLIENT_SECRET`, `SU_PUSH_KEY` (names only here, never
   the values). Then the nginx rate limit and SU's addresses (the master).
3. Channel manager → the SU setup (owner or administrator): the hotel's SU id
   and details, each room type's and meal plan's SU ids, *Send to SU*.
4. Booking sources: each booking site's SU code, picked from SU's list
   (Booking.com 19, Agoda 189, Expedia 9, Goibibo 105, ...).
5. The master sets `channel_hotels.run_as` (the service account) and the
   owner or an administrator switches **Channel manager** on under Settings →
   modules. Then *Send a year* of rooms left and prices.
6. SU's certification, then the live account (`SU_ENVIRONMENT=live`) - the
   owner's yes first.

```
src/modules/channel-manager/          the page, the owner's SU setup, these notes
api/src/modules/channel-manager/      the SU connection (parts 1 to 4 built)
api/test/modules/channel-manager/     its tests, against SU's documented answers
db/tests/modules/channel-manager.sql  the SU tables: ids, uniqueness, grants, audit
```

The brief is `docs/briefs/channel-manager.md` (its 17 September section wins).
Claim with `npm run claim -- channel-manager "what"`; `npm run lane --
channel-manager` before a commit. `load-demo`, `demo`, `demo-history`,
`reset`, `retire-staff` and `pos:outlet` write to this copy's own database or
refuse (CM-1, fixed 17 September: `api/scripts/scriptDatabase.ts`); each
prints where it is writing - read that line before it runs.

---

## The build, in the owner's order

| Part | What | State |
|---|---|---|
| 1 | **Token login.** SU's keys from the server's settings only; a token reused, renewed before it lapses, SU's 30 logins an hour never spent by a loop, a test key never used against the live account | **Built** 17 September, branch `channel-manager/su-connection`; audited by the master |
| 2 | **Content:** the hotel, its room types and its rate plans, sent to SU from the PMS (the record, D17-28); a mapping table per hotel | **Built** 17 September, same branch; migration 106 (the SU mapping) |
| 3 | **Rates and availability:** rooms left, prices and restrictions pushed whenever they change and on demand | **Built** 17 September, same branch; migrations 107 (what SU was last sent) and 110 (which figure went, D17-92) |
| 4 | **Reservations:** SU **pushes** each booking to the PMS (D17-79): the door, the inbox, the refusal path (D17-80) and the Channel bookings screen | **Built** 18 September; migration 109 (the inbox). **30 September (D27-183):** a new booking becomes a booking through reservations' `createChannelBooking`, a cancellation cancels it, the rest waits for a person with the reason; branch `channel-manager/su-30sep` |

The owner's rules for it (D17-43 to D17-45, D17-79 to D17-85):

- a booking for a room no longer free is **not created**; receipt is confirmed
  to SU, **0 rooms left is sent at once**, and it is listed for the GM (D17-80);
- an OTA booking follows **the OTA's cancellation policy**, a direct one the
  hotel's terms (D17-44);
- **each hotel is switched on separately**, none by default (D17-45);
- **a date with no price goes to SU closed** (D17-81);
- **a meal plan with no price of its own sells at the room type's rack rate**
  (D17-92), and what SU was last sent records that the figure was the rack rate;
- **each night's price is kept** as SU sent it (D17-82; a reservations change);
- a **card number or CVC is never kept** (D17-83);
- commission: **SU's amount, else the source's %, else "-"** (D17-84);
- the SU setup is the **owner's and an administrator's** (D17-85);
- D27-183, 30 September: **each booking site's SU code is picked on Booking
  sources** from SU's list, nothing hard-wired (Q1); **nights at different
  prices wait for the desk**, each night listed (Q2); **a change waits for a
  person** with both sides shown (Q3); **a cancellation cancels by itself**
  under the site's policy (Q4); **a request to book is answered on SU's
  extranet** (Q5); **the GM reads Channel bookings** and marks one dealt with
  (Q6); **a booking not in rupees waits for a person**, never converted (Q7).

**Stop and ask the owner** before anything that would change a price or close a
room without a person, anything about money SU collects, and the first live push.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who (`nav.ts`) |
|---|---|---|---|
| Channel manager | `/h/:code/channels` | `pages/ChannelManager.tsx` | owner, admin, GM (Distribution, `seesComingSoon`; no longer "Not built yet" from 30 Sep) |

Everybody who reaches it (the GM too, D27-183 Q6) sees **Bookings from the
booking sites** (below, 7), what the connection does, what it still needs
before it goes live, and **each booking site with the SU code picked for it**
on Booking sources, or why its bookings wait for a person.

**The owner and an administrator also see the SU setup** (`components/SuSetup.tsx`,
`data/suRoles.ts`, D17-85):

1. **SU login** - test or live account, or "Not set up" naming the settings;
   the last check; logins used this hour. *Check the login*.
2. **This hotel on SU** - the SU hotel id, postcode, country, latitude,
   longitude, a contact's first and last name, a description; beside them what
   the hotel record already holds (address, phone, email) with "-" where empty.
   *Save hotel details*.
3. **Room types** - each with its sleeps, rooms and rack rate ("-" if none); an
   SU room id, SU's room type (from SU's list), children at most, *Send to SU*;
   *Save <room type>*; the last send and what SU said.
4. **Meal plans** - each with an SU rate plan id, SU's meal plan (from SU's
   list), *Send to SU*; *Save <meal plan>*; the last send.
5. **Send to SU** - the one main action. Lists what SU still needs; disabled
   while anything is missing, while SU is not set up, or while the server uses
   the live account and the hotel is not switched on. After a send, one line per
   thing sent with what SU said.
6. **Rooms left, prices and closures** - *Send a year* and *Send what changed*,
   and the last ten pushes: when, which kind, how many dates in how many
   requests, what SU said, how many dates went closed for want of a price, and
   how many went at the rack rate. Above them, in words: how many nights are
   selling at the rack rate right now and from when, because that is a room
   selling at a figure nobody typed for that meal plan (D17-92).
7. **Bookings from the booking sites** - on the page, not in the setup, so the
   GM sees it too (Q6). Every booking SU has pushed, newest first: the guest,
   the site, the nights, the money, what became of it ("Booked", "Cancelled",
   "Refused: no room free", "Needs somebody", "Nothing to do"), why ("Booked as
   FH-5EL-...", or every reason it waits), whether SU has been told we have it,
   and whether card details were dropped. *I have dealt with this* takes one
   that needs somebody off the list; it changes nothing at SU and makes no
   booking.

Nothing on it is suggested or filled in: no SU id from a code, no SU room type
from a name, no SU meal plan from "Continental". Saving sends nothing.

---

## Server endpoints

| Method and path | What | Who |
|---|---|---|
| `GET /api/channel-manager/su` | Whether SU is set up on this server (test or live account), what is missing, the last login and this hour's count against SU's 30 | owner or admin |
| `POST /api/channel-manager/su/login` | Logs in to SU now and says whether it worked. Sends nothing to any booking site | owner or admin |
| `GET /api/hotels/:code/channel-manager/content` | The hotel, its SU details, room types and meal plans with their SU mapping, what SU still needs, SU's room type and meal plan lists, whether the hotel is switched on | owner or admin here |
| `PUT /api/hotels/:code/channel-manager/hotel` | Saves the SU hotel id and the details SU needs that the hotel record lacks. Refuses an id SU would not take, one another hotel uses, or a change once SU has the hotel | owner or admin here |
| `PUT /api/hotels/:code/channel-manager/room-types/:roomTypeId` | Saves a room type's SU room id, SU room type, children at most, and whether it goes to SU. Refuses children that fill the room, a type not on SU's list, an id used twice, a change once SU has it | owner or admin here |
| `PUT /api/hotels/:code/channel-manager/rate-plans/:mealPlan` | The same for a meal plan as an SU rate plan | owner or admin here |
| `POST /api/hotels/:code/channel-manager/content/send` | Sends the hotel, then its room types, then its rate plans to SU (below) | owner or admin here |
| `GET /api/hotels/:code/channel-manager/availability` | The last ten pushes of rooms left, prices and closures, what SU said, and how many nights SU is holding at the rack rate from tonight on (D17-92) | owner or admin here |
| `POST /api/hotels/:code/channel-manager/availability/send` | Sends a year (`all`) or only the dates that changed (`changes`) | owner or admin here |
| `GET /api/hotels/:code/channel-manager/bookings` | The last hundred bookings SU pushed, and what became of each | owner, admin or GM here (Q6) |
| `POST /api/hotels/:code/channel-manager/bookings/:id/done` | A person has dealt with one. Changes nothing at SU and makes no booking | owner, admin or GM here (Q6) |
| `POST /api/channel/su/reservations` | **SU's own door**, answering to SU's key alone. Not mounted yet: the master adds `["/api/channel", inbound]` outside the staff sign-in | SU |

**The owner and an administrator** (D17-85, 17 September), a group administrator
counting as the owner. The list lives twice, held together by a test:
`api/src/modules/channel-manager/access.ts` (SU_ROLES) for the server and
`data/suRoles.ts` (SU_SETUP_ROLES) for the screen. The `integration` grant in
`src/lib/permissions.ts` is still the owner's alone; widening it is the
master's, and asked for below.

No answer carries the client id, the secret or the token.

### Sending the content (part 2)

- **Everything is checked first.** A missing street address, city, postcode,
  country, latitude, longitude, contact name, email or phone; a phone not written
  `+` and digits; a room type going to SU with no rack rate above zero or with
  children that fill it: each is named, all at once, and nothing is sent.
- **The order SU needs:** the property (`New` the first time, then `Overlay`, the
  whole record every time, because an overlay deletes what it leaves out), then
  each room type (`Initial`, then `Modify`; `Deactivated` when taken off SU;
  `Active` then `Modify` when put back), then each rate plan (`New`, `Overlay`,
  `Remove`, `Activate`). One request per thing, so each gets its own answer.
- **SU's state moves only on an answer SU accepted** (`on_su`), so a refused
  create is created again next time. A refused property stops the send; a refused
  room type does not stop the others. A login failure, SU's limit or no answer
  stops it.
- **The live account** is used only for a hotel switched on for the channel
  manager, `app.module_enabled(hotel, 'channel_manager')`: the master's switch
  (D17-45), false everywhere until it is built and turned on.

### Sending rooms left, prices and closures (part 3)

- **A year at a time**, from the hotel's business date or today where the hotel
  is, whichever is later (SU refuses a past date and wants a year at connection).
- **Rooms left** go once per room type, with no rate, as SU asks; **price and
  restrictions** go per room type and meal plan. Runs of identical days travel as
  one range; requests are cut at 1,000 entries.
- **The price for each number of guests** from one to what the room sleeps, from
  the PMS's own price and extra-adult figure. A guest count nobody priced is left
  out; a price of zero is never sent. **Where the meal plan has no price of its
  own the room type's rack rate goes** (D17-92): a closed date sells nothing,
  while the rack rate keeps the room selling until somebody prices that plan.
  Breakfast then sells at the room-only price, which is the owner's call, made
  knowing it — so every night records WHERE its figure came from
  (`channel_ari_sent.price_source`: typed, derived or rack, migration 110), the
  answer to the push says how many nights went that way in words, and the screen
  says how many are selling at the rack rate right now, and from when.
- **A date with no price that may go is sent closed** (D17-81), so SU cannot keep
  selling a price the PMS no longer has.
- **Only what changed:** each date's value is kept in `channel_ari_sent` after SU
  accepts it, and the next push sends only what differs. A refused request is not
  recorded, so it is sent again.
- **By itself:** `jobs.ts`, every minute, for hotels `app.channel_manager_due()`
  names - on SU, switched on, and with an active service account in
  `channel_hotels.run_as`. `server.ts` (the master's) starts it after listen.

### A booking SU pushes (part 4)

1. **SU's key** (`SU_PUSH_KEY`, the server's settings only) is compared as a
   hash, in constant time. Anything else: 401, no detail, nothing written. No
   key set on the server at all: the door is shut (503).
2. **The card fields are cut out** of the message before anything else touches
   it (D17-83): `inbound/scrub.ts`, by the name of the field, so a field SU adds
   later that looks like a card goes too. What is kept says how many went.
3. **The hotel** is found from the id SU was given, and only a hotel on SU and
   switched on for the channel manager (`app.channel_hotel_for`). Anything else
   is refused, so SU keeps the booking, resends, and in the end emails the
   property - better than a booking vanishing into a server that will not use it.
4. **The message is stored** (migration 109), whole, before it is worked out.
   The same message twice is one row and the first answer.
5. **SU is told we have it** (`Reservation_notif`), which stops it resending
   every ten minutes and dropping the booking after an hour.
6. **Then it is worked out** (`inbound/handle.ts`, D27-183):
   - **no room free: no booking is made** (D17-80), those dates go back to SU at
     once as 0 rooms left, and the GM settles it with the site and the guest;
   - **new, a room free: a real booking** through reservations'
     `createChannelBooking`, keyed by SU's booking id (a resend is the first
     booking, "Nothing to do"; a race is answered by `channelBookingAlreadyHere`),
     refused when full, at SU's pre-tax nightly price, its meal plan from SU's
     rate plan id, SU's commission (D17-84), the guest's remarks on its notes.
     Recorded as "Booked as FH-..." with the reservations it made;
   - **cancelled: cancelled here** by `cancelChannelBooking` under the site's
     policy (D17-44), with SU's reason; a guest already arrived, or a booking
     never made here, waits for a person;
   - **kept for a person, every reason at once, nothing guessed:** a change
     (the booking here and SU's side by side), a request to book (answered on
     SU's extranet), a site whose SU code no booking source carries, a booking
     not in rupees, a room or rate plan not mapped, nights at different prices
     (each listed) or a night not priced, a price of nothing, no adult count,
     rooms on different dates, a day that does not exist (CM-6);
   - **a failure while working it out** is written on the list ("Working this
     booking out failed (...)") instead of the row staying "Just arrived".
7. **A flood** is refused (429) above a minute's worth, with nginx's own limit
   in front of it (the master's).

### The server's settings (set by the owner, on the server)

```
SU_ENVIRONMENT    sandbox | live
SU_CLIENT_ID      from SU when the account is made
SU_CLIENT_SECRET  generated on SU's extranet
SU_PUSH_KEY       the key SU presents when it pushes a booking (part 4)
```

In `api/.env` on the server, never in the repository, a screen, a test or a
chat. The host is not a setting: `sandbox` means `https://connect-sandbox.su-api.com`
and `live` means `https://connect.su-api.com`, so a mistyped address can never
receive the secret. They stay read in `su/config.ts`, not `env.ts` (the master,
17 September).

### Files

```
access.ts          who may: maySetUpSu (the login), maySetUpSuAt (a hotel's SU work)
connection.ts      part 1's two routes
su/config.ts       the three settings, read at call time; the two hosts
su/http.ts         the wire (fetch, 30 s timeout); the one thing a test replaces
su/token.ts        the token holder: reuse, renew 5 min early, 30 an hour, a
                   minute's wait after a refusal, test/live prefix check, keys
                   scrubbed from every message; SU's four ways of writing a failure
su/client.ts       a signed call: Bearer header, SU's 200-with-Fail read as a
                   refusal, one fresh login on "Authorization Required", the
                   hourly limit named
su/runtime.ts      one connection per server process
su/codes.ts        SU's room type and meal plan lists, its id rule, its endpoints
content/store.ts   the one read of what a hotel sends; recording what SU said
content/payloads.ts  what is missing, and the requests in SU's shapes
content/routes.ts  part 2's routes
ari/source.ts      what the PMS says date by date: rooms left, price per guest
                   count, where the price came from, extra person, restrictions
ari/payloads.ts    the owner's policy, the cells, and SU's availability requests
ari/push.ts        one push: read, compare, send, record what SU accepted, log
ari/routes.ts      part 3's two routes
jobs.ts            the minute job the master's server.ts starts
inbound/scrub.ts   card fields out of SU's message before anything else
inbound/parse.ts   what the PMS needs read out of the message; nothing guessed
inbound/handle.ts  what becomes of a booking, and what goes back to SU
inbound/door.ts    SU's own door: the key, the flood, store, acknowledge, work out
inbound/routes.ts  the Channel bookings list, and marking one dealt with
```

---

## Data

`data/su.ts` - the SU login, the hotel's SU content, the three saves, the content
send, and part 3's pushes. `data/suRoles.ts` - who sees the setup (D17-85).
`components/SuSetup.tsx` - the setup itself, and `ChannelBookings`, which the
page shows to everybody who reaches it. `data/suChannels.ts` - SU's booking-site
codes, copied from SU's page (D27-183), exported through `index.ts` for Booking
sources' pick-list.

---

## Database

Migration 106, **the SU mapping** (`db/migrations/106_channel_manager_su_mapping.sql`):

```
channel_hotels       one row per hotel set up for SU: its SU hotel id (unique in
                     the group, any case), the details SU needs that the hotel
                     record lacks, on_su, and the last send and SU's words
channel_room_types   one row per room type mapped: SU room id (unique per hotel,
                     any case), SU room type, children at most, is_connected,
                     on_su (active | deactivated), the last send
channel_rate_plans   one row per meal plan mapped: SU rate plan id, SU meal plan,
                     is_connected, on_su, the last send
```

Row security per hotel, forced; the application may read, add and change, never
delete (a room type once on SU is taken off, so its id is never reused); every
write audited; `updated_by` must be rostered at the hotel. No rows are created
for any hotel. Checked by `db/tests/modules/channel-manager.sql`.

What the connection stands on, not its own:

```
booking_sources.channel_code   082 - what a channel manager sends, unique across the group
rates · app.set_rate           033, 053 - every price write goes through app.set_rate
app.inventory_grid             044 - rooms left per room type per date
rate_restrictions              044 - stop sell, closed to arrival/departure, min/max nights
reservations.ota_reference     005, 091 - the sender's own reference, unique per source (RES-3)
reservations_freeze_terms      037 - cancellation terms attach however a booking is made
hotel_modules                  041 - the per-hotel switch the master will add channel_manager to
```

Migration 107, **what SU was last sent** (`107_channel_manager_su_sent.sql`):

```
channel_ari_sent     one row per room type (meal_plan '-': rooms left) or room
                     type and meal plan per date, holding exactly what SU
                     received. Written only after SU accepted it
channel_ari_pushes   every push: what started it, the window, how many requests
                     and dates, what SU said, how many dates went unpriced
channel_hotels.run_as   the service account a hotel's minute job runs as
app.channel_manager_due()   which hotels are due, before anybody's session
```

The copy of what was sent is not audited row by row - a year of dates for every
room type and meal plan would bury the audit log - and the push log is the record
instead. The application may add and change the copy, add to the log, and delete
neither.

Migration 110, **which figure went to SU, and why** (`110_channel_manager_price_source.sql`),
the second half of D17-92:

```
channel_ari_sent.price_source   typed | derived | rack | null (no price in the
                                cell: rooms left, or a date closed for want of
                                one). A night selling at the rack rate can be
                                answered for afterwards
channel_ari_pushes.rack_dates   was rack_only. The same count, no longer meaning
                                "held back": from D17-92 those nights are sent
```

Rows written before 18 September keep a null `price_source`: what SU was sent for
them is known and where it came from is not, and a migration does not invent it.

**107 and 108, not 106:** 106 is the Store chat's (stock per place), so on this branch
alone `src/test/migrationNumbers.test.ts` reports a gap until the Store's 106 is
in cp6. The master renumbers at merge if cp6 moves first.

---

## Front door

`api/src/modules/channel-manager/index.ts` exports `mounts` - `connection` under
`/api`, `content` and `availability` under `/api/hotels` - and `jobs`
(`{ start(): void; stop(): Promise<void> }`), which `server.ts` starts after
listen and never under the tests. `src/modules/channel-manager/index.ts`
exports nothing.

---

## Leans on

- **guests** - `listCompanies` through `@/modules/guests`, on the status page.
- **inventory** - reads `room_types`, `rooms` and `meal_plans` for the content,
  and `app.inventory_grid`, `app.price_for`, `app.extra_person_rates` and
  `rate_restrictions` for part 3, in SQL, as the booking door and the rate grid
  do (the master, 17 September). ⚠ `ari/source.ts` carries a COPY of
  `app.tariff_for`'s arithmetic for adults, because calling it per date and per
  guest count took 11 seconds a year under row security; the test
  `suAvailability.test.ts` compares the two date by date. A set-based tariff in
  inventory would end the copy: asked below.
- **reservations** (part 4), through its front door: `createChannelBooking`,
  `cancelChannelBooking`, `channelBookingAlreadyHere`, `isUniqueViolation`
  (the CRS bridge uses the same door). What is not exported there is a request
  to the master.
- **guests** - `listBookingSources` on the page (each site's SU code); the
  Booking sources screen picks from `SU_CHANNELS`.
- **admin / the master** - the per-hotel switch, `app.module_enabled(hotel,
  'channel_manager')`.

---

## Gates

```
web     npx tsc -b --force      clean
        npx vitest run          all pass but migrationNumbers on this branch (107 before 106)
api     cd api; npm test        all pass (never npx vitest run in api/)
        cd api; npm run strip-check   every file loads with types stripped (CM-3)
db      bash db/tests/run.sh    all pass; bash db/tests/rerun.sh re-runnable
```

---

## Requests to the master

1. **17 Sep · the demo loader aims at the main database from a copy** (CM-1).
   Answered 17 Sep: four more scripts share it; the fix goes to the owner first;
   the master writes the MEMORY lesson. **Done 17 Sep** (`425fd34`): every
   script asks `scriptDatabase.ts`, and refuses rather than guess.
2. **17 Sep · SU's settings in `env.ts`.** Answered 17 Sep: leave them in
   `su/config.ts`.
3. **17 Sep · who may reach the SU connection.** Answered by the owner (D17-85):
   the owner and an administrator. Done on both sides: the master widened
   `integration` in `src/lib/permissions.ts`, and the two role lists agree.
4. **17 Sep · migration numbers.** Answered: **106** (the SU mapping) and **107**
   (what SU was last sent), after the master renumbered them at merge. 108 is the
   master's own, which makes `channel_manager` a module a hotel is switched on
   for, so part 3's gate can be true. `server.ts` starts `jobs` after listen,
   never under the tests.
5. **17 Sep · a set-based tariff in inventory.** `app.tariff_for` per date and
   per guest count costs 11 seconds a year under row security, so part 3 keeps a
   copy of its arithmetic for adults. Something like
   `app.tariff_grid(hotel, from, to, guests)` in inventory would end the copy.
6. **17 Sep · a booking door a machine can call, in process** (D17-79). **Built
   by reservations; used from 30 September** (D27-183). What was asked for: Exported from
   `api/src/modules/reservations/index.ts`, called inside the caller's own
   session so the whole thing is one transaction:

   ```ts
   createChannelBooking(client, staffId, {
     hotelId, guestName, phone?, email?,
     checkIn, checkOut,                  // YYYY-MM-DD
     bookingSourceId,                    // the OTA's row in booking_sources
     externalRef,                        // SU's booking id: the repeat key (RES-3)
     commissionAmount?,                  // SU's figure when it sends one (D17-84)
     specialRequest?, expectedArrival?,
     lines: [{ roomTypeId, mealPlan, adults, children, rooms,
               nights: [{ date, priceBeforeTax, tax? }],   // D17-82
               agreedRate? }],
   }): Promise<
     | { ok: true; duplicate: boolean; reference: string;
         reservationIds: string[]; folioIds: string[]; guestId: string }
     | { ok: false; kind: "no_room" | "unpriced" | "refused"; reason: string }>
   ```

   What it must hold, beyond what the HTTP door already does:
   - **refuse, never overbook** (D17-43, D17-80): `kind: "no_room"` when a line
     has no room free for every night, having written nothing;
   - **a repeat is the first answer** (RES-3), `duplicate: true`;
   - **nothing survives a refusal** (RES-1), including the guest;
   - money as strings, and no figure invented: a line with no price is
     `kind: "unpriced"`, never zero.

   And beside it, for a change and a cancellation SU sends:

   ```ts
   amendChannelBooking(client, staffId, { hotelId, externalRef, lines, checkIn?, checkOut? })
   cancelChannelBooking(client, staffId, { hotelId, externalRef, reason,
                                           chargeFrom: "channel", channelFee? })
   ```
   `chargeFrom: "channel"` because an OTA booking follows the OTA's policy
   (D17-44), not the hotel's terms.

7. **17 Sep · a reservation that keeps each night's price** (D17-82) - **still
   not built.** Until it is, a booking whose nights are priced differently waits
   for the desk, each night listed (D27-183, Q2). Reservations stores one `agreed_rate` for a stay; SU sends a price a
   night. The shape asked for:

   ```
   reservation_nights(reservation_id, for_date, price_before_tax, tax,
                      meal_plan, primary key (reservation_id, for_date))
   ```
   written by the door above when a caller sends `nights`; the night audit posts
   from it where rows exist and from `agreed_rate` where they do not, so nothing
   changes for a booking taken at the desk.
7. **17 Sep · P3-b — ANSWERED 18 September, D17-92:** the rack price goes, rather
   than the date closing, and breakfast sells at the room-only price until
   somebody prices it. Built the same day: migration 110 records which figure went
   and why, and the screen says it in words. Nothing is open here.
8. **17 Sep · part 4's door** (D17-79). Design approved by the master, 17 Sep.
   Needed from them, because the files are theirs: the fourth mount prefix
   `/api/channel` in `mount.ts`, with `server.ts` leaving it outside the staff
   bearer gate (the door checks SU's key itself), and the nginx lines - a rate
   limit on that address, and an allowlist of the addresses SU pushes from once
   SU gives them. The key itself is the owner's: generated by them, in the
   server's settings (`SU_PUSH_KEY`) and SU's extranet, never in the repository,
   a test or a chat.
9. **17 Sep · a migration number for part 4's inbox.** Answered: **109** is this
   lane's (the master, 18 Sep). **110** (which figure went to SU, D17-92) taken
   the same day on the same rule: after cp6's highest.

10. **30 Sep · the commission counted once** (found here): `createChannelBooking`
    wrote SU's commission, which is per whole reservation, onto every room. The
    master: fix it at the root in reservations, on the first room only.
11. **30 Sep · a change a site sends** (Q3): kept for a person today. A door
    that amends a booking from a channel would be reservations' work, if the
    owner ever wants a change applied by itself.
12. **30 Sep · SU's push, from SU** (Q8): how SU identifies itself when it
    pushes (the door takes `x-su-key` or `Authorization: Bearer` today) and
    its addresses for nginx are not in SU's public documents; the owner asks SU.

## Requests from other services

None yet. Add a line here (date, your service, what you need and why) and leave
the change to whoever holds this service's claim.
