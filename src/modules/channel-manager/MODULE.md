# Channel manager

The wire between this system and the booking sites (Agoda, Booking.com,
Expedia, Goibibo/MMT and the rest), through **SU** (Su channel manager): rooms
left, prices and restrictions out; bookings in.

**BEING BUILT, NOT CONNECTED.** The owner chose SU and asked for the connection
to be built on 17 September (D17-66, `docs/briefs/decisions-2026-09-17.md`).
SU's API documents: https://suissu.gitbook.io/su-api-documentation/su-channel-manager
(the full index is `llms.txt` beside it). Nothing is sent to SU or any booking
site until the owner has SU's test keys, and nothing goes live without the
owner's yes.

```
src/modules/channel-manager/          the page, the owner's SU setup, these notes
api/src/modules/channel-manager/      the SU connection (parts 1, 2 and 3 built)
api/test/modules/channel-manager/     its tests, against SU's documented answers
db/tests/modules/channel-manager.sql  the SU tables: ids, uniqueness, grants, audit
```

The brief is `docs/briefs/channel-manager.md` (its 17 September section wins).
Claim with `npm run claim -- channel-manager "what"`; `npm run lane --
channel-manager` before a commit. **Do not run** `load-demo`, `demo`,
`demo-history`, `reset`, `retire-staff` or `pos:outlet` from a copy until the
master's fix lands (CM-1): each falls back to the master's `fidato` database.

---

## The build, in the owner's order

| Part | What | State |
|---|---|---|
| 1 | **Token login.** SU's keys from the server's settings only; a token reused, renewed before it lapses, SU's 30 logins an hour never spent by a loop, a test key never used against the live account | **Built** 17 September, branch `channel-manager/su-connection`; audited by the master |
| 2 | **Content:** the hotel, its room types and its rate plans, sent to SU from the PMS (the record, D17-28); a mapping table per hotel | **Built** 17 September, same branch; migration 107 (the SU mapping) |
| 3 | **Rates and availability:** rooms left, prices and restrictions pushed whenever they change and on demand | **Built** 17 September, same branch; migration 108 (what SU was last sent) |
| 4 | **Reservations:** SU **pushes** each booking to the PMS (D17-79); it lands through reservations' front door (idempotent since RES-3) with its OTA source and commission | Next. The door's design goes to the master first: the address, how SU proves a call is its own, a repeat, a flood |

The owner's rules for it (D17-43 to D17-45, D17-79 to D17-85):

- a booking for a room no longer free is **not created**; receipt is confirmed
  to SU, **0 rooms left is sent at once**, and it is listed for the GM (D17-80);
- an OTA booking follows **the OTA's cancellation policy**, a direct one the
  hotel's terms (D17-44);
- **each hotel is switched on separately**, none by default (D17-45);
- **a date with no price goes to SU closed** (D17-81);
- **each night's price is kept** as SU sent it (D17-82; a reservations change);
- a **card number or CVC is never kept** (D17-83);
- commission: **SU's amount, else the source's %, else "-"** (D17-84);
- the SU setup is the **owner's and an administrator's** (D17-85).

**Stop and ask the owner** before anything that would change a price or close a
room without a person, anything about money SU collects, and the first live push.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who (`nav.ts`) |
|---|---|---|---|
| Channel manager | `/h/:code/channels` | `pages/ChannelManager.tsx` | owner, admin, GM (Coming soon section, `seesComingSoon`) |

Still in the Coming soon section. Everybody who reaches it sees what the
connection is (through SU, being built, sending nothing to any booking site yet)
and what it still needs before it goes live.

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
   requests, what SU said, and how many dates went closed for want of a price.

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
| `GET /api/hotels/:code/channel-manager/availability` | The last ten pushes of rooms left, prices and closures, and what SU said | owner or admin here |
| `POST /api/hotels/:code/channel-manager/availability/send` | Sends a year (`all`) or only the dates that changed (`changes`) | owner or admin here |

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
  out; a price of zero is never sent; a rack fallback is held back (P3-b).
- **A date with no price that may go is sent closed** (D17-81), so SU cannot keep
  selling a price the PMS no longer has.
- **Only what changed:** each date's value is kept in `channel_ari_sent` after SU
  accepts it, and the next push sends only what differs. A refused request is not
  recorded, so it is sent again.
- **By itself:** `jobs.ts`, every minute, for hotels `app.channel_manager_due()`
  names - on SU, switched on, and with an active service account in
  `channel_hotels.run_as`. `server.ts` (the master's) starts it after listen.

### The server's settings (set by the owner, on the server)

```
SU_ENVIRONMENT    sandbox | live
SU_CLIENT_ID      from SU when the account is made
SU_CLIENT_SECRET  generated on SU's extranet
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
```

---

## Data

`data/su.ts` - the SU login, the hotel's SU content, the three saves, the content
send, and part 3's pushes. `data/suRoles.ts` - who sees the setup (D17-85).
`components/SuSetup.tsx` - the setup itself.

---

## Database

Migration 107, **the SU mapping** (`db/migrations/107_channel_manager_su_mapping.sql`):

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

Migration 108, **what SU was last sent** (`108_channel_manager_su_sent.sql`):

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
- **reservations** (part 4), through its front door. What is not exported there
  is a request to the master.
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
   the master writes the MEMORY lesson. Until then none of them is run from a copy.
2. **17 Sep · SU's settings in `env.ts`.** Answered 17 Sep: leave them in
   `su/config.ts`.
3. **17 Sep · who may reach the SU connection.** Answered by the owner (D17-85):
   the owner and an administrator. **Still open for the master:** widen
   `integration` in `src/lib/permissions.ts` to the administrator, so the grant
   matrix says what the two `SU_ROLES` lists say; the lists move with it.
4. **17 Sep · migration numbers.** Answered: 107 (the SU mapping), 108 (what SU
   was last sent). `server.ts` starts `jobs` after listen.
5. **17 Sep · a set-based tariff in inventory.** `app.tariff_for` per date and
   per guest count costs 11 seconds a year under row security, so part 3 keeps a
   copy of its arithmetic for adults. Something like
   `app.tariff_grid(hotel, from, to, guests)` in inventory would end the copy.
6. **17 Sep · a reservation that keeps each night's price** (D17-82). Reservations
   stores one `agreed_rate` for a stay; SU sends a price per night, and part 4
   must keep them. The shape asked for: a `reservation_nights` row per
   reservation and date (price before tax, tax, meal plan, the source's own
   line), written by the booking door when a caller sends nights, and the night
   audit posting from it where it exists. The reservations lane's change, with a
   migration number from the master.
7. **17 Sep · P3-b, still with the owner:** may a **rack** price go to SU? It is
   the room type's own rate, the same figure whatever the meal plan, so breakfast
   would go out at the room-only price. Until answered, such a date is treated as
   unpriced, and D17-81 sends it closed.
8. **17 Sep · part 4's door** (D17-79, SU pushes each booking): design going to
   the master before anything is built - the address, how SU proves a call is
   SU's, a repeat, and a flood.

## Requests from other services

None yet. Add a line here (date, your service, what you need and why) and leave
the change to whoever holds this service's claim.
