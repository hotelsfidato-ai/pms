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
src/modules/channel-manager/          the page, the menu entry, these notes
api/src/modules/channel-manager/      the SU connection (part 1 built)
api/test/modules/channel-manager/     its tests, against SU's documented answers
db/tests/modules/channel-manager.sql  not yet: no table of its own until part 2
```

The brief is `docs/briefs/channel-manager.md` (its 17 September section wins).
Claim with `npm run claim -- channel-manager "what"`; `npm run lane --
channel-manager` before a commit.

---

## The build, in the owner's order

| Part | What | State |
|---|---|---|
| 1 | **Token login.** SU's keys from the server's settings only; a token reused, renewed before it lapses, SU's 30 logins an hour never spent by a loop, a test key never used against the live account | **Built** 17 September, branch `channel-manager/su-connection` |
| 2 | **Content:** the hotel, its room types and its rate plans, sent to SU from the PMS (the record, D17-28); a mapping table per hotel | Next |
| 3 | **Rates and availability:** rooms left, prices and restrictions pushed whenever they change and on demand, read through inventory's front door | After 2 |
| 4 | **Reservations:** new, modified and cancelled bookings from SU, landing through reservations' front door (idempotent since RES-3) with their OTA source and commission | After 3 |

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

Still the status page, in the Coming soon section. Since 17 September it says
the connection is through SU, is being built and sends nothing yet, and lists
what it still needs before it goes live. It lists the booking sources recorded
as OTAs, or says none have been.

---

## Server endpoints

| Method and path | What | Who |
|---|---|---|
| `GET /api/channel-manager/su` | Whether SU is set up on this server (test or live account), what is missing, the last login and this hour's count against SU's 30 | owner |
| `POST /api/channel-manager/su/login` | Logs in to SU now and says whether it worked. Sends nothing to any booking site | owner |

Mounted under `/api`, not `/api/hotels/:code`: SU's keys belong to the PMS as
SU's partner, and one pair serves every hotel connected.

**Owner only** because the `integration` grant in `src/lib/permissions.ts` is
held by the owner alone (a group administrator counts as the owner). Whether an
administrator or a GM should also reach it is the owner's to say.

No answer carries the client id, the secret or the token.

### The server's settings (set by the owner, on the server)

```
SU_ENVIRONMENT    sandbox | live
SU_CLIENT_ID      from SU when the account is made
SU_CLIENT_SECRET  generated on SU's extranet
```

In `api/.env` on the server, never in the repository, a screen, a test or a
chat. The host is not a setting: `sandbox` means `https://connect-sandbox.su-api.com`
and `live` means `https://connect.su-api.com`, so a mistyped address can never
receive the secret.

### Files

```
su/config.ts    the three settings, read at call time; the two hosts
su/http.ts      the wire (fetch, 30 s timeout); the one thing a test replaces
su/token.ts     the token holder: reuse, renew 5 min early, 30 an hour, a
                minute's wait after a refusal, test/live prefix check, keys
                scrubbed from every message; SU's four ways of writing a failure
su/client.ts    a signed call: Bearer header, SU's 200-with-Fail read as a
                refusal, one fresh login on "Authorization Required", the
                hourly limit named
su/runtime.ts   one connection per server process
connection.ts   the two routes above
```

---

## Data

None yet. Part 2 adds the mapping tables.

---

## Database

No tables of its own yet. What the connection stands on:

```
booking_sources.channel_code   082 - what a channel manager sends, unique across the group
rates · app.set_rate           033, 053 - every price write goes through app.set_rate
app.inventory_grid             044 - rooms left per room type per date
rate_restrictions              044 - stop sell, closed to arrival/departure, min/max nights
reservations.ota_reference     005, 091 - the sender's own reference, unique per source (RES-3)
reservations_freeze_terms      037 - cancellation terms attach however a booking is made
```

A migration takes the next number after cp6's highest when the file is written,
and the master is told.

---

## Front door

`api/src/modules/channel-manager/index.ts` exports `mounts` (the `connection`
router under `/api`). `src/modules/channel-manager/index.ts` exports nothing.

---

## Leans on

- **guests** - `listCompanies` through `@/modules/guests`, on the status page.
- **inventory** (parts 2 and 3), **reservations** (part 4), through their front
  doors. What is not exported there is a request to the master.

---

## Gates

```
web     npx tsc -b --force      clean
        npx vitest run          all pass (includes src/test/boundaries.test.ts)
api     cd api; npm test        all pass (never npx vitest run in api/)
```

---

## Requests to the master

1. **17 Sep · the demo loader aims at the main database from a copy** (CM-1).
   `api/scripts/load-demo.ts` connects to `SUPER_DATABASE_URL` or, if unset, to
   `fidato`, whatever the copy's `api/.env` says. Run from
   `D:\fidato-channel-manager` it began tearing down 5EL in the master's
   development database; the append-only stock guard stopped it inside its
   transaction and nothing was kept. Asked: refuse to run without
   `SUPER_DATABASE_URL`, or take the database name from `DATABASE_URL`.
2. **17 Sep · SU's settings in `env.ts`, if wanted.** Part 1 reads the three SU
   settings in `su/config.ts` at call time, so `env.ts` (core) is untouched and
   the server starts without them. If the master prefers them listed in
   `env.ts`, it is one block.

## Requests from other services

None yet. Add a line here (date, your service, what you need and why) and leave
the change to whoever holds this service's claim.
