# Can the live inventory + leads app and the PMS be connected? — read-only audit, 15 September 2026

Written by an agent for `docs/HMS-INTEGRATION-PLAN.md`. Nothing was written,
built, deployed or committed. No `.env*`, `src/firebaseConfig.js`,
service-account file or key was opened. Credentials seen named but not opened:
`D:\fidato pms\api\.env`, `D:\fidato tools\new live invetory\src\firebaseConfig.js`
and that folder's `.env` / `.env.development.local`.

The production fact read on 15 September is used for the PMS side of 5 Elements
(18 rooms, two types, modules banquet and reception_pos); the demo snapshot is
cited only where it shows a data shape.

---

## 1. Facts measured

### The PMS (`D:\fidato pms`)

| Thing | Measured | Where |
|---|---|---|
| Hotels in production | 1: `5EL` "5 Elements Akkalkot" | read on production; `HANDOVER.md` § 1 says one property live of a group of seven |
| Hotel id format | `hotels.code`, `^[A-Z0-9]{2,10}$`, unique; uuid primary key | `db/migrations/002_tenancy.sql:22-39` |
| Room types at 5EL | 2: Superior (10 rooms), Deluxe (8 rooms) | production |
| Rooms at 5EL | 18: Superior 201-210, Deluxe 301-308 | production |
| Modules on at 5EL | banquet, reception_pos | production; `hotel_modules` knows `pos`, `banquet` (`041_hotel_modules.sql:20-34`); reception_pos is the per-hotel switch of 087 |
| Roles | 13 identifiers: 12 assignable (`app.assignable_roles()`) + `automation` (system, never assignable) | `src/lib/permissions.ts:24-48`; `db/migrations/078_roles.sql:71-90` |
| Role scope | one row per person per hotel (`staff_hotels.role`); `staff.is_group_admin` overrides | `002_tenancy.sql:54-91` |
| Identity | Firebase project `poms-fad05`; API verifies ID tokens and joins `staff.firebase_uid` | `HANDOVER.md` § 1; `api/src/auth.ts:26-35, 58-104`; `017_production_readiness.sql:17-27` |
| Known accounts | `demo@fidatohotels.com` (owner at 5EL, shared password, left on); `n8n@fidatohotels.com` (Viewer) planned, does not exist | `HANDOVER.md` § 2; `PENDING.md:118-120` |
| Database | Postgres with RLS; 89 migrations (`001`…`089`); no Firestore anywhere in `src/` or `api/src` (grep) | `db/migrations/` |
| Tests (owner's machine, 15 Sep) | db 588 assertions; 89 migrations re-runnable; api 359 passed / 28 files; web 197 passed / 13 files; `tsc -b` clean | `HANDOVER.md` § 2. Counted: 28 files in `api/test`, 19 `*.test.ts(x)` under `src/` |
| API / screens / services | 214 routes; 73 screen addresses; 18 service folders (13 built, 5 brief-only incl. `crs`, `guest-messaging`) | `HANDOVER.md` § 3.0 |
| Deployed version | commit `1c2e5d0`, 15 Sep (API 13:09 GMT); branch `service-folders` built, not merged, not deployed | `HANDOVER.md` § 2 |
| n8n | on the PMS box, image `n8nio/n8n:2.38.5` in a Podman container, local mode `127.0.0.1:5678`, `n8n.fidatohotels.com` has no DNS record; cannot reach Postgres; reaches the PMS only as a staff account over `https://api.fidatohotels.com`; nightly backup 03:30 | `deploy/n8n.sh:63-83, 97, 233, 283-299`; `PENDING.md:19, 25, 118-122` |
| Machine access to the API | bearer ID token (poms-fad05) on `/api/*`; POS outlet key (`x-pos-key`, sha256 hash in `pos_outlets.api_key_hash`) on `/api/pos` only; CORS = one origin from `CORS_ORIGIN` (comma list supported) | `api/src/server.ts:61-67, 146-180`; `api/src/modules/pos/pos.ts:60-62, 93`; `024_pos_bridge.sql:230-258`; `api/src/env.ts:78-81`; `deploy/launch.sh:377, 387` |

### The live inventory + leads app (`D:\fidato tools\new live invetory`)

| Thing | Measured | Where |
|---|---|---|
| Hotels | 6, hard-coded: Grand Lucent Mathura 22, Hilltop Panhala 27, Amrapali Kolhapur 16, Majestic Grand Shimla 34, Hilltop Shilaroo Narkanda 19, 5 Elements Akkalkot 17 = 135 rooms; ids are slugs (`five-elements-akkalkot`) | `src/hotels.js:17-151` |
| Room types | 20 across the six (2+5+5+2+3+3); 5 Elements has 3: Deluxe (206, 306, 405), Superior (201-205, 301-305, 401, 402, 404), Family Suite (403); a type's `total` is the length of its room list | `src/hotels.js:123-150, 155-157`; `src/lib/seedInventory.js:21-35` |
| Roles | 7 values: pending, admin, owner, gm, staff, sales, marketing; ONE role per user for all their `hotelIds[]`; super admin hard-coded as `admin@fidatohotels.com` in both places (README still says `owner@`) | `src/constants.js:7-21, 63`; `firestore.rules:29-31, 66-96`; `README.md` "Super admin" |
| Identity | Firebase project `live-inventory1`, email/password, `users/{uid}` + `invites/{email}`; user counts in production not visible | `.firebaserc`; `src/hooks/useUserRole.js`; `src/lib/adminUsers.js` |
| Firestore collections | 14 top-level (users, invites, contacts, messageTemplates, outboundIndex, numberMappings, conversations, settings, integrationErrors, integrationStatus, auditLog, hotels, and legacy roomTypes, availability) + 6 subcollections (conversations/{messages, events, calls}; hotels/{roomTypes, availability, team}); 1 composite index | `firestore.rules` (every `match`); `firestore.indexes.json` |
| Availability record | `hotels/{h}/availability/{date}_{roomTypeId}` = `{date, roomTypeId, available, stopSell}`; absent doc = fully available; written in batches of 450 | `src/lib/paths.js:17-19`; `src/lib/availabilityWrites.js:7-28`; `src/hooks/useInventory.js:35-74` |
| Code | 48 JS/JSX files, 8,143 lines; no TypeScript; 8 routes (`/`, `/edit`, `/inbox`, `/inbox/:id`, `/reports`, `/revenue`, `/admin`, `/activity`) | `find`/`wc`; `src/App.jsx:141-175` |
| Version control | none; 4 dated copies in `..\new live invetory - backups\` | `ls`; `DEFECTS.md` D-008, D-028 |
| Tests | `npm test` = oxlint + 4 scripts (rules, n8n pipeline, render, app flows); documented 229 checks (rules 96, n8n 92) needing the Firestore emulator + `fake-n8n`; nothing was run | `package.json`; `PROGRESS.md`; `n8n/README.md` |
| Bundle | `dist/assets/index-Cot1gcqG.js` = 968,273 bytes, built 14 Sep 14:40, single chunk, NOT deployed; live site still serves the 10 Sep build | `ls -la dist/assets`; `dist/index.html:8`; `PROGRESS.md` |
| n8n | Hostinger `https://n8n.srv1114484.hstgr.cloud`; 4 importable workflows A (24 nodes), B (3), C (11), D (9) built from 20 Code-node files; 2 credentials by name; Meta token to regenerate by ~27 Sep 2026; test number ID `1266660199861930` routed to Panhala; production number +91 97671 43965 not yet on the Cloud API | `n8n/README.md`; `n8n/workflows/*.json`; `PROGRESS.md` |
| Standing instructions | live inventory screens FROZEN; only `admin@` reaches Admin; no em dashes in anything a user sees; plan first then wait; don't deploy or push unless asked | `DEFECTS.md` "Standing instructions" |

---

## 2. Incompatibilities

Severity: **blocks**, **must decide**, **fix on the way**, **note**.

### Live inventory (LI)

**LI-1 · blocks · The two systems describe a different 5 Elements Akkalkot: 18 rooms in two types (PMS) against 17 rooms in three types (live inventory), and only six room numbers agree on their category.**

Evidence. PMS production: Superior 201-210; Deluxe 301-308. Live inventory `src/hotels.js:128-149`: Deluxe 206, 306, 405 ("Single occupancy only"); Superior 201-205, 301-305, 401, 402, 404 ("Double occupancy, 1 extra mattress"); Family Suite 403 ("Sleeps 6 pax"). `README.md` prints 17.

Precisely:
- Rooms in the live inventory that do not exist in the PMS (5): **401, 402, 403, 404, 405** (a whole fourth floor).
- Rooms in the PMS that do not exist in the live inventory (6): **207, 208, 209, 210, 307, 308**.
- Room numbers in both (12): 201-206 and 301-306. Of these, the category agrees for 6 (**201-205 Superior; 306 Deluxe**) and disagrees for 6: **206** is Deluxe in the live inventory and Superior in the PMS; **301-305** are Superior in the live inventory and Deluxe in the PMS.
- Room types: the live inventory's **Family Suite** does not exist in the PMS; per-type counts are Deluxe 3 / Superior 13 / Family Suite 1 (live inventory) against Superior 10 / Deluxe 8 (PMS).

What it means. A PMS to live-inventory feed keyed on room type would put the PMS's 8 Deluxe into a slot whose `total` is 3 (`hotels/{h}/roomTypes/deluxe.total`, written from the room list by `src/lib/seedInventory.js:26`), and the Dashboard's occupancy is `(total - available) / total` (`src/pages/Dashboard.jsx:30-39`), so the figures would be nonsense before a single line of integration code is wrong. The 022 migration's own note records that the real Monthly Statistics export showed 17 sellable rooms on most days and 18 on some (`022_room_blocks.sql:7-13`), which is consistent with 18 physical rooms with one often blocked, not with a fourth floor.

Resolution. The owner states which list is the hotel. If the PMS is right, the live inventory entry for Akkalkot must be corrected to the PMS's two types and 18 rooms before any feed, and the roomTypes docs re-seeded (Admin → Re-sync writes with `merge: true`, `seedInventory.js:22-33`). If the fourth floor is real, the PMS's Room types screen needs it added first. Either way the frozen `src/hotels.js` has to change for this one hotel, or the feed must own the roomTypes docs for PMS hotels (LI-3).

**LI-2 · must decide · Hotels have no shared identity: a kebab slug on one side, a 2-10 character upper-case code on the other, and no column anywhere to hold the other side's id.**

Evidence. `src/hotels.js:123` `id: "five-elements-akkalkot"`; the slug is embedded in every conversation id (`src/leads/model.js:143-145`; `n8n/2-route-to-property.js:48`), in `users.hotelIds`, `contacts.hotelIds` (`n8n/3-build-firestore-commit.js:127`), `numberMappings.hotelId`, `settings/alerts` and `settings/assignment` maps keyed by hotel id (`n8n/sweep-2-decide.js:63-68`; `assign-2-pick.js:52`), and `hotels/{id}/team`. PMS `hotels.code` must match `^[A-Z0-9]{2,10}$` (`002_tenancy.sql:38`); no `slug`, `external_id` or similar column exists in any of the 89 migrations. The Firestore hotel doc holds only `{name, city, order}` (`seedInventory.js:14-17`).

Resolution. Add one field to the Firestore hotel doc, e.g. `pmsCode: "5EL"` (hotels are admin-write only, `firestore.rules:443-445`; the seed merges, so the field survives a re-sync), and keep the mapping only there; the PMS needs no change for this.

**LI-3 · fix on the way · Room types are slugs with a room list on one side and uuids with a code on the other; the feed must also own each type's `total`.**

Evidence. Live inventory `roomTypes/{deluxe|superior|family-suite}` with `total`, `rooms[]`, `order`, `notes` (`seedInventory.js:21-33`). PMS `room_types` has uuid `id`, `code`, `name`, unique `(hotel_id, code)` (`003_rooms.sql:14-29`); `GET /:code/inventory` keys cells by `roomTypeId` (uuid) and `roomType` (name) (`api/src/modules/inventory/rates.ts:484-498`). The live inventory reads `rt.total` as the capacity for every absent date (`Dashboard.jsx:11`, `EditAvailability.jsx:57`, `reporting.js:19`).

Resolution. Match by name at first (both say "Deluxe" and "Superior"), and let the feed write `roomTypes/{id}.total` from the PMS's active room count per type (the `rooms` figure in `GET /:code/rate-plans`, `rates.ts:74-76, 118`) so absent dates read as the PMS's capacity. Add `pmsRoomTypeCode` to the roomTypes doc when the owner unfreezes the seed.

**LI-4 · must decide · "Available" is a number a person types on one side and a number the database derives on the other; the feed has to write every date, not just changed ones.**

Evidence. Live inventory: `available` is typed with steppers (`EditAvailability.jsx:101, 123`), absent doc = `total` (`Dashboard.jsx:8-14`; `reporting.js:5-19`). PMS: `app.inventory_grid` returns `available = greatest(sellable - occupied, 0)` where sellable = active rooms minus `room_blocks` covering the date (`022_room_blocks.sql:98-113`; `044_restrictions.sql:118-138`) and occupied counts every reservation not cancelled/no_show/void over `[check_in, check_out)`, including tentative and complimentary (`044_restrictions.sql:171-214`); `GET /:code/inventory` returns `cells[]` and `restrictions[]` for a window (`rates.ts:452-513`).

What it means. The two numbers mean the same thing (rooms left to sell) so the screens need no change, but because absence means "full", a feed that writes only changed cells would show a full house the day a block ends. The feed must write `{date, roomTypeId, available, stopSell}` for every date in its horizon (the exact shape `availabilityWrites.js:19-24` writes), e.g. 2 types × 365 days = 730 docs per refresh.

Resolution. Decide the horizon (recommend 365 days) and refresh interval (recommend every 15 minutes plus on demand). For a PMS hotel the PMS is the record; see LI-5.

**LI-5 · must decide · Stop sell has the same grain on both sides, but at a PMS hotel a human can still overtype the fed values in Edit Availability, and nothing stops them.**

Evidence. Live inventory `stopSell` per date × room type (`paths.js:18-19`; `EditAvailability.jsx:111, 192`); PMS `rate_restrictions.stop_sell` per date × room type (`044_restrictions.sql:31-57`), plus `closed_arrival`, `closed_departure`, `min_nights`, `max_nights`, which the live inventory has no field for; room-level blocks are `room_blocks`. Live-inventory writes to availability are allowed for owner/gm/admin at any hotel (`firestore.rules:452-455` via `canEdit`, `:86-89`); the Edit screen has no notion of a hotel being fed.

Resolution. Mark PMS-fed hotels (`pmsFed: true` on the hotel doc) and refuse browser writes for them: one condition on the availability write rule (a single `get()` of the hotel doc; the availability rule is two lines today, nowhere near the 1,000-expression limit that D-025 hit on the lead rule at `firestore.rules:98-186`), and hide the Edit button for those hotels. Both touch frozen things, so it is the owner's call.

**LI-6 · must decide · Where the feed runs, and where the live-inventory1 service-account key lives.**

Evidence. Writing Firestore from a server needs a Google service account for project `live-inventory1` (the rules are bypassed by it, `firestore.rules:243-245`; the n8n workflows already do this). Reading the PMS needs a poms-fad05 identity. Candidates: (a) the PMS box's n8n, which reaches the PMS over the public API (`deploy/n8n.sh:81-83`) and can hold the Firestore credential in its encrypted store; a scheduled poll needs no inbound webhook, so the missing DNS record does not block it. (b) The PMS API process with a second firebase-admin app: a new secret in `api/.env` and a Firestore dependency in a codebase that has none. (c) The Hostinger n8n polling the PMS.

Resolution. Recommend (a). Note the `automation` role cannot be used as it stands: it is in `permissions.ts:37, 43` but not in `app.assignable_roles()` (`078_roles.sql:76-89`), so `staff_hotels_role_valid` would refuse it — a migration is needed to make it grantable.

**LI-7 · note · The Firestore rules budget is not the constraint; the frozen-screens instruction is.**

Evidence. A service-account writer costs zero rule expressions. The lock in LI-5 costs one `get()` on a two-line rule. D-025's 1,000-expression failure was in `leadUpdateAllowed()` (`firestore.rules:168-186`), which the feed does not touch. But `DEFECTS.md` freezes Dashboard, Edit Availability, Reports, OccupancyCalendar, `useInventory`, `availabilityWrites` and `src/hotels.js`.

Resolution. The owner explicitly unfreezes: `src/hotels.js` (Akkalkot entry), `EditAvailability.jsx` (hide for fed hotels) and `firestore.rules` (availability write lock). Nothing else needs touching.

**LI-8 · fix on the way · The PMS answers 90 days of inventory per request; the live inventory shows any month, years ahead.**

Evidence. `windowFor` clamps `to` at 90 days (`rates.ts:433-450`); `README.md` "Dashboard": "a month occupancy calendar (any month, years ahead)".

Resolution. The feed pages in 90-day windows (4 or 5 requests per refresh for a year).

**LI-9 · must decide · Users, roles and logins do not line up: three Firebase projects, a role per person versus a role per hotel, two role vocabularies, and a super admin hard-coded by email.**

Evidence. Live inventory: one `role` per user applied to every hotel in `hotelIds[]` (`useUserRole.js:34-40`; `firestore.rules:66-71`); 7 roles (`constants.js:7-21`); `sales` and `marketing` are view-only, `staff` works leads but not inventory; `admin` is global. PMS: role per hotel in `staff_hotels` (`002_tenancy.sql:79-91`), 12 assignable roles with no sales/marketing role and no "pending"; `is_group_admin` is the global flag; `admin` in the PMS is a per-hotel role. Super admin: `admin@fidatohotels.com` in `constants.js:63` and `firestore.rules:30`. The only common key is the email address (`staff.email citext unique`, `002:56`; `users.email` lowercased, `useUserRole.js:28`).

Mapping on paper: admin→admin (but global vs per hotel), owner→owner, gm→gm, staff→front_desk (nearest), sales/marketing→read_only (nearest), pending→a PMS staff row with no `staff_hotels` rows.

Resolution. Until LI-10 is settled, join people by email and keep two logins. Recommend that the PMS's `staff_hotels` becomes the source of who works where; the live inventory's role is then derived rather than typed.

**LI-10 · blocks (for one login) · A poms-fad05 sign-in cannot reach live-inventory1's Firestore, and a live-inventory1 sign-in cannot reach the PMS API.**

Evidence. Firestore rules read `request.auth` from their own project's Auth only (`firestore.rules:19-31`); the PMS API verifies tokens with the firebase-admin app built from the poms-fad05 service account and answers "Token rejected." for any other project (`api/src/auth.ts:31-33, 89-103`). CORS allows one origin, so a browser at `live-inventory1.web.app` is refused before the token is even checked (`server.ts:61-67`).

What it means. "One login across all of it" requires the CRM's Firestore and Hosting to move into project poms-fad05 (new database there, redeployed rules and index, data copied, n8n credentials re-issued, `.firebaserc` and `firebaseConfig.js` changed) or the CRM front end to stop talking to Firestore and talk to the PMS API instead. Neither is a small step.

Resolution. Decide the identity project now (recommend poms-fad05, because the PMS already creates and binds accounts, `identity.ts`, and closed the takeover hole in 088) and schedule the move before a second hotel group; do not build cross-project token tricks in the meantime.

**LI-11 · note · Engineering shape: no git, no TypeScript, tests that need an emulator, one 945 KiB chunk, and two owner rulebooks that differ on em dashes.**

Evidence. No git; 4 dated copies; D-008 lost a function to a scripted delete with nothing to diff against. 48 JS/JSX files, 8,143 lines, no types; the lead document's roughly 60 fields exist only as what `api.js` and the n8n Code files happen to write. `npm test` needs the emulator and `fake-n8n`. Bundle 968,273 bytes, one chunk. The PMS repo's gates would refuse this code as-is: `npx tsc -b` (JS), `src/test/boundaries.test.ts` (front doors), the repositories seam (screens read data only through `@/data/repositories`; live-inventory screens subscribe to Firestore directly, `useInventory.js:17`, `leads/hooks.js:44`), `primaryAction.test.ts`. Em dashes: the live inventory rule forbids them in anything a user sees (59 lines still carry one across 25 files in `src/`, 16 visible on the frozen pages per D-026); the PMS's `.tsx` files carry one on 856 lines. Undeployed 13-14 Sep work: rules and hosting must ship together, indexes must not (`PROGRESS.md`; D-017), and the owner has not yet signed in to the local preview.

Resolution. `git init` the live-inventory folder now (harmless, local only). Do not fold it into the PMS repo until it is TypeScript and reads through the seam; if folded, the leads CRM is a candidate `crm` service folder, the inventory screens are not (they duplicate PMS screens). Ask the owner whether the em-dash rule is global.

**LI-12 · note · Replicating for another hotel group: the app is wired to one Firebase project, one super-admin email, one app URL and one hard-coded hotel list.**

Evidence. Project id `live-inventory1` is a constant in 10 n8n Code files; `DEFAULT_APP_URL` in `settings.js:17` and `sweep-2-decide.js:25`; super admin in `constants.js:63` and `firestore.rules:30`; hotels in `hotels.js`. The PMS is multi-tenant by design (one INSERT onboards hotel #8, `002_tenancy.sql:17-21`) but group-level tables mean one group per database (`082_booking_sources.sql:17-22`; `004_guests.sql:1-13`).

Resolution. For a product: one deployment (PMS database + Firestore project + n8n) per hotel group, with the constants above turned into configuration first.

### Leads CRM (LD)

**LD-1 · blocks (for the Booked handshake) · "Booked needs a reference" stores any non-empty text; nothing ties it to a PMS booking, and the PMS has no way to look a booking up by its reference.**

Evidence. `setStatus` writes `bookingRef: extra.bookingRef ?? null` (`src/leads/api.js:218-221`); the rule only requires a non-empty string (`firestore.rules:114-120`); the screen enables the button on any text (`Conversation.jsx:410-427`). PMS references: `FH-DDMM-NNNN` from a counter starting at 5000 (`groups.ts:397-400`) and `CODE-000123` from `app.next_reference` (`005_reservations.sql:147-171`); unique per hotel (`005:45`). `GET /:code/stays/:id` takes the uuid, not the reference (`stays.ts:269-287`); `GET /:code/stays` returns every stay with its `reference` (`stays.ts:170`) but no filter.

Resolution. Do not ask staff to type a PMS reference by hand. Recommend the reverse direction: the PMS booking records the lead (one nullable column, LD-5) and a nightly job stamps `pmsReference`, `pmsReservationId` and the figures of LD-3 onto the conversation, keeping the typed `bookingRef` as the person's own note. If a lookup is still wanted, it is a new endpoint (`GET /:code/stays?reference=`).

**LD-2 · fix on the way · A Booked lead with no value is stored as ₹0 and counted as ₹0, which is the exact thing the PMS forbids.**

Evidence. `bookingValue: Number(extra.bookingValue) || 0` (`api.js:220`); Revenue sums `Number(c.bookingValue) || 0` (`revenue.js:103, 182`); the Booked button needs only a reference (`Conversation.jsx:426`). PMS rule: a missing figure is a dash, never a zero (`HANDOVER.md` § 5; `032_no_default_prices.sql`).

Resolution. Store `null` when blank and show a dash; count "booked, value unknown" separately. Both files are part of the 13-14 Sep undeployed work.

**LD-3 · must decide · What "PMS-confirmed revenue" means, and over which period.**

Evidence. The live inventory's figure is one number typed at Booked time, reported by lead cohort (`revenue.js:12-20, 87-89`). The PMS has two candidates: the agreed rate on the booking (`reservations.agreed_rate`, snapshotted, `005_reservations.sql:31-34`; `offeredTariff` and `nights` in `stays.ts:160-165, 201`) which is an expected figure at booking, and the append-only ledger after the stay (`folio_postings`, `006_folio.sql:110-113`) which is the realised figure. PMS reports run by `business_date`; the CRM's by `receivedAt`. FR-090 wants the typed and confirmed figures kept apart (`revenue.js:18-20`).

Resolution. Recommend two new conversation fields, `pmsExpectedRevenue` (agreed rate × nights at booking) and `pmsRealisedRoomRevenue` (room postings after check-out), shown beside the typed value; the Revenue page keeps its cohort window. Both fields added to `lockedLeadFields()` (`firestore.rules:107-111`) so a browser cannot write them.

**LD-4 · fix on the way · The PMS needs a booking source for a WhatsApp lead; today it has six, none of them a messaging channel.**

Evidence. Seeded sources: Fidato Hotels (direct), Walk-in, Booking.com (BDC), go-MMT (GOMMT), Agoda (AGODA), Expedia (EXPEDIA) (`082_booking_sources.sql:240-247`); kinds allowed: ota, direct, corporate, travel_agent, walk_in, other (`082:64-66`); every booking must name one (`groups.ts:261`, MEMORY 242); commission is per property and NULL means not agreed (`082:102-118`). A manager adds one with `POST /:code/booking-sources`.

Resolution. Add "WhatsApp lead", kind `direct`, `channel_code` `WHATSAPP`, commission null. Add a separate "Meta ad (click-to-WhatsApp)" source only if the owner wants ad-attributed bookings split in the PMS's source-mix report; ad spend is not a commission percentage.

**LD-5 · must decide · The PMS reservation has nowhere to hold the lead id, campaign id or click id.**

Evidence. Attribution captured by the CRM: `source`, `campaignId`, `ctwaClid`, `sourceUrl`, `referralHeadline`, `attributionStatus`, `firstTouch`, `latestTouch` (`n8n/3-build-firestore-commit.js:160-165, 179-195`; `1-normalise-inbound.js:92-109`). PMS `reservations` has `booking_source_id`, `commission_pct` (`082:128-135`), free-text `source` (`005:37`), `ota_reference` (`005:38`), `business_source`, `market_segment`, `sales_person` (`042_void_and_sources.sql:100-103`), `notes`; no campaign, click-id or UTM column in any migration.

Resolution. Keep attribution in the CRM (it already stores first and latest touch). Put only the lead id on the PMS booking: one new nullable column (e.g. `lead_id text`) in a new migration with its number claimed in `HANDOVER.md`, and accept it on `POST /:code/bookings` so the Conversation page can deep-link "Book in PMS" with the lead id, name and phone pre-filled. Misusing `ota_reference` or `notes` for it is quicker and worse.

**LD-6 · must decide · A guest is a phone number in the CRM and a name-with-optional-phone in the PMS; there is no phone lookup, no normalisation, and different visibility rules.**

Evidence. CRM: `normalisePhone` strips non-digits, drops a leading 0 from 11 digits, prefixes `91` to 10 digits (`model.js:114-119`); `contacts/{digits}` with `phone "+91…"`, `waId`, `name`, `hotelIds[]`, `conversationIds[]`; readable only by people at a property the guest wrote to (`firestore.rules:248-254`). PMS: `guests.phone text`, indexed raw (`004_guests.sql:20, 50`); the booking screen stores whatever was typed or NULL when blank (`groups.ts:317-321`); a walk-in stores the name only (`front-desk/operations.ts:932`); no normalisation anywhere in `api/src`; guests are group-level, never deleted, readable by any active staff member (`004:1-13`; `013_policies.sql:151-157`); `GET /:code/guests` groups by name and has no phone search; duplicates are shown, not merged, by decision (guests `MODULE.md`).

Resolution. One PMS endpoint that finds guests by normalised phone (`regexp_replace(phone, '\D', '', 'g')` with the same 91 rule), and store `+91…` digits when the desk types a phone. The owner decides which side is the central CRM record: recommend the PMS guest row (group-level, permanent), with the CRM's `contacts` doc carrying `pmsGuestId` after a match; and decide whether the CRM's per-property scoping should stay (it is stricter than the PMS's).

**LD-7 · note · The PMS's guest-messaging brief and the CRM's conversation screen would build the same WhatsApp plumbing twice.**

Evidence. PMS brief: outbound only (confirmation, pre-arrival note, bill, thank-you), not built, "how WhatsApp and email should send" undecided (`src/modules/guest-messaging/MODULE.md`; `HANDOVER.md` § 3.5). CRM: workflow C sends text or approved templates via Graph API v23.0 exactly once (`n8n/send-2-prepare.js:13, 49-73`; `send-3-claimed.js`), honours the 24-hour window (`model.js:211-223`), records delivery receipts (`status-*.js`), keeps the template list (`messageTemplates`) and the per-property sending number (`propertyNumberId`). A booking made at the desk with no conversation has no sending number and workflow C marks it failed (`send-2-prepare.js:74-93`).

Resolution. When the owner decides § 3.5, the answer "through the CRM's workflow C, by writing a PENDING outbound message on the guest's conversation (creating one with `routingMethod: manual` if none exists)" is already tested code; the PMS would then hold no WhatsApp token at all.

**LD-8 · must decide · Machine-to-machine: what each side must add.**

PMS side: an identity for the machine and a way to present it (the API has no long-lived key except the POS outlet key on `/api/pos`), and, only if a browser will ever call the API from the CRM's origin, that origin in `CORS_ORIGIN`. For the PMS to be written to by machine, the identity needs more than a Viewer's grant.

CRM side: a service account for live-inventory1, entered once in whichever n8n runs the feed, plus the two locked-field additions of LD-3.

Resolution. Recommend the PMS box's n8n as the only machine that holds both credentials.

**LD-9 · must decide · Two n8n instances; what moves if they become one.**

Evidence. Hostinger holds or will hold: workflows A-D, the old July workflow, the Firestore credential and the WhatsApp token, and Meta's callback URL points at it. The PMS box's n8n: 2.38.5 pinned, no public name yet, webhooks answer nobody until `n8n.fidatohotels.com` resolves (`deploy/n8n.sh:41-43, 303-316`), then screen locked to the owner's address and webhooks open at 10 requests/second per address with burst 40 (`n8n.sh:443, 476-481`), 1 CPU and 2 GB (`:239`). Workflow D runs every minute. The JSON files were never test-imported (EXECUTION-PLAN N5 unticked). Meta token renewal by ~27 Sep 2026.

What moves. Two credentials re-entered by hand (secrets are never exported), four JSON imports, the error-workflow setting on A/C/D, Meta's callback URL, the send address in the CRM's Admin → Settings (`settings/integrations.sendWebhookUrl`, `settings.js:11-17`), and deactivation of the Hostinger copies.

Resolution. Recommend consolidating onto the PMS box, in this order: DNS record and certificate first, renew the Meta token on whichever n8n is live before 27 Sep, deploy the pending 13-14 Sep CRM build (rules + hosting together), import A-D and prove them with the pinned samples in `n8n/samples/`, switch Meta's callback last, keep Hostinger's copies deactivated for a week before cancelling it.

---

## 3. What already fits, and what overlaps

Fits:
- Availability has the same grain on both sides (per date × room type, a count plus a stop-sell flag), so a feed writes the exact document the frozen screens already read.
- Absent-means-open is the same rule in both: no availability doc = full house, no `rate_restrictions` row = unrestricted (`044:26-28, 59-61`).
- Stop sell is per room type per date in both, not per rate plan.
- Both refuse to invent money (LD-2 is the one leak).
- Both model "where did this booking come from" as a group-level list with a channel code and a per-lead `source` bucket.
- Both put a machine behind a service identity, not a person: PMS POS outlets and the planned `n8n@` account; CRM's n8n writes as a service account and stamps `actorUid: "n8n"`.
- Both use Firebase Auth with email as the person's key, so people can be joined by email today.
- Both n8n set-ups keep secrets out of code.
- The CRM has the outbound WhatsApp pipeline the PMS's guest-messaging brief still has to choose (LD-7).

Overlap for a PMS hotel (screens that would exist twice):

| Live inventory screen | PMS equivalent | Note |
|---|---|---|
| Dashboard `/` (total rooms, available today, occupied, occupancy %, month calendar, 14-day strip) | Dashboard tiles, Rooms, Calendar, Rate calendar `/h/:code/grids` fed by `GET /:code/inventory` | same numbers, derived in the PMS |
| Edit Availability `/edit` (steppers, Stop Sell, bulk From-To) | `POST /:code/restrictions` (stop sell over a range, `rates.ts:747-813`); room blocks (`022`, housekeeping) | the PMS cannot be told a count; it is derived |
| Reports `/reports` (occupancy from typed availability) | PMS reports (Manager report, statistics) | |
| Admin → Users & Hotel Access (`users`, `invites`) | People (`POST /admin/staff`, `identity.ts`; `staff_hotels`) | LI-9 |
| Admin → Hotels (Load / Re-sync from `hotels.js`) | Room types / Room setup (`inventorySetup.ts`) | LI-1, LI-3 |
| Activity log `/activity` (`auditLog`) | audit log | |

No PMS equivalent: Inbox `/inbox`; Conversation `/inbox/:id` (timeline, reply composer, calls, follow-ups, guest panel, assign, Booked/Lost); Revenue `/revenue` (lead cohort by property, staff, source, category; CSV); Admin → WhatsApp routing (`numberMappings`), WhatsApp templates, WhatsApp integration health, Settings (SLA, alert recipients, automatic assignment, n8n connection); the roster and on-duty flag (`hotels/{id}/team`); workflows A-D. The PMS's Integrations page lists STAAH (planned), Sattva POS and others and nothing for WhatsApp or Meta.

---

## 4. Decisions the owner must make

1. **Which 5 Elements is real** (LI-1). Recommendation: the PMS, since it is taking the bookings; correct the live inventory's Akkalkot entry before anything is fed.
2. **The record for availability at a PMS hotel** (LI-4, LI-5): one-way PMS → live inventory, with human editing switched off for that hotel, marked per hotel (`pmsFed`).
3. **Unfreezing** (LI-7): exactly `src/hotels.js` (Akkalkot), `EditAvailability.jsx` (hide Edit for fed hotels) and `firestore.rules` (write lock). Nothing else.
4. **Where the feed runs and where the live-inventory1 key lives** (LI-6, LD-8): the PMS box's n8n, on a 15-minute schedule over a 365-day horizon in 90-day pages; the key entered once into that n8n and nowhere else.
5. **The booking handshake shape** (LD-1, LD-5): a `lead_id` column on the PMS reservation, a "Book in PMS" deep link from the Conversation page, a nightly job that stamps the PMS reference and figures back onto the lead; staff never type PMS references.
6. **Which figure is "PMS-confirmed revenue"** (LD-3): both expected and realised room revenue, as separate fields next to the typed value.
7. **A booking source for WhatsApp leads** (LD-4): "WhatsApp lead", kind direct, code WHATSAPP; a separate Meta-ad source only if needed.
8. **The central guest record** (LD-6): the PMS guest row, with a phone-lookup endpoint and normalised digits stored.
9. **One login and one identity project** (LI-9, LI-10): poms-fad05, with a planned move of the CRM's Firestore and Hosting into it before a second hotel group.
10. **Consolidating n8n** (LD-9): yes, after the DNS record exists and the pending CRM deploy has shipped; renew the Meta token before ~27 Sep whichever way this goes.
11. **How the PMS sends WhatsApp** (LD-7, `HANDOVER.md` § 3.5): through the CRM's workflow C rather than a second pipeline.
12. **Repository** (LI-11): `git init` in the live-inventory folder now; fold the leads CRM into the PMS repo only after TypeScript conversion and reading through the seam; drop the inventory screens for PMS hotels rather than port them.
13. **The em-dash rule** (LI-11): does it apply to the PMS's screens (856 lines today)? Ask before anybody starts removing them.
14. **Product replication** (LI-12): one deployment per hotel group, and the hard-coded project id, super-admin email, app URL and hotel list turned into configuration first.

---

## 5. Things I could not verify

- **Production Firestore contents** of live-inventory1: no access; only the code and docs were read.
- **The live site's bundle** (`index-DUL5mjr0.js` per `PROGRESS.md`): not fetched.
- **The 229 test count and its split**: needs the emulator and `fake-n8n`; nothing was run. The n8n figure is 92 in `n8n/README.md` and 77 in `PROGRESS.md`'s 13 Sep section.
- **The Hostinger n8n**: its version, whether the four JSON files import cleanly there, and whether it currently holds the Firestore credential and WhatsApp token.
- **The Meta token's actual expiry**: only "~27 Sep 2026".
- **PMS production details beyond the read**: room type codes and occupancy limits for 5EL, whether `n8n@fidatohotels.com` exists (PENDING says not), how phone numbers were typed for existing guests, and `CORS_ORIGIN`'s value.
- **The Firebase project ids** inside `src/firebaseConfig.js` (not opened by rule): taken from `.firebaserc` and `HANDOVER.md`.
- **Whether 022's "17 sellable, 18 some days" export** describes the same rooms the live inventory lists: the export is not in either repo.
