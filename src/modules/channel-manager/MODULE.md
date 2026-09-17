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
api/src/modules/channel-manager/      the SU connection (parts 1 and 2 built)
api/test/modules/channel-manager/     its tests, against SU's documented answers
db/tests/modules/channel-manager.sql  the SU mapping tables: ids, uniqueness, grants, audit
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
| 3 | **Rates and availability:** rooms left, prices and restrictions pushed whenever they change and on demand, read through inventory's front door | Next |
| 4 | **Reservations:** new, modified and cancelled bookings from SU, landing through reservations' front door (idempotent since RES-3) with their OTA source and commission | Waits on the owner's answers, through the master |

The owner's rules for it (D17-43 to D17-45): a booking for a room no longer
free is **refused and SU told**, never an overbooking; an OTA booking follows
**the OTA's cancellation policy**, a direct one the hotel's terms; **each hotel
is switched on separately**, none by default.

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

**The owner also sees the SU setup** (`components/SuSetup.tsx`), because the
`integration` grant is the owner's alone (`can(role, "edit", "integration")`):

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

Nothing on it is suggested or filled in: no SU id from a code, no SU room type
from a name, no SU meal plan from "Continental". Saving sends nothing.

---

## Server endpoints

| Method and path | What | Who |
|---|---|---|
| `GET /api/channel-manager/su` | Whether SU is set up on this server (test or live account), what is missing, the last login and this hour's count against SU's 30 | owner |
| `POST /api/channel-manager/su/login` | Logs in to SU now and says whether it worked. Sends nothing to any booking site | owner |
| `GET /api/hotels/:code/channel-manager/content` | The hotel, its SU details, room types and meal plans with their SU mapping, what SU still needs, SU's room type and meal plan lists, whether the hotel is switched on | owner of this hotel |
| `PUT /api/hotels/:code/channel-manager/hotel` | Saves the SU hotel id and the details SU needs that the hotel record lacks. Refuses an id SU would not take, one another hotel uses, or a change once SU has the hotel | owner of this hotel |
| `PUT /api/hotels/:code/channel-manager/room-types/:roomTypeId` | Saves a room type's SU room id, SU room type, children at most, and whether it goes to SU. Refuses children that fill the room, a type not on SU's list, an id used twice, a change once SU has it | owner of this hotel |
| `PUT /api/hotels/:code/channel-manager/rate-plans/:mealPlan` | The same for a meal plan as an SU rate plan | owner of this hotel |
| `POST /api/hotels/:code/channel-manager/content/send` | Sends the hotel, then its room types, then its rate plans to SU (below) | owner of this hotel |

**Owner only** because the `integration` grant in `src/lib/permissions.ts` is
held by the owner alone (a group administrator counts as the owner). Whether an
administrator or a GM should also reach it is with the owner, through the
master; owner only until the answer comes back.

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
access.ts          who may: ownsAnyHotel (the login), ownsHotel (a hotel's SU content)
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
```

---

## Data

`data/su.ts` - the SU login status and check, the hotel's SU content, the three
saves and the send. `components/SuSetup.tsx` - the owner's setup.

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

**107, not 106:** 106 is the Store chat's (stock per place), so on this branch
alone `src/test/migrationNumbers.test.ts` reports a gap until the Store's 106 is
in cp6. The master renumbers at merge if cp6 moves first.

---

## Front door

`api/src/modules/channel-manager/index.ts` exports `mounts`: `connection` under
`/api` and `content` under `/api/hotels`. `src/modules/channel-manager/index.ts`
exports nothing.

---

## Leans on

- **guests** - `listCompanies` through `@/modules/guests`, on the status page.
- **inventory** - reads `room_types`, `rooms` and `meal_plans` in SQL for the
  content (part 2), as other services read them; part 3 will read rooms left,
  prices and restrictions.
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
db      bash db/tests/run.sh    all pass; bash db/tests/rerun.sh re-runnable
```

---

## Requests to the master

1. **17 Sep · the demo loader aims at the main database from a copy** (CM-1).
   Answered 17 Sep: four more scripts share it; the fix goes to the owner first;
   the master writes the MEMORY lesson. Until then none of them is run from a copy.
2. **17 Sep · SU's settings in `env.ts`.** Answered 17 Sep: leave them in
   `su/config.ts`.
3. **17 Sep · who may reach the SU connection** (owner only today). With the
   owner, through the master.
4. **17 Sep · migration number.** Answered: 107.

## Requests from other services

None yet. Add a line here (date, your service, what you need and why) and leave
the change to whoever holds this service's claim.
