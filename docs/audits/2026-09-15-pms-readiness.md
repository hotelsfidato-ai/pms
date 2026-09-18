# Fidato PMS — integration-readiness audit (read-only, 15 September 2026)

Written by an agent for `docs/HMS-INTEGRATION-PLAN.md`. Scope: branch
`service-folders` at `2b6b032`. Nothing was written, built, deployed or run;
no `.env*`, service-account or key file was opened.

## 1 · Facts measured

| Fact | Value | Where |
|---|---|---|
| API route registrations | **215** (`214` under `/api` + `GET /health`) | grep of `*.get/post/put/patch/delete(` across `api/src`; `HANDOVER.md` § 3.0 says 214 |
| Routers by size | till 45, admin 16, rates 13, banquet 12, operations 10, inventorySetup 8 … reservations `groups.ts` 4 | same grep, per file |
| Credential schemes accepted by the API | **3** — Firebase ID token (`Authorization: Bearer`), `x-dev-staff-id` (dev only), `x-pos-key` (outlet key); plus **1 second factor** `x-provisioning-key` | `api/src/server.ts:146-180`, `auth.ts:58-104`, `admin.ts:101,705` |
| Inbound webhook endpoints in the API | **0** — every `/api/*` path needs a subject; only `/health` is open | `server.ts:108,146` |
| Rate limiting on the API | **0** (nginx `limit_req` exists only on n8n's `/webhook*` paths, 10 r/s burst 40) | `deploy/nginx.conf` (no `limit_req`); `deploy/n8n.sh:443,478-479` |
| CORS | allow-list from `CORS_ORIGIN` (one origin in production), `credentials: true`, `maxAge` 86400, 5 allowed headers, methods = Hono default | `server.ts:61-102`, `env.ts:78-81`, `deploy/launch.sh:377` |
| Hotels in production | **1** — `5EL`, 18 rooms (Superior 201–210 = 10, Deluxe 301–308 = 8), 2 room types | read on production; matches `api/scripts/load-demo.ts:41,78,281` |
| Hotels the schema was written for | 7 (`FH01`–`FH07` placeholders) | `db/migrations/002_tenancy.sql:17`, `008_seed.sql:26-34` |
| Staff rows in production | 4 (2 active) | read on production |
| Booking sources in production | 6: Fidato Hotels/direct, Walk-in, Agoda `AGODA`, Booking.com `BDC`, Expedia `EXPEDIA`, go-MMT `GOMMT` — exactly the 082 seed | `082_booking_sources.sql:240-247` |
| Module switch values | **3** — `pos`, `banquet`, `reception_pos`; production rows: banquet on, reception_pos on, pos absent (= on) | `041:32`, `087:106-108`, `041:57-64` |
| Roles | 12 in the database, 13 in the frontend (`automation` exists only in `permissions.ts`) | `078_roles.sql:76-90`; `src/lib/permissions.ts:24-38` |
| Migrations | **89** (001–089), 15,347 lines, replayed on every deploy | `db/migrations/`; `MEMORY.md` 271 |
| Tables without RLS | guard exists: `app.tables_without_rls()` | `013_policies.sql:333-344` |
| Server tests | **28** files (`api/test/**`); 359 tests per HANDOVER | file count measured; test count not re-run |
| Web tests | **19** `*.test.ts(x)` files under `src/` | measured; count not re-run |
| Database tests | 588 assertions per HANDOVER; `db/tests/modules/` does not exist yet | `HANDOVER.md` § 2; `ls db/tests` |
| Columns to store an outside system's id | **1 dormant** (`reservations.ota_reference`, nothing writes it), **1 live** (`booking_sources.channel_code`); none on guests, rooms, room types | `005_reservations.sql:38`; `082:57`; grep |
| Change feed | 1 SSE stream, fed by triggers on **POS tables only** | `api/src/realtime.ts:34`, `075_live_orders.sql:60-67`, `api/src/routes/live.ts:44` |
| Fidato-specific tokens in code (src, api/src, db/migrations, deploy, scripts) | `fidato` 54 files / 137 lines; `fidatohotels.com` 8 / 13; `5EL` 29 / 54; `Akkalkot` 30 / 55; `FH-` 8 / 22; `poms-fad05` 2 / 2 | grep, excluding node_modules, dist, docs, md |

## 2 · Findings

Severity key: **blocks** (must be fixed before an automated caller is connected) · **must decide** (the owner's call) · **fix on the way** · **note**.

**PMS-1 · blocks — There is no machine identity for anything but a till.**
Evidence: `server.ts:157-167` (the only key scheme is `x-pos-key`, and it only applies when the path starts with `/api/pos`); `mount.ts:20` (three prefixes only: `/api`, `/api/hotels`, `/api/pos`); `pos.ts:84-114` and `024_pos_bridge.sql:230-260` (key → sha256 → `app.pos_outlet_for_key` → the outlet's *service-account staff row*, then `withUser(outlet.staffId)`); `api/scripts/pos-outlet.ts:104-120` (that account is a `staff` row with role `pos` at one hotel).
Meaning: the CRS, the leads app and the channel manager can reach the API today only by (a) holding a Firebase account and sending a person's ID token, or (b) being a POS outlet, which unlocks four `/api/pos/*` routes and nothing else. PENDING § 2 plans an n8n Firebase login (`n8n@fidatohotels.com`, Viewer); see PMS-2 for why "Viewer" would not limit it.
Resolution: an `integrations` table in the shape of `pos_outlets` (024:46-74 — `hotel_id`, `kind`, `staff_id` service account, `api_key_hash`, `is_active`), a `SECURITY DEFINER` resolver like `app.pos_outlet_for_key`, a fourth prefix in `mount.ts` (a core edit under AGENTS.md), and a second `if` in the gate at `server.ts:157`. Keys minted by a script like `pos-outlet.ts`, printed once.

**PMS-2 · blocks — The server checks no role; every rostered person, whatever their role, can create bookings, guests, groups, folios and rates.**
Evidence: `src/lib/permissions.ts:1-5` ("consulted by navigation, page sections, table row actions and buttons") is frontend-only — no server file imports it (grep of `role|is_manager|manages_hotel` in `groups.ts` and both inventory routers: empty). Server authorisation is RLS alone: `reservations`, `folios`, `rates`, `rate_restrictions` carry `hotel_isolation … for all` (`007_rls.sql:29-52`, `033:138-144`, `044:67-74`); `guests_insert` and `rg_write` are `app.is_active_staff()` (`013:155-157, 278-280`). Only sources, hotels, staff, module switches are manager-gated (`082:208-213`, `013:305-307`, `084`, `moduleSwitches.ts:100-107`).
Meaning: a `read_only` "Viewer" account for n8n can `POST /:code/bookings` and `PUT /:code/rate-grid`. The role matrix a hotel sees in Administration → Roles is not what the API enforces.
Resolution: for integrations, scope by *what the key unlocks* (PMS-1) rather than by role; for people, a server-side check per write route is a larger project — record it, do not fold it into this work.

**PMS-3 · blocks — `POST /:code/bookings` has no idempotency at all.**
Evidence: the `idempotency-key` header is read only in `banquet.ts:296` and `housekeeping.ts:285` (per `062_idempotency.sql:16-21`); `groups.ts:248-463` never reads it; `reservations` has no key column (grep); the reference is not a client key (PMS-5). Contrast the POS: `unique (outlet_id, ticket_ref)` (`024:133`) and the "already seen" pre-check (`pos.ts:196-220`).
Meaning: a timed-out request from the CRS or the channel manager, retried, makes a second guest, a second group, a second set of confirmed bookings and folios — and a booking cannot be deleted, only voided with a reason (`042:40-68`).
Resolution (migration + router): `reservations.external_ref text` (or reuse `ota_reference`, 005:38) with `create unique index … (booking_source_id, external_ref) where external_ref is not null`, and the route answering a duplicate with the original references, as `pos.ts:208-220` does.

**PMS-4 · blocks — RES-1 confirmed by reading: a refused booking commits its guest, its group, and the rooms already made.**
Evidence: `withUser` commits whatever the callback returns (`db.ts:53-57`; a refusal is a `return`, not a throw — MEMORY 243). In `groups.ts`: `insert into guests` at 317-322 and `insert into reservation_groups` at 326-332 come *before* the refusals at 352-353 (source inactive), 364 (room type not here), 368-372 (party too big), 389-391 (unpriced); and inside the per-line loop, line 1's `insert into reservations` (403-429) and `insert into folios` (442-445) commit before line 2 is refused. Guests are never deletable (`015`, cited in MEMORY 243).
Meaning for an automated feed: every refused booking leaves a phantom guest with a phone and email; a multi-type booking refused on its second type leaves the first type's rooms **confirmed with open folios, holding inventory** while the caller sees `ok:false` and retries — each retry adds more. With PMS-3 and no rate limit this is unbounded. A throw, by contrast, rolls back (`db.ts:58-66`), so a malformed date (`$5::date`) or an unknown meal plan (FK 23503, unmapped in this router) costs a 500 but leaves nothing.
Resolution: move the four in-session refusals and the per-line checks above the first write (validate every line, then write), or throw a `Refusal` that `withSession` turns into a 409 after rollback (a core change). The route's own test should assert "no guest by that name" after a refusal, as the walk-in's does (MEMORY 243).

**PMS-5 · fix on the way — The booking reference is generated without a lock, in two copies, with a hard-coded `FH-` prefix and the calendar date.**
Evidence: `groups.ts:397-401` and `operations.ts:939-942` both do `max(numeric suffix)+1` (start 5000) with no advisory lock; `app.next_reference` (`005:147-171`, advisory-locked, `CODE-000123`) has no caller (grep). `unique (hotel_id, reference)` (`005:45`) makes a concurrent second booking fail with 23505 → 500 "Something went wrong. Nothing was changed." (`server.ts:215-224`).
Meaning: two feeds booking the same second will lose one request to a 500 (rolled back, so safe, but it will be retried — see PMS-3). The prefix `FH-` and `to_char(now(),'DDMM')` are Fidato's and the server's clock, not the hotel's code and business date.
Resolution: one generator (a function, locked, prefix from `hotels.code`), called by both doors.

**PMS-6 · must decide — Restrictions and availability are reported, never enforced, on inbound bookings.**
Evidence: `groups.ts:244-247` ("AVAILABILITY IS REPORTED, NOT ENFORCED"); the route never reads `rate_restrictions` (grep); `044:8-28` defines stop-sell/CTA/CTD/min-max nights for the grid only.
Meaning: a channel manager delivering an OTA booking on a stop-sell date, or the CRS booking past `available`, is accepted silently. The clerk's judgement the comment relies on does not exist for a machine caller.
Resolution: owner's decision — enforce for integration identities (a check inside the route against `app.inventory_grid` and `rate_restrictions`, with a named refusal), keep the clerk free to overbook.

**PMS-7 · must decide — A booking is priced from the *first night only*, and a caller may send any price.**
Evidence: `groups.ts:374-394` calls `app.tariff_for(...checkIn...)` once and stamps that as `agreed_rate` for every night ("a stay crossing a season is charged what was agreed"); `GET /:code/tariff` (`rates.ts:700-715`) quotes per night. `line.agreedRate` is accepted as-is (`groups.ts:379`), the only check being `agreed_rate >= 0` (`005:48`) — so zero is a legal price without a rate plan and without `is_complimentary`.
Meaning: a CRS that quoted a two-season stay from `/tariff` will book at a different total; an OTA booking's own price can only be carried as `agreedRate`, which is exactly a caller setting a price without a rate plan.
Resolution: decide whether an integration may send `agreedRate` (recommended: yes for OTA/CRS bookings, because the guest was quoted it, but record `commission_pct` and the source), and whether `agreed_rate` should become an average of `app.tariff_for` over the nights when the caller sends none.

**PMS-8 · fix on the way — Booking sources are resolved by uuid only; `channel_code` cannot be sent.**
Evidence: `groups.ts:294-299, 343-351` (`bookingSourceId` required, looked up by `bs.id`); `booking_sources.channel_code` is unique and described as "what a channel manager will send" (`082:55-57, 74-75, 84-86`). Free-text `source` is still accepted and stored (`groups.ts:258-263, 418`).
Resolution: a router change, no migration — accept `channelCode` and resolve it; keep `bookingSourceId` for the form.

**PMS-9 · must decide — Nothing an outside system can subscribe to; it would poll.**
Evidence: the one `LISTEN` channel is `pos_changed` (`realtime.ts:34`), raised by triggers on `pos_orders` and `pos_order_lines` only (`075:60-67`), carrying a hotel id and nothing else (`075:21-29`); `GET /:code/live` (`live.ts:44-104`) needs a bearer header via `fetch`, not `EventSource` (`live.ts:16-26`); notifications are derived per request, never stored (`routes/notifications.ts:23-32`); no events/outbox table exists (grep). PENDING § 3 already names the fix for housekeeping: extend the 075 trigger.
Meaning: the leads app "wants availability pushed to it"; nothing pushes. `docs/MASTER-ARCHITECTURE.md` § 4 rejected Firestore for the PMS because "two sources of truth is the bug" — a push that copies availability into a Firestore app creates exactly that second source.
Resolution: an `integration_events` outbox (hotel_id, kind, ref, payload, created_at, delivered_at) written by triggers on `reservations`, `room_assignments`, `room_blocks`, `rates`, `rate_restrictions`; n8n drains it and pushes. Polling `GET /:code/inventory` is the no-migration alternative.

**PMS-10 · fix on the way — Two responses turn a NULL rack rate into `0`.**
Evidence: `rateGrid.ts:97` `Number(r.base_rate)` and `roomTypesAndPlans.ts:66` `Number(r.rack_rate)` — the shape of MEMORY 246; `032` made `base_rate` nullable and the owner's rule is "a missing figure is a dash, never a zero" (`HANDOVER.md` § 5). `rates.ts:116`, `property.ts:180`, `inventorySetup.ts:647` do it right (`null`).
Meaning: a channel manager reading `GET /:code/rates` for an unpriced type would push ₹0 to OTAs.
Resolution: two one-line fixes; and point integrations at `rate-grid`/`rate-plans`, never `/:code/rates`.

**PMS-11 · note — Guests are one row per booking, matched by nothing.**
Evidence: `directory.ts:9-13` ("a row per booking … the merge rules are not decided"); `guests.phone` is free text with an index and no uniqueness or format check (`004:20, 50`); `groups.ts:317-322` always inserts. A guest is group-level (no `hotel_id`) and never deleted (`004:4-13`, `015`).
Meaning: the leads app cannot "look up a PMS booking" by guest; there is no guest id in the booking response (§ 3). For multi-tenancy, guests would be shared across customer groups (PMS-14).

**PMS-12 · note — Identifiers a mapping can use exist, but only `GET /:code/room-setup` exposes them.**
Evidence: `room-setup` returns room-type `id`, `code` and room `id`, `roomTypeId` (`inventorySetup.ts:587-659`); `room-types` and `rooms` return names only (`roomTypesAndPlans.ts:61-68`, `property.ts:173-189`); `inventory`, `rate-grid`, `rate-plans` return `roomTypeId` (uuid) and name. `hotels.code` is the public property key (`002:24`, `property.ts:8-11`). No external-id column on rooms or room types.
Resolution: a `room_types.external_refs jsonb` (or a `room_type_mappings(hotel_id, system, external_code, room_type_id)` table) when STAAH's definition arrives.

**PMS-13 · fix on the way — Adding a module is a migration on a CHECK plus two hard-coded lists.**
Evidence: `hotel_modules_known` (`041:32`, replaced in `087:106-108`); `app.module_enabled` treats an absent row as on for `pos`, off for everything else (`041:57-64`); the API's own lists at `moduleSwitches.ts:67, 82`; navigation reads `module:` on a section (`navigation.ts:206, 214, 310-316`) and the routers gate themselves (`pos.ts:107-109`; till/banquet not read). Production has rows for banquet and reception_pos.
Resolution: one migration adding `'crs','channel_manager','leads'` to the CHECK (as 087 did), the two lists in `moduleSwitches.ts`, a `module:` on a nav section, and a gate in the new router. Absent row = off, which is right for all three.

**PMS-14 · must decide — One deployment is one group; there is no organisation above `hotels`.**
Evidence: `hotels` is "the tenant registry. Seven rows today" (`002:17-20`); `staff`, `staff_hotels` (the access model, `002:73-91`), `guests`, `companies`, `booking_sources` (`082:17-22`), `meal_plans`, `reservation_groups`, `room_type_templates` (`013:268`) are group-level with no owner above them; `app.auth_hotel_ids()` gives a group admin every hotel (`002:122-136`); `hotels_read` is per roster (`031:58-69`). Fidato-specific behaviour (not test data): `FH-` reference prefix (`groups.ts:398`, `operations.ts:940`); `'Fidato Hotels'` as the label for `direct` (`082:181`) and the seeded source (`082:241`); POS service-account addresses `@fidatohotels.com` (`pos-outlet.ts:102`); the OTA/DIRECT name lists (`directory.ts:149-150`); the seed admin `REPLACE@fidato.in` (`008:43`); `PROPERTY_CODE = "5EL"` and `hotelId: "5EL"` in web fallbacks (`src/data/fixtures/property.ts:127`, `src/lib/ui.ts:53`); one Firebase project for sign-in (`HANDOVER.md` § 1).
Meaning: selling to another group means either a box per customer (works today: own database, own `CORS_ORIGIN`, own `api/.env`, ideally own Firebase project; the seeds 008/051 and the six literals above become data) or a shared deployment (an `organisations` table, `organisation_id` on the eight group-level tables and in `auth_hotel_ids`/`is_group_admin`, Firebase tenant separation).
Resolution: recommend one deployment per customer first (`MASTER-ARCHITECTURE.md` § 2: "run the seven first, sell second"); the shared model is a schema change of the expensive kind (`002:6-12`).

**PMS-15 · note — What the API tells a caller about "not built".**
Evidence: `src/pages/Placeholder.tsx:14-50` is routed by `App.tsx:211` `PROPERTY = []` — no placeholder is live today; the channel-manager page carries `StatusPill "Coming soon"`, three "what it will do" cards and four "what it needs" items (`ChannelManager.tsx:29-51, 75, 111-149`), with `listed: false` and keywords `staah, ota, channels` under resource `rate` (`channel-manager/nav.ts:8-10`); Administration → Integrations is a fixed list with STAAH and Fidato CRS "planned" (`adminLists.ts:121-145`). `listed: false` hides an entry from every sidebar but keeps it in Find a screen and by URL (`navigation.ts:39-44, 403-405`); `workingMenus` puts an entry into a restricted role's sidebar (`navigation.ts:57, 384-415`) and `navigation.test.ts` pins each role's list.
Meaning: a "Coming soon" entry per role is a nav entry with `workingMenus: [role]`, no `listed: false`, pointing at a page in the `ChannelManager.tsx` shape (a `PlaceholderPage` also works: it prints "Not built yet" and what the screen will carry) — and the pinned test changes with it.

**PMS-16 · fix on the way — A deploy replays the seed and re-creates an active placeholder group administrator (MEMORY 271).**
Evidence: `008_seed.sql:42-44` `on conflict (email) do nothing`; MEMORY 271. PENDING § 1a: asked, not answered.
Resolution: the small change already recommended in PENDING § 1a.

**PMS-17 · note — MEMORY 242 is guarded; a third booking door will be caught by a test, not production.**
Evidence: `api/test/modules/reservations/reservationInserts.test.ts` reads every `insert into reservations` under `api/src`. `037` freezes cancellation terms by trigger on every door.
Meaning: a CRS/CM router that inserts reservations must write `booking_source_id` or the suite fails; it must also open a folio (nothing enforces that; `groups.ts:431-445` explains why it matters) and not bypass PMS-4's shape.

**PMS-18 · note — No `TODO`/`FIXME` in the reservations, inventory, guests or front-desk routers.** The demo's rates are the live rates (Deluxe 3,699 · Superior 4,099 — PENDING § 2, `load-demo.ts:77`); anything that pushes rates pushes those.

**PMS-19 · note — The dev sign-in and the test logins cannot reach production.** `env.ts:45-52` throws at start-up when `ALLOW_DEV_AUTH=1` meets `NODE_ENV=production`; `auth.ts:61-64` reads `x-dev-staff-id` only under that flag; the web build fails if the test sign-ins are bundled. The Firebase path verifies with `checkRevoked = true` (`auth.ts:90`) and the subject is the raw uid (`auth.ts:13-16, 91`), resolved by `app.current_user_id()` through `staff.firebase_uid … and is_active` (`017:46-71`). A deactivated staff row resolves to nobody (401 at `auth.ts:129-131`), and `identity.ts:135-137` also disables the Firebase account.

## 3 · The booking request, exactly

`POST /api/hotels/:code/bookings` — `api/src/modules/reservations/groups.ts:248-463`. Bearer token (a person) or, today, nothing else. Content-Type `application/json`; an unparsable body is treated as `{}` (272).

| Field | Type | Required | Default / rule | Refusal (409 `{ok:false, reason}`) |
|---|---|---|---|---|
| `guestName` | string | **yes** (trimmed, non-empty) | one guest row for the whole booking | "Whose booking is it?" (275) |
| `phone` | string | no | `''` → NULL; free text, no format check, not unique | — |
| `email` | string | no | `''` → NULL (citext) | — |
| `checkIn` | string `YYYY-MM-DD` | **yes** | compared as strings; cast `::date` in SQL (a bad date is a 500, rolled back) | "Which nights?" (277) |
| `checkOut` | string `YYYY-MM-DD` | **yes** | must be `> checkIn` as a string; night of departure not charged | "A stay ends after it starts…" (280) |
| `bookingSourceId` | uuid | **yes** | must be an active `booking_sources.id` — checked *after* the guest is written (343-354) | "Where did this booking come from?…" (296) · "That booking source is not on the list any more." (353) |
| `source` | string | no | legacy free text; stored in `reservations.source`, else the source's name (418) | — |
| `businessSource` | string | no | blank → NULL | — |
| `marketSegment` | string | no | blank → NULL | — |
| `expectedArrival` | string `HH:MM` | no | blank → NULL; cast `::time` | — |
| `groupName` | string | no | used only when total rooms > 1; default `"<guestName> — <n> rooms"` (329) | — |
| `blockCode` | string | no | group's `block_code`; blank → NULL; becomes the reference stays show (`stays.ts:84-86,170`) | — |
| `lines` | array of Line | **yes**, ≥1 with a `roomTypeId` (lines without one are dropped, 285) | | "Which rooms?" (286) |
| `lines[].roomTypeId` | uuid | **yes** | must belong to this hotel (360-364, after writes) | "One of those room types is not here." |
| `lines[].mealPlan` | string | no | `"EP"`; FK to `meal_plans.code` — unknown code is a 500 (unmapped 23503) | — |
| `lines[].adults` | int | no | 1 | — |
| `lines[].children` | int | no | 0 | — |
| — | | | `adults + children ≤ room_types.max_occupancy` (368-372, after writes) | "N people will not fit a <type> — it sleeps M." |
| `lines[].rooms` | int | no | 1; `max(1, rooms)`; sum over lines ≤ 40 (301-308) | "N rooms in one booking looks like a mistake…" |
| `lines[].agreedRate` | number | no | if absent: `app.tariff_for(roomTypeId, mealPlan, checkIn, adults, children).total` — **first night only**; NULL total → refuse by name (381-394); if present: used as-is, `≥ 0` only (`005:48`) | "<type> has no price for <what>. Set it on the rate calendar, or enter a rate for this booking." |

Not accepted: a channel code, a guest id, a company id, an external reference, an idempotency key, per-night rates, room numbers, notes, nationality, cancellation terms (frozen by trigger 037 from the hotel's default), `is_complimentary`, status other than `confirmed`.

**Validation order.** Before the transaction: guestName → checkIn/checkOut present → order → lines non-empty → bookingSourceId present → total ≤ 40. Inside one transaction (`withUser`, `db.ts:47-70`): hotel code resolves (else `404 {error:"No such property."}`; `groups.ts:23-28` does not check `hotels.is_active`) → **INSERT guest** → **INSERT reservation_groups** if total > 1 → source active → for each line: room type here → party fits → tariff (or agreedRate) → for each room: reference → **INSERT reservation** (`status 'confirmed'`, `occupancy = adults+children`, `agreed_rate`, `source`, `meal_plan`, `group_id`, `business_source`, `market_segment`, `expected_arrival`, `booking_source_id`, `commission_pct` copied from `booking_source_rates` for this hotel or NULL) → **INSERT folio** (`status 'open'`). Trigger 037 freezes cancellation terms on each reservation. No posting, no room assignment, no guest document.

**Response 200:** `{ ok: true, groupId: uuid|null, rooms: n, guest: string, bookings: [{ reference: "FH-DDMM-NNNN", roomType: name, rate: number }], nightly: number }` (451-458). No reservation ids, no guest id, no folio ids are returned.
**Other answers:** 409 `{ok:false, reason}` (a refusal — *committed* if it came after a write, PMS-4); 404 `{error}`; 500 `{error:"Something went wrong. Nothing was changed."}` (true for a throw: rolled back).

**Idempotency contract, as it stands:** none. No header, no key column, no window; retry = duplicate booking (PMS-3). The reference is server-generated, unlocked, prefix `FH-`, `DDMM` of the server clock, 4-digit running counter from 5001 (397-401; PMS-5). The `idempotency-key` header the CORS list advertises (`server.ts:91`) is honoured only by work orders and banquet events (`062`).

## 4 · The availability and rates responses, exactly

All under `/api/hotels/:code/…`, bearer required, `:code` upper-cased; a code the caller may not see is a 404. Money and counts travel as JSON numbers; NULL is `null` unless noted.

**`GET /:code/inventory?from&to`** — `rates.ts:452-513`; `app.inventory_grid` (`044:171-214`) and `rate_restrictions`.
`from` defaults to the hotel's business date; `to` defaults to `from`; the window is clamped to 90 days (`windowFor`, 433-450).
```
{ from, to,
  cells: [{ roomTypeId: uuid, roomType: name, date: "YYYY-MM-DD",
            sellable: int, occupied: int, sold: int, available: int }],
  restrictions: [{ roomTypeId, date, stopSell: bool, closedArrival: bool,
                   closedDeparture: bool, minNights: int|null, maxNights: int|null }] }
```
Per **room type per date**. `sellable` = active rooms of the type minus rooms with a `room_blocks` row covering the date (`044:118-133`; blocks are inclusive of `to_date`, NULL = indefinite) — **housekeeping state (`out_of_order`, `out_of_service`) is not subtracted here** (the property card at `property.ts:84-88` uses a different rule). `occupied` = reservations of the type whose `[check_in, check_out)` covers the date and whose status is not cancelled/no_show/void — tentative, complimentary and checked-out included. `sold` = confirmed/checked_in/checked_out and not complimentary. `available = max(sellable − occupied, 0)`. Room types are not filtered by `is_active` (`044:187-189`). Restrictions appear only where a row exists; absent = unrestricted. No room numbers.

**`GET /:code/rate-grid?from&to`** — `rates.ts:515-578`; `app.rate_grid` (052) over `app.rate_for` (`033:101-120`). Window clamped to 90 days.
```
{ from, to,
  plans: [{ roomTypeId, roomType, mealPlan: code, mealPlanName }],
  cells: [{ roomTypeId, roomType, mealPlan, date, price: number|null,
            season: string|null, source: "rate"|"rack"|null }] }
```
`price` = covering `rates` row for type+plan+date, else `room_types.base_rate`, else `null`; `source` says which. Extra-person prices are **not** in this response.

**`GET /:code/rate-plans`** — `rates.ts:61-139`.
```
{ businessDate,
  roomTypes: [{ id, code, name, rackRate: number|null, maxOccupancy, rooms: int }],
  mealPlans: [{ code, name, includes }],
  rates: [{ id, roomTypeId, roomType, mealPlan, price, from: "YYYY-MM-DD",
            to: "YYYY-MM-DD"|null, label: string|null, setBy: string|null, isCurrent: bool }] }
```
Includes inactive room types (no `is_active` filter, 76-78). `to` is exclusive (half-open ranges throughout, `033:52-56`). `extra_adult`/`extra_child` (057) are not returned.

**`GET /:code/tariff?roomType&from&to&adults=1&children=0&mealPlan=EP`** — `rates.ts:669-745`. One row per night from `app.tariff_for` (`057:92-153`):
```
{ roomType: name,
  nights: [{ night, base: number|null, extraAdults: int, adultRate: number|null,
             extraChildren: int, childRate: number|null, total: number|null, unpriced: string|null }],
  total: number|null, unpriced: string|null }
```
409 when the type is not here or the party exceeds `max_occupancy`. One unpriced night makes the stay's `total` null.

**`GET /:code/rates?from&days=14`** — `rateGrid.ts:26-114` ("Rate performance"; note the path). `days` is not clamped.
```
[{ roomType: name, rackRate: number,
   cells: [{ date, rackRate: number, soldAdr: number|null, sold: int, sellable: int }] }]
```
`rackRate` is `Number(base_rate)` — **`0` when unpriced** (PMS-10). Active types only. Do not feed a channel manager from this.

**`GET /:code/room-types?asOn`** — `roomTypesAndPlans.ts:29-72`: `[{ type: name, rooms, sellable, maxOccupancy, rackRate (0 when null — PMS-10), numbers: [room numbers] }]` — no ids; active types with ≥1 active room.

**`GET /:code/rooms`** — `routes/property.ts:124-193`: `[{ number, type: name, floor (0 when null), status: "clean"|"dirty"|"inspected"|"out-of-service"|"out-of-order", maxOccupancy, rackRate: number|null, blocks: [{ id, from, to|null, reason }] }]` — no room id, no type id; active rooms.

**`GET /:code/room-setup`** — `inventorySetup.ts:587-659` — the one response with every identifier a mapping needs:
```
{ frontDesk: { checkInTime, checkOutTime, earlyCheckinCharge|null, lateCheckoutCharge|null },
  types: [{ id, code, name, baseOccupancy, maxOccupancy, sortOrder, isActive, rackRate|null, rooms, sellable }],
  rooms: [{ id, number, roomTypeId, roomType, floor, smoking, isActive, occupied: bool }] }
```

**`GET /api/hotels`** — `routes/hotels.ts:32-88`: `{ scope: {staffId, email, fullName, isGroupAdmin, hotels: [{hotelId, role}], homeScreen, roomGrouping, startHereDismissed}, hotels: [{ id, code, name, city, state, gstin, timezone, currency, checkInTime, checkOutTime, businessDate }] }` — each hotel's own operating day.

**`GET /:code/live`** — SSE, events `ready {live}`, `changed "1"`, `beat` (`live.ts:69-97`); fires for POS tables only (PMS-9).

## 5 · Decisions the owner must make

1. **How outside systems identify themselves.** Recommend: an API key per integration per hotel (an `integrations` table in the `pos_outlets` shape, a service-account staff row, a fourth mount prefix) — not a Firebase login for n8n. A "Viewer" login is not read-only on this server (PMS-2).
2. **The idempotency key for inbound bookings.** Recommend: the sender's own reference (`external_ref`, unique per booking source), answered with the original booking on a retry — the POS contract already works this way (`docs/POS-INTEGRATION.md`).
3. **RES-1 / PMS-4.** Recommend fixing before any machine calls the route: validate everything, then write; a test that proves no guest survives a refusal.
4. **Whether an integration may set the price** (`agreedRate`) and whether the PMS should enforce stop-sell, CTA/CTD, min-nights and `available` for machine callers. Recommend: OTA/CRS bookings carry their quoted price and their source; restrictions enforced for machines, not for the desk.
5. **Multi-night pricing.** Today the first night's tariff is stamped for every night. Recommend: when no price is sent, average `app.tariff_for` over the nights (or refuse with the unpriced night named).
6. **One rate for all channels, or a rate per channel.** The rate model is room type × meal plan × date (`033:13-23`); a per-channel rate is a migration. Recommend: one rate, adjusted by commission, until an OTA contract says otherwise.
7. **Push or poll.** Recommend: an outbox table drained by n8n (PMS-9); the leads app then holds a *copy* it treats as advisory — the PMS stays the one source.
8. **Module switches for `crs`, `channel_manager`, `leads`** — one migration and two lists (PMS-13). Recommend yes, absent = off.
9. **The demo rates (3,699 / 4,099)** must be confirmed as the hotel's before anything pushes them (PENDING § 2).
10. **Guest matching for inbound bookings** — a new row per booking today; merge rules undecided. Recommend: match nothing yet, store the sender's guest id, decide merging with real data.
11. **Where the booking engine lives** (CRS or PMS — `booking-engine/MODULE.md`) and whether the CRS's Firestore keeps a copy of PMS bookings.
12. **Multi-tenant shape** — recommend one deployment per customer now (PMS-14).
13. **A rate limit on the API at nginx**, as n8n's webhooks already have. Recommend yes before any key is issued.
14. **Deactivate `REPLACE@fidato.in` / guard 008** (PMS-16) — already asked in PENDING § 1a.

## 6 · Things I could not verify

- **The Firebase project the API verifies against.** `auth.ts` names no project; it comes from `FIREBASE_SERVICE_ACCOUNT` in `api/.env`, not opened. `HANDOVER.md` § 1 says `poms-fad05`.
- **Production `CORS_ORIGIN`**, and whether a provisioning key is minted on the box — both live in the server's environment / a table with no read policy.
- **RES-1 was confirmed by reading, not reproduced.**
- **Test counts** (359 / 197 / 588) are `HANDOVER.md` § 2's, not re-run.
- **`app.rate_grid` (052)** — column semantics taken from `rates.ts:529-536`; the migration itself was not opened.
- **The till's and banquet's module gates** — not read.
- **The live nginx on the box** — certbot rewrites `deploy/nginx.conf` in place, so the file is the starting point, not necessarily what runs.
- **STAAH's inbound/outbound definition** — arrives 16 September; every mapping recommendation waits on it.
- **Screens** — nothing was opened in a browser.
