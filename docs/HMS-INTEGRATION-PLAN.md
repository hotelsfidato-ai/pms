# One hotel system — connecting the CRS, the live inventory, the leads and a channel manager

Written 15 September 2026 from the code of all three applications and a
read-only look at production. **Status: PLAN. Nothing is built, nothing is
changed in any of the three systems.** Section 5 lists what the owner must
decide before the first step.

The owner's goal, in their words on 15 September: the PMS becomes one hotel
management system with every service as a module — the CRS as a module of
it, the live inventory and the WhatsApp leads as modules, a channel manager
(being defined, finalised 16 September), a central CRM that holds every
property, guest, lead and booking — and, later, the ability to copy the whole
thing and sell it to another hotel group.

---

## 0 · In one page

- **There are three live applications and they share nothing** — not a login,
  not a hotel id, not a room count. The same hotel, 5 Elements Akkalkot, is 18
  rooms in the PMS, 17 rooms in the CRS and 17 differently-numbered rooms in
  the live inventory (§ 1.2).
- **Only the PMS has a server.** The CRS and the live inventory are browsers
  talking to Firestore on Firebase's free plan; neither can hold a secret or
  call anything privately. So the PMS is the hub, its API is the contract, and
  the n8n running on the PMS box is the only place the other systems'
  credentials may live. `docs/MASTER-ARCHITECTURE.md` already decided this:
  "Four clients already speak to this API — the staff app, the admin console,
  the tills and the CRS", and "Firestore ❌ — two sources of truth is the bug".
- **The rule that decides every conflict: for a hotel that runs the PMS, the PMS
  is the record.** Availability, rates, rooms, bookings, the bill. The other
  systems show it; they do not type over it.
- **The work is in three doors the PMS must open, then three wires.** The doors:
  an identity for machines, a place to store other systems' ids, and an
  idempotent way to receive a booking. The wires: availability out to the live
  inventory and the CRS, bookings in from the CRS and the leads, and — once
  defined — the channel manager on the same two paths.
- **Two things are urgent and not code**: the Meta WhatsApp token expires about
  27 September, and the CRS repository is public — by the owner's decision —
  with a per-hotel commission figure for 32 hotels committed in a reference
  file whose header calls the figures simulated (§ 3, finding SEC-1).
- **First step, this week:** deploy the service-folder move (already built), then
  a "Connections" section in the PMS menu that says *Coming soon* for the CRS,
  the channel manager and the leads — visible to the owner, admin and GM.

---

## 1 · What exists today — measured, not estimated

### 1.1 The three applications

| | **PMS** | **CRS** | **Live inventory + WhatsApp leads** |
|---|---|---|---|
| Folder | `D:\fidato pms` | `D:\fidato crs` | `D:\fidato tools\new live invetory` (sic) |
| What it is | Runs a hotel: desk, rooms, bills, restaurant, night audit | Sells room nights into partner hotels Fidato does not own | Typed availability for six Fidato hotels; a WhatsApp lead inbox fed by Meta ads |
| Live | pms.fidatohotels.com · api.fidatohotels.com | crstest-9a0c5.web.app v1.3.2 (12 Sep) | live-inventory1.web.app (10 Sep build; 13–14 Sep work not deployed) |
| Code | React 19 + TypeScript; Hono API on Node; Postgres | React 19 + TypeScript; Firestore | React 19, **plain JavaScript**; Firestore |
| Server | Oracle box, Mumbai (`130.210.49.220`): API, Postgres, n8n | **None** — Firebase Spark: no functions, no Admin SDK, 50k reads/day | **None**; its n8n workflows target a Hostinger box |
| Login | Firebase project `poms-fad05` | Firebase project `crstest-9a0c5` | Firebase project `live-inventory1` |
| Repository | github.com/hotelsfidato-ai/pms | github.com/hotelsfidato-ai/Crs-Test- — **public** | **No git.** Dated copies in `..\new live invetory - backups\` |
| Properties | **1 live**: 5EL, 18 rooms (demo data has AGR, PUN) | **28 live**, 105 room types, 1,340 rooms | **6**, hard-coded in `src/hotels.js`: 135 rooms |
| People | 4 staff rows, 2 active; 13 roles | 7 users; 8 roles (2 dormant) | roles admin · owner · gm · staff · sales · marketing · pending |
| Tests | 204 web + 359 API + 588 database | 238 unit + 122 rules | 229 checks (need the emulator) |
| Automation | n8n on the box: **running, local mode only** (127.0.0.1:5678, no public name yet) | Browser POST to an n8n webhook + `automationQueue` rows; a Supabase booking register | Four n8n workflows A–D written for `n8n.srv1114484.hstgr.cloud` (Hostinger) |

Production PMS, read on 15 September: hotels = `5EL` only; room types Superior
(201–210) and Deluxe (301–308); booking sources Fidato Hotels, Walk-in, Agoda
`AGODA`, Booking.com `BDC`, Expedia `EXPEDIA`, go-MMT `GOMMT`; modules on at
5EL: banquet, reception_pos.

### 1.2 The same hotel, three ways

| | PMS (production) | CRS (`scripts/hotels.reference.ts`) | Live inventory (`src/hotels.js`) |
|---|---|---|---|
| Id | `5EL` | `htl-akkalkot-5-elements-by-fidato-hotels` | `five-elements-akkalkot` |
| Name | 5 Elements Akkalkot | 5 Elements by Fidato Hotels | Hotel 5 Elements |
| Rooms | **18** | **17** | **17** |
| Room types | Superior 201–210 (10) · Deluxe 301–308 (8) | reference file: Deluxe 3 · Superior 10 · Executive 3 · Family 1 (the 105 live types are in Firestore, not the repo) | Deluxe 206, 306, 405 (3) · Superior 201–205, 301–305, 401, 402, 404 (13) · Family Suite 403 (1) |

The live inventory has a fourth floor (401–405) the PMS does not; the PMS has
207–210 and 307–308 the live inventory does not; of the twelve numbers both
have, the category agrees for six (201–205 Superior, 306 Deluxe) and disagrees
for six (206; 301–305). The CRS's reference file has an Executive type and a
Family type the PMS has never had. **One of these is what the hotel actually
has, and the owner is the only person who can say which.** One clue: the PMS's
migration 022 records that the hotel's real Monthly Statistics export showed
17 sellable rooms most days and 18 on some — consistent with 18 physical rooms
and one often blocked, not with a fourth floor. Nothing about availability can
cross between systems until that is settled (decision D3).

The other five live-inventory hotels (Grand Lucent Mathura, Hilltop Panhala,
Amrapali Kolhapur, Majestic Grand Shimla, Hilltop Shilaroo Narkanda) are not in
the PMS at all. At least Panhala, Narkanda, Grand Lucent and Grand Majestic are
among the CRS's 28.

### 1.3 What each system already says about the others

- The PMS's Administration → Integrations lists "Fidato CRS — planned, Stage 11"
  and "STAAH — planned, Stage 9"; its channel-manager page already says *Coming
  soon* but is in nobody's menu (`listed: false`). Its `crs`, `booking-engine`
  and `guest-messaging` folders hold a brief and no code. `PROGRESS.md` has
  the CRS bridge as stage 11, "twelve blocks, waiting on the API docs" — the
  twelve blocks were never written down.
- The CRS's `Integration` type has categories `pms` and `channel_manager`; its
  reservation has `hotelConfirmationNumber`, "recorded after the property
  confirms" — the natural home for a PMS booking reference.
- The live inventory's plan says "PMS connection (Phase 4) needs PMS API
  documentation" and "revenue becomes PMS-confirmed revenue once the PMS is
  connected". Nobody has written that API document.

---

## 2 · The shape we are building towards

```
                       ┌──────────────────────────────────────────┐
   Meta / WhatsApp ───►│  n8n on the PMS box  (the only keyholder) │◄─── STAAH (channel manager)
   CRS (browser POST)─►│  holds: PMS key · Firestore service acct  │
                       │         WhatsApp token · STAAH creds      │
                       └───────┬──────────────────────┬───────────┘
                               │ PMS API (the contract) │ Firestore writes
                               ▼                        ▼
                     ┌──────────────────┐     ┌───────────────────────────┐
                     │  PMS · Postgres  │     │ CRS Firestore             │
                     │  THE RECORD for  │     │ live-inventory1 Firestore │
                     │  a PMS hotel     │     │ (display copies, marked   │
                     └──────────────────┘     │  "from the PMS")          │
                                              └───────────────────────────┘
```

Five rules, each of which decides a class of conflict:

1. **The PMS is the record for a PMS hotel.** For a hotel not (yet) on the PMS,
   the live inventory stays typed and the CRS stays as it is. As hotels join
   the PMS, the typed copy is retired hotel by hotel.
2. **Browsers never hold a PMS credential.** The CRS and the live inventory
   are browsers. The CRS's own audit already found that any staff account can
   read its webhook secret (`docs/HANDOVER.md`, audit item 1). A PMS key placed
   in either app would be readable by every user of it. They talk to n8n; n8n
   talks to the PMS.
3. **Every inbound message is replayable without effect.** The CRS push is
   best-effort and its queue rows are never closed; the WhatsApp pipeline's
   rule D-006 is "replaying the same webhook must change nothing". The PMS's
   inbound door must key on the sender's own reference and refuse a second
   copy — never create twice.
4. **Ids are mapped, never reused.** Each system keeps its ids. The PMS holds a
   mapping table (system, kind, external id ↔ PMS row) so nothing is renamed on
   either side and a wrong mapping is one row, not a data migration.
5. **No figure crosses that the source has not agreed to.** A CRS line with rate
   0, a live-inventory date with no document, a lead's typed revenue — none of
   these becomes a PMS number. The PMS's "no default prices" rule applies at
   the door.

**Sequence:** run Fidato's own hotels on this first, sell second — as
`MASTER-ARCHITECTURE.md` § 2 already says. Every step below is built so that a
second group is a second deployment of the same code, not a fork.

---

## 3 · What does not fit today — the findings

Severity: **blocks** (nothing crosses until fixed) · **decide** (the owner
must choose) · **on the way** (fixed inside a step below) · **note**.

### Security and urgency

- **SEC-1 · decide · The CRS repository is public and carries a commission
  figure per hotel.** `scripts/hotels.reference.ts` has been committed since
  31 July 2026 (commit `78c69ce`) with a `commissionPercent` on each of 32
  hotels (Akkalkot 15). The file's own header says the commission figures are
  simulated Phase 1 seed data, and the owner decided the repository is public
  (the CRS's `CLAUDE.md`, "also settled"). The CRS's rule keeps the real
  commission in `hotels/{id}/private/commercial`, and that is where it is.
  **Resolution: the owner confirms none of the 32 figures is real; if any is,
  make the repository private today. Either way, nothing about the PMS —
  endpoints, key names, hotel maps, n8n workflow files — is ever committed
  there (the CRS's seven voucher workflows are; a PMS workflow must not be).**
- **SEC-2 · decide · The WhatsApp pipeline is planned onto a box the owner cannot
  administer.** Workflows A–D target `n8n.srv1114484.hstgr.cloud` (Hostinger).
  `MASTER-ARCHITECTURE.md` § 6: "DO NOT USE FOR PRODUCTION … someone else built
  this box, the user has no hPanel access, the firewall cannot be changed".
  The PMS box's own n8n is running but in local mode — reachable only through
  an SSH tunnel, with no public name, so Meta cannot deliver to it yet.
  **Resolution (D2): give the box's n8n a name (`deploy/n8n.sh` with
  `N8N_DOMAIN`, needs one DNS record), import A–D there, re-enter the two
  credentials, point Meta's webhook at it.** Until then, nothing that must run
  unattended should be put on Hostinger.
- **SEC-3 · note · The Meta system-user token must be regenerated by about 27
  September** (`PROGRESS.md`, "Waiting on you"), with `whatsapp_business_
  management` and expiry Never. Owner's action; nothing here works without it.
- **SEC-4 · on the way · The PMS API has no identity for a machine.** It accepts
  Firebase ID tokens of `poms-fad05` staff, and an API key only for POS outlets
  (`pos_outlets.api_key_hash`; `x-pos-key` is deliberately not in CORS). The
  `automation` role exists in `src/lib/permissions.ts` ("never offered in a
  picker") and is granted nothing. Step 1.1 builds the integration identity.

### Identity of things

- **ID-1 · decide · Three logins.** Three Firebase projects; a token from one is
  refused by the others (the CRS's Supabase policies check the issuer on
  purpose). One login means one project, and the only one that can import
  users and hold roles server-side is the PMS's (`api/src/identity.ts`, Admin
  SDK on the box). Phase 5.
- **ID-2 · blocks · The same hotel has three ids and two room counts** (§ 1.2).
  Step 1.2 adds the mapping table; decision D3 settles the rooms.
- **ID-3 · on the way · Room types are named, not coded, on the other sides.**
  The PMS has `room_types.code`; the CRS and the live inventory use slugs and
  names. Mapped per hotel in step 1.2, the same table the channel manager will
  need for "what an OTA calls your Superior" (the channel-manager page already
  lists this as its need 3).
- **ID-4 · on the way · Phones are stored in different shapes.** The leads app
  normalises to `91XXXXXXXXXX` (`src/leads/model.js` `normalisePhone`) and keys
  `contacts/{digits}` on it; the PMS `guests.phone` is free text with an
  index. A central CRM needs one shape — the PMS adopts the digits form for
  matching (a normalised column, the typed text kept) in step 6.1.
- **ID-5 · note · Booking references.** CRS `FH-2026-nnnnn` comes from a
  `counters` document any active CRS user can rewrite (its audit item 4), so
  two bookings can carry one reference. The PMS's inbound key must therefore
  be *system + reference + a content hash*, not the reference alone (step 1.3).

### Meaning of the data

- **DATA-1 · decide · "Available" means three things.** PMS: computed each night
  from rooms minus stays minus blocks. Live inventory: a number a person typed
  per date and room type; no document means fully available; `stopSell` flag.
  CRS: `InventoryDay { totalRooms, booked, blocked, available, rate }` and, by
  its own design, "occupancy is not derived from reservations" because Fidato
  sells a slice of each partner hotel. Rule 1 resolves it for PMS hotels; for
  partner hotels the CRS's model stands.
- **DATA-2 · decide · Two tax engines.** The CRS prices per line before tax with
  GST bands per line and `gstVersion`; the PMS has tax rules (migration 067)
  and stamps the rate in force. If both compute a total for one booking they
  will disagree by paise and sometimes by a band. **Resolution (D5): the CRS
  quotes and confirms with the guest; the PMS bills; the PMS reference goes
  back to the CRS as `hotelConfirmationNumber`; the CRS voucher stays the
  guest's document.** A CRS line with rate 0 is refused at the door, not
  billed at 0.
- **DATA-3 · on the way · The booking shapes differ.** CRS room lines carry
  `quantity` (several rooms on one line), meal plan EP/CP/MAP/AP, extra beds
  and child rates per line, payment term DP/RA/BTC, and a channel enum
  (`direct_sales … walk_in`); the PMS books per room with a rate plan, a
  billing company for bill-to-company, and a `booking_source_id`. The audit
  in § 6 maps field by field; the translation lives in n8n and in the PMS's
  door, never in the CRS.
- **DATA-4 · on the way · Sources and attribution have no home in the PMS.**
  `booking_sources` has no row for "Fidato CRS", "WhatsApp lead" or "Meta ad",
  and reservations have no column for a campaign id or click id
  (`campaignId`, `ctwaClid` in the leads app). Step 1.4.
- **DATA-5 · on the way · Lead revenue is typed.** A lead marked Booked carries
  a reference and a revenue figure a person typed. Step 2.3 makes the reference
  a real PMS booking and the revenue the PMS's.
- **DATA-6 · note · Commission is modelled twice.** CRS: one percent per hotel
  (`private/commercial`). PMS: a rate per source per hotel, stamped onto the
  booking (082). For a CRS booking at a PMS hotel the PMS row "Fidato CRS"
  carries the rate; the CRS keeps its own for partner hotels. No conflict
  unless one is copied into the other — do not.

### Engineering

- **ENG-1 · decide · The live inventory has no git, no TypeScript and frozen
  screens.** Its inventory screens are declared done by the owner; its 13–14
  September work is undeployed and must ship rules and hosting together. (Its
  Firestore rules budget is *not* the constraint: the availability rule is two
  lines, and a service-account writer costs no rule at all; the
  1,000-expression trouble was in the lead rule, which a feed never touches.)
  **Resolution: connect to it, do not fold its code into the PMS.** The
  inventory half is retired hotel by hotel as hotels join the PMS; the leads
  half stays where it is until the PMS's `guest-messaging` module is built
  (Phase 6), and even then the WhatsApp pipeline (n8n) is reused, not
  rewritten. Three frozen things change, once each: the Akkalkot entry in
  `src/hotels.js` (after D3), the Edit Availability screen (read-only for a
  PMS-fed hotel) and one condition in the availability write rule (D6). And
  `git init` in that folder now — harmless, local, and the next scripted
  delete has something to diff against.
- **ENG-2 · note · The shared UI has diverged; the runtimes have not, the
  toolchains have.** Installed on both: React 19.2.8, Tailwind 4.3.3, TanStack
  Query 5.10x, Firebase 12.1x, react-router 7.18 (the PMS declares older
  ranges but resolves the same). Apart: Vite 6 vs 8, Vitest 2 vs 4, TypeScript
  5.9 vs 6.0. Of the 15 UI files the PMS ported from the CRS, 5 are still
  byte-identical and 10 differ; the PMS adds 4. A shared UI package would mean
  reconciling ten files and two build tools — not part of this plan.
- **ENG-3 · on the way · Risks an automated feed amplifies in the PMS.**
  `PENDING.md` § 2a RES-1 (a refused booking can leave a guest saved) is a
  nuisance with a clerk and a data leak with a retrying robot; migration 008
  re-creating a placeholder admin on deploy (MEMORY 271). Both are fixed
  before the door opens (step 1.0).
- **ENG-4 · note · Hard-coded Fidato.** The live inventory's super-admin
  address (`admin@fidatohotels.com`) and hotel list are in code; the CRS's
  organisation is one `settings/org` document; the PMS is multi-hotel under
  RLS but one deployment is one group. Selling means one deployment per
  customer group (Phase 7), which the PMS already supports and the other two
  do not.

### Found by the audit of the PMS's own readiness (PMS-n)

Nineteen findings, read-only, 15 September; the ones that change the plan.
File and line evidence is in the audit's report, summarised here.

- **PMS-2 · blocks · The server checks no role on writes.** `src/lib/permissions.ts`
  is consulted by the screens only; no server file imports it. The API's
  authorisation is row-level security alone, and RLS scopes by *hotel*, not by
  role — `reservations`, `folios`, `rates` and `rate_restrictions` are
  "for all" to anybody rostered at the hotel. A `read_only` "Viewer" account
  can `POST /:code/bookings` and `PUT /:code/rate-grid`. The role matrix a
  hotel sees in Administration → Roles is not what the API enforces. **For
  integrations: scope by what the key unlocks (step 1.1), never by role. For
  people: a server-side check per write route is its own project — recorded
  in `PENDING.md`, not folded in here.**
- **PMS-3 · blocks · `POST /:code/bookings` has no idempotency.** The
  `idempotency-key` header of 062 is honoured by work orders and banquet
  events only; the booking route never reads it and `reservations` has no
  key column. A timed-out request, retried, makes a second guest, group, set
  of confirmed bookings and folios — and a booking cannot be deleted, only
  voided. Step 1.3. The POS bridge already has the right shape
  (`unique (outlet_id, ticket_ref)`, "already seen" answered with the
  original).
- **PMS-4 · blocks · RES-1 confirmed by reading, and worse than the note.**
  The guest and the group are inserted before four of the refusals, and in a
  booking of several room types, the first type's rooms are confirmed with
  open folios before the second type is refused — while the caller sees
  `ok:false` and retries. Each retry adds more. Step 0.6: validate every
  line, then write; a test that no guest survives a refusal.
- **PMS-5 · on the way · The booking reference is generated without a lock,
  in two copies, with a hard-coded `FH-` prefix and the server's calendar
  date.** `app.next_reference` (005, advisory-locked) exists and has no
  caller. Two feeds booking in the same second lose one request to a 500.
  Step 1.3: one locked generator, prefix from `hotels.code`, both doors.
- **PMS-6 · decide · Restrictions and availability are reported, never
  enforced, on inbound bookings** — by design, for a clerk's judgement. A
  channel manager delivering a booking on a stop-sell date is accepted
  silently. Decision D10: enforce for machine callers, not for the desk.
- **PMS-7 · decide · A booking is priced from the first night only, and a
  caller may send any price, including 0.** `agreedRate` is accepted as-is
  (`agreed_rate >= 0`). Decision D10 (may a machine send the price: yes, for
  a booking the guest was quoted; 0 refused unless complimentary) and step
  1.3 (no price sent: average the tariff over the nights, or refuse naming
  the unpriced night).
- **PMS-8 · on the way · Sources are resolved by uuid only;** `channel_code`
  ("what a channel manager will send") cannot be sent. Step 1.3 accepts it.
- **PMS-9 · decide · Nothing an outside system can subscribe to.** The one
  live stream fires for restaurant tables only; notifications are derived
  per request; there is no outbox. Decision D11: poll first, an
  `integration_events` outbox in Phase 3.
- **PMS-10 · on the way · Two responses turn an unpriced room into ₹0**:
  `GET /:code/rates` (`rateGrid.ts:97`) and `GET /:code/room-types`
  (`roomTypesAndPlans.ts:66`) do `Number(null)`. A channel manager reading
  either would push ₹0 to the OTAs — the owner's rule broken on the wire.
  Two one-line fixes in step 1.5; integrations read `rate-grid` and
  `rate-plans`, never `/:code/rates`.
- **PMS-11 · note · Guests are one row per booking, matched by nothing;** the
  booking response returns no guest id, reservation ids or folio ids. Step
  1.3 returns them; matching waits for Phase 6.
- **PMS-12 · note · Only `GET /:code/room-setup` exposes the ids a mapping
  needs** (room-type id and code, room id). The rest return names. Step 1.2's
  mapping uses `room-setup`.
- **PMS-13 · on the way · Adding a module is one migration on a CHECK plus
  two lists** (`hotel_modules_known`; `moduleSwitches.ts`). Absent row = off,
  which is right for `crs`, `channel_manager` and `leads`. Step 0.2.
- **PMS-14 · decide · One deployment is one group.** Eight group-level tables
  and no organisation above `hotels`; Fidato appears as behaviour in six
  places (the `FH-` prefix, "Fidato Hotels" as the direct source's label,
  `@fidatohotels.com` service accounts, the OTA name list, the seed admin,
  `5EL` in two web fallbacks). One deployment per customer works today with
  its own database, origin and environment; a shared deployment is a schema
  change of the expensive kind. Decision: one per customer (Phase 7).
- **PMS-15 · note · How Coming soon works today.** `listed: false` hides an
  entry from every sidebar but keeps it in Find a screen; `workingMenus`
  puts it in a role's sidebar; `navigation.test.ts` pins each role's list.
  Step 0.2 is nav entries with `workingMenus: [owner, admin, gm]` and pages
  in the channel-manager page's shape, and the pinned lists change with it.
- **PMS-16 · on the way · migration 008** re-creates the placeholder group
  administrator on every deploy (MEMORY 271); step 0.6.
- **PMS-19 · confirmed · The dev sign-in cannot reach production**
  (`env.ts` throws when `ALLOW_DEV_AUTH=1` meets `NODE_ENV=production`; the
  web build fails if the test sign-ins are bundled).

The audit also wrote down the exact body of `POST /:code/bookings` (every
field, its default and its refusal) and the exact shapes of the seven
availability and rates responses — the first draft of `docs/API.md`
(step 1.6). It is kept with the report.

### Found by the CRS ↔ PMS audit (CRS-n)

Twenty-six findings; the ones that change the plan. The report is
`docs/audits/2026-09-15-crs-pms.md`.

- **CRS-2 · blocks · The CRS's reference file gives 5 Elements four room
  types** — Deluxe 3, Superior 10, Executive 3, Family 1 — two of which the
  PMS has never had. A booking for an Executive room has nowhere to land
  (the PMS refuses "One of those room types is not here"). Decision D3; then
  the CRS re-imports the PMS's types for that hotel from `room-setup`.
- **CRS-7 · blocks · The CRS refuses to save a booking without the hotel's
  confirmation** — which, for a PMS hotel, exists only after the booking has
  been sent. Today a salesperson would type a name or a time to get past the
  gate and the real reference would arrive later. Step 3.1: for PMS hotels, a
  "confirmation pending from the PMS" state the write-back fills.
- **CRS-8 · decide · `ALL_INCLUSIVE` has no PMS meal plan** (`meal_plans` seeds
  EP, CP, MAP, AP; the booking's meal plan is a foreign key). An
  all-inclusive booking is a 500 after the guest was inserted. Decision D14.
- **CRS-9 · on the way · Nothing in the PMS API can cancel a booking from
  outside**, and the CRS emits `reservation.cancelled`. Step 3.4 builds the
  route; until then v1 is create-only and a CRS cancellation raises a desk
  notification.
- **CRS-10 · on the way · Four of the six CRS channels have no PMS source
  row, and a row is compulsory.** Step 1.4: one row "Fidato CRS", channel
  code `CRS`; the CRS channel travels in `marketSegment`.
- **CRS-11, CRS-12, CRS-13 · on the way · Counting and terms differ.** Payment
  term DP/RA/BTC has no PMS field (BTC is a folio act, not a booking act);
  extra beds are per line in the CRS and derived per room in the PMS; the
  company does not travel (the route has no company field though the
  columns exist); special requests have a column the route does not write.
  A written translation rule, confirmed by the owner, lives in n8n (step
  3.2).
- **CRS-14 · decide · The two tax engines disagree — worked example: a ₹7,000
  room with a ₹1,000 extra bed is ₹400 tax in the CRS (each charge banded on
  its own) and ₹1,440 in the PMS (one ₹8,000 rate crossing the 18% slab).**
  ₹1,040 a night between the voucher and the invoice. Decision D5 stands —
  the PMS bills — and the extra-bed banding rule is the owner's to settle.
- **CRS-15 · on the way · A ₹0 rate passes the CRS silently** (a blank
  becomes 0; "Room count not set" does not cap) and the PMS accepts
  `agreed_rate >= 0`. The bridge refuses rate ≤ 0 or rooms < 1 before it
  calls the PMS (step 3.2); step 1.3 refuses it at the door.
- **CRS-17 · confirmed · CRS → n8n → PMS is the only safe transport**, and
  the n8n workflow must check `X-Fidato-Signature` (keeps outsiders out, not
  staff) and re-read the reservation from Firestore with the CRS's
  `automation` account before writing anything — the CRS audit's own fix
  for its HIGH item 1.
- **CRS-19, CRS-20 · on the way · Retries and queue drains duplicate; two CRS
  bookings can share a reference.** The CRS's `eventId` (the reservation's
  document id) is the right dedupe key for n8n; the `counters` rule fix
  (`next == resource.data.next + 1`) is cheap and belongs in step 3.1.
- **CRS-22 · note · No amendments either way.** The CRS has no
  `reservation.updated` event; an edit after the push diverges silently.
  v1: create-only; edits by hand with a notification.
- **What already fits:** `POST /bookings` takes most of a CRS booking today
  (guest, dates, lines with room type, meal plan, adults, children, rooms,
  agreed rate; a group for several rooms; a folio per room); meal-plan codes
  EP/CP/MAP/AP are the same strings; `ota_reference`, `notes`, `company_id`
  and `channel_code` are columns waiting; the CRS already has an
  `automation` role, a queue with lease fields, an `Integration` category
  `pms`, and a "written by n8n, never by the app" pattern for the
  write-back.

### Found by the live inventory + leads ↔ PMS audit (LI-n, LD-n)

Twelve inventory and nine leads findings; the ones that change the plan. The
report is `docs/audits/2026-09-15-live-inventory-pms.md`.

- **LI-1 · blocks · The precise disagreement on 5 Elements** is in § 1.2. A
  feed keyed on room type would put the PMS's 8 Deluxe into a slot whose
  total is 3, and the Dashboard's occupancy would be nonsense before a line
  of integration code was wrong.
- **LI-4 · on the way · Absent means full, so the feed must write every date
  in its horizon, not only changes** — 2 types × 365 days = 730 documents a
  refresh, in 90-day pages because the PMS answers 90 days per request.
  Step 2.1: every 15 minutes, 365 days ahead.
- **LI-5 · decide · A GM can still tick Stop Sell over a fed value.** One
  condition in the availability write rule (a single `get()` of the hotel
  document flagged `pmsFed`) refuses it; the Edit screen hides for such
  hotels. D6.
- **LI-6 · on the way · The PMS's `automation` role cannot be granted today**:
  it is in the web's list but not in the database's `app.assignable_roles()`,
  so a `staff_hotels` row would be refused. Step 1.1 includes the migration
  that makes it grantable (system role, never in a picker).
- **LI-9, LI-10 · decide · Roles and logins do not line up.** One role per
  person for all their hotels (live inventory) vs a role per hotel (PMS);
  `sales` and `marketing` have no PMS role; `admin` is global there and
  per-hotel here. A sign-in from one project cannot reach the other. **One
  login means the leads app's Firestore and hosting move into `poms-fad05`
  — a new database there, rules and index redeployed, data copied, n8n
  credentials re-issued — not a token trick.** Phase 5 is sized as that.
- **LI-11 · note · The em-dash rule.** The leads app forbids em dashes in
  anything a person sees; the PMS's screens carry one on 856 lines.
  Decision D13.
- **LD-1 · blocks · "Booked needs a reference" stores any text, and the PMS
  cannot look a booking up by its reference.** Staff must never type PMS
  references by hand. The direction is reversed in step 2.3: the PMS booking
  carries the lead's id, the Conversation page deep-links "Book in PMS" with
  the lead's name and phone pre-filled, and a nightly job stamps the PMS
  reference and figures back onto the lead.
- **LD-2 · on the way · A Booked lead with no value is stored and counted as
  ₹0** — the exact thing the PMS forbids. Blank becomes null and a dash;
  "booked, value unknown" counted apart. Step 2.3.
- **LD-3 · decide · "PMS-confirmed revenue" is two numbers**: expected
  (agreed rate × nights, at booking) and realised room revenue (postings,
  after check-out). Both stamped onto the lead as locked fields, beside the
  typed value; the Revenue page keeps its lead-cohort window. Step 2.3.
- **LD-4, LD-5 · on the way · The booking needs a source and a lead id, not an
  attribution blob.** Source "WhatsApp lead", kind direct, channel code
  `WHATSAPP` (a separate "Meta ad" source only if ad-attributed bookings must
  be split in the source-mix report); one nullable `lead_id` column on
  reservations, accepted by `POST /bookings`. Attribution (campaign, click
  id, first and latest touch) stays in the leads app, which already keeps
  it. Step 1.4 is changed to this.
- **LD-6 · decide · A guest is a phone number there and a name here.** The
  PMS stores whatever was typed and has no phone search; the leads app
  normalises to `91XXXXXXXXXX`. Phase 6: one lookup by normalised phone, the
  PMS guest row as the central record, `pmsGuestId` on the contact after a
  match.
- **LD-7 · decide · The PMS's guest-messaging brief and the leads app's
  workflow C are the same WhatsApp plumbing.** Workflow C already sends text
  or approved templates exactly once, honours the 24-hour window, records
  delivery receipts and keeps the template list. When § 3.5 of the handover
  is decided, the PMS sends by writing a pending outbound message on the
  guest's conversation — and holds no WhatsApp token at all.
- **LD-9 · on the way · The order for moving the WhatsApp workflows to the
  box:** DNS record and certificate first; renew the Meta token on whichever
  n8n is live before 27 September; deploy the leads app's pending 13–14
  September build (rules and hosting together); import A–D and prove them
  with the pinned samples in `n8n/samples/`; switch Meta's callback last;
  keep Hostinger's copies deactivated for a week before cancelling. Step 2.4.
- **What already fits:** availability has the same grain on both sides (per
  date × room type, a count plus stop-sell), absent-means-open is the same
  rule in both, both keep a group-level list of booking sources with a
  channel code, both put a machine behind a service identity, and people can
  be joined by email today.

---

## 4 · The plan of execution

Each step names who does it. "Agent" means a Claude agent working in one
service folder under `AGENTS.md`; several can run at once because the code is
now one folder per service. Sizes are working days of an agent, not calendar
promises. **Nothing is deployed and nothing is written on a server without the
owner's yes for that step.**

### Phase 0 · This week — clear the ground

| # | Step | Who | Size |
|---|---|---|---|
| 0.1 | Merge `service-folders` into `cp6`; deploy it alone (HANDOVER § 9) | owner deploys | ½ day |
| 0.2 | **"Connections" — a new menu section that says Coming soon**: three entries — *Fidato CRS*, *Channel manager*, *Leads and WhatsApp* — each a page in the pattern of `channel-manager/pages/ChannelManager.tsx`: what it will do, what it needs, honest status, nothing invented. Shown to owner, admin and GM (`workingMenus`); search-only for everyone else; the pinned menu tests updated. Administration → Integrations gets rows for the live inventory and the leads app with their real status. Module switches `crs`, `channel_manager`, `leads` (one migration on the CHECK, absent = off — PMS-13) so a hotel can turn each on when it exists | agent: `crs` + `channel-manager` + `guest-messaging` folders; `admin` for the switch | 1½ days |
| 0.3 | Make the CRS repository private (SEC-1) | owner | minutes |
| 0.4 | Regenerate the Meta token (SEC-3) | owner | minutes |
| 0.5 | Settle 5 Elements Akkalkot: which rooms exist, on which floors, in which types (D3) | owner | — |
| 0.6 | Fix RES-1 and migration 008 (ENG-3) — a refused booking leaves nothing; a deploy re-creates nobody | agent: `reservations`, `admin` | 1 day |

### Phase 1 · The PMS opens its door — the API contract

| # | Step | Who | Size |
|---|---|---|---|
| 1.1 | **Integration identity.** An `integrations` table in the shape of `pos_outlets` (hash only, a service-account `staff` row of role `automation`, hotel grants), so RLS scopes a key to its hotels exactly as it scopes a person; a fourth mount prefix; header `x-integration-key`, not in CORS (machines only). Revocable from Administration → Integrations. **A rate limit on the API at nginx before the first key is issued** (n8n's webhooks already have one) | agent: `admin` (+ core `auth.ts`, `mount.ts`, `server.ts`, claimed) | 2 days |
| 1.2 | **External references.** `external_refs (system, kind, external_id, hotel_id, row_id)` unique per system + external id, for hotel, room type, guest, reservation. Seeded with 5EL ↔ the CRS id ↔ the live-inventory slug and the room types (after 0.5) | agent: `admin` | 1 day |
| 1.3 | **Inbound booking, idempotent.** `POST /api/hotels/:code/bookings` accepts `channelCode` (PMS-8) and `externalRef`, unique per booking source (PMS-3; the dormant `reservations.ota_reference` of 005 is the column to reuse); a second copy returns the original references, as the POS door does; a differing copy with the same reference is refused with a reason; a price of 0 is refused unless complimentary, and no price means the tariff averaged over the nights or a refusal naming the unpriced night (PMS-7); one locked reference generator, prefix from the hotel's code, used by both doors (PMS-5); the response returns the reservation, folio and guest ids (PMS-11) | agent: `reservations` | 3 days |
| 1.4 | **Sources and the lead id.** `booking_sources` rows: Fidato CRS (kind direct, `CRS`), WhatsApp lead (kind direct, `WHATSAPP`), commission null (a dash); a "Meta ad" row only if the owner wants ad-attributed bookings split in the source-mix report. One nullable `reservations.lead_id`, accepted by `POST /bookings`. Ad attribution stays in the leads app (LD-5). Source-mix reports pick the rows up unchanged | agent: `guests` (sources) + `reservations` (column) | 1 day |
| 1.5 | **Availability out.** `GET /:code/inventory` already answers per room type per date (sellable, occupied, sold, available, restrictions) but does not subtract rooms out of order; the property card does. One definition, the same one the Rooms screen uses, and the two responses that turn an unpriced room into ₹0 fixed (PMS-10). Integrations read `inventory`, `rate-grid` and `rate-plans`; never `/:code/rates` | agent: `inventory` | 1 day |
| 1.6 | **The API document.** `docs/API.md`: every route the outside may call, each field, each refusal, the idempotency contract, examples. This is the document both other projects say they are waiting for | agent: core docs | 1 day |
| 1.7 | The box's n8n gets a public name (`N8N_DOMAIN`, one DNS record, `deploy/n8n.sh`) — screen still locked to the owner's address, webhooks open | owner runs; agent writes the exact commands | ½ day |

### Phase 2 · The live inventory reads the PMS — 5 Elements first

| # | Step | Who | Size |
|---|---|---|---|
| 2.1 | n8n workflow on the box: every 15 minutes, `GET /:code/inventory` for 5EL in 90-day pages, 365 days ahead → write **every** `hotels/five-elements-akkalkot/availability/{date}_{type}` document (absent means full — LI-4) with `source: "pms"`, and each `roomTypes/{id}.total` from the PMS's room count. Firestore service account entered in n8n by the owner, never in the repo. First the Akkalkot entry in `src/hotels.js` is corrected to whatever D3 decides | agent writes the workflow file; owner imports and enters the credential | 1 day |
| 2.2 | Live inventory: the hotel document gets `pmsFed: true` and `pmsCode: "5EL"`; Edit Availability hides for such a hotel and the Dashboard says "From the PMS, updated 15 minutes ago"; one condition in the availability write rule (a `get()` of the hotel document) refuses staff writes there (LI-5). `git init` the folder first; the three frozen files change once each (D6) | agent, in that project (backup first) | 1 day |
| 2.3 | Leads → PMS, the other way round (LD-1): the Conversation page gets a "Book in PMS" link that opens New booking with the lead's name and phone pre-filled and the lead id carried; the booking stores `lead_id` and the source WhatsApp lead; a nightly n8n job on the box finds bookings with a lead id and stamps `pmsReference`, `pmsExpectedRevenue` (agreed rate × nights) and, after check-out, `pmsRealisedRoomRevenue` onto the lead as locked fields beside the typed value (LD-3). A blank booking value becomes null and a dash, never 0 (LD-2). Staff never type a PMS reference | agent: `reservations` + the leads app; owner imports the workflow | 2 days |
| 2.4 | Workflows A–D moved from Hostinger to the box (SEC-2), in this order (LD-9): the box's n8n has its name (1.7); the Meta token renewed on whichever n8n is live; the leads app's pending 13–14 September build deployed (rules and hosting together); A–D imported and proved with the pinned samples; the two credentials entered; Meta's callback switched last; Hostinger's copies deactivated for a week, then cancelled | owner, with the agent's written steps | ½ day |

### Phase 3 · CRS ↔ PMS bookings — 5 Elements first

| # | Step | Who | Size |
|---|---|---|---|
| 3.1 | CRS: a hotel document gains `pmsHotelCode` (in `private/`, Owner-only) for the properties that run the PMS; for those hotels a booking can be saved "confirmation pending from the PMS" instead of demanding a confirmation number first (CRS-7); the `counters` rule fixed so a reference cannot repeat (CRS-20); 5 Elements' room types re-imported from the PMS's `room-setup` (CRS-2, after D3). Nothing else in the CRS changes | agent, in the CRS repo | 1 day |
| 3.2 | n8n on the box: on `reservation.confirmed` for a PMS hotel → check `X-Fidato-Signature`, re-read the reservation from Firestore with the CRS's `automation` account (CRS-17) → translate by a written rule the owner has confirmed (extra beds, adults per room, BTC, all-inclusive refused, rate ≤ 0 or rooms < 1 refused — CRS-8, 11, 12, 15) → `POST bookings` with the CRS's reservation id as `externalRef` (CRS-19) → write the PMS reference(s) back as `hotelConfirmationNumber` and mark the `automationQueue` row done (closing the CRS's own open item) → failures to a list the owner sees in the PMS (Administration → Integrations) | agent writes the workflow and the translation tests; owner imports | 3 days |
| 3.3 | PMS availability visible in the CRS for PMS hotels: n8n writes the CRS's `inventory` documents for those hotels from `GET availability`; the CRS labels them "from the PMS" | agent | 1 day |
| 3.4 | Cancellations both ways — the PMS has no route that cancels a booking from outside today (CRS-9), so one is built, same door, same idempotency; amendments stay by hand with a desk notification (CRS-22); an `integration_events` outbox (hotel, kind, reference, payload, delivered_at) written by triggers on reservations, blocks and rates, drained by n8n — the push that replaces the polling of 2.1 and 3.3 (PMS-9, D11) | agent: `reservations` + `inventory` | 3 days |

### Phase 4 · The channel manager — after 16 September's definition

STAAH is settled in `MASTER-ARCHITECTURE.md` § 2 ("take it"). The PMS side is
the same two paths as above: availability and rates out (1.5), bookings in
(1.3) with `channel_code` already on `booking_sources` (AGODA, BDC, EXPEDIA,
GOMMT). What is new is STAAH's own protocol and the room-type mapping per OTA
(1.2 holds it). Sized when the definition arrives; the door is built in Phase 1
either way.

### Phase 5 · One login

One identity project, `poms-fad05`. For the CRS: its 7 users imported with the
Admin SDK on the box (`api/src/identity.ts` already adopts existing addresses),
its Supabase policies re-pointed to the new issuer, its rules keyed on the same
uid. For the leads app it is larger (LI-10): its Firestore and hosting move
into `poms-fad05` — a new database there, rules and index redeployed, data
copied, n8n credentials re-issued — because a sign-in from one project cannot
reach another's Firestore. Roles stay per app for now, joined by email; the
PMS's `staff_hotels` becomes the record of who works where (LI-9). About a
week, plus the owner's word to staff. Not before the wires (D7).

### Phase 6 · The central CRM

Guests and companies are already group-level in the PMS (`MASTER-ARCHITECTURE`
§ 5). 6.1: a normalised phone on `guests` and a match by phone across leads,
CRS customers and PMS guests; 6.2: a "Guest" screen in the PMS that shows the
person's leads, CRS bookings and stays across properties; 6.3: the PMS's
`guest-messaging` module built on the WhatsApp pipeline that exists. Sized
after Phases 2–3 prove the wires.

### Phase 7 · Sell it

One deployment per customer group — the PMS already provisions hotels as data
(`MASTER-ARCHITECTURE` § 5, 029 provisioning key); an install script from
`deploy/launch.sh`; a grep-driven removal of every hard-coded "Fidato"; the
CRS and the leads app become optional modules of that deployment. Not sized.

### What runs in parallel

After Phase 0, steps 1.1–1.6 are six agents in six folders (`admin`,
`reservations`, `guests`, `inventory`, core docs, plus the CRS repo) and can
run at once under `AGENTS.md`. Phases 2 and 3 each need Phase 1 and can run
side by side.

---

## 5 · Decisions the owner must make — with recommendations

| # | Decision | Recommendation |
|---|---|---|
| D1 | For a hotel on the PMS, is the PMS the record for rooms, availability, rates and bookings — and the other systems display copies? | **Yes.** Everything in § 2 follows from it |
| D2 | Where do the credentials and the WhatsApp workflows live: the n8n on the PMS box, or Hostinger? | **The PMS box.** It is yours, it is backed up, and it is where the PMS key must be anyway. Needs one DNS name |
| D3 | 5 Elements Akkalkot: 18 rooms (201–210, 301–308) as the PMS has, 17 with a fourth floor as the live inventory has, or 17 in four types as the CRS's reference file has? | Not mine to guess. **The hotel's own key rack is the answer**; the PMS is corrected if the PMS is wrong. The hotel's own statistics export (migration 022) points to 18 |
| D4 | Build the "Connections — Coming soon" section now, shown to owner, admin and GM? | **Yes**, right after the move deploys; nothing invented on the pages |
| D5 | Who prices a CRS booking at a PMS hotel, and how is an extra bed taxed? | **The CRS quotes from the PMS's tariff for those hotels, the PMS bills, and the PMS's tax rules decide the band** (CRS-14: ₹1,040 a night apart today). The PMS reference goes back to the CRS; the guest's voucher for those hotels prints the PMS's total |
| D6 | May three frozen things in the live inventory change once each — the Akkalkot entry in `src/hotels.js`, the Edit Availability screen (hidden for a PMS-fed hotel) and one condition in the availability write rule? | **Yes**, those three and nothing else, backup first, `git init` first |
| D7 | One login on `poms-fad05` (Phase 5) — now or after the wires? | **After the wires.** Nothing in Phases 1–3 needs it |
| D8 | The CRS repository is public by your decision; its reference file carries a commission figure per hotel, marked simulated. Is any of the 32 figures real? | **If any is real, make the repository private today**; if none is, leave it — and nothing PMS-shaped is ever committed there (SEC-1) |
| D13 | The leads app forbids em dashes in anything a person sees; the PMS's screens carry one on 856 lines. Is that rule global? | **Ask before anyone starts removing them.** If global, it is its own pass, not part of this plan |
| D14 | All-inclusive bookings at a PMS hotel: refuse at the bridge, or add the meal plan to the PMS? | **Refuse until a hotel sells it** (CRS-8); adding it is one migration when one does |
| D9 | The POS and inventory updates the owner is sending: fold them into this plan, or run them as their own work in their own folders? | **Their own folders, in parallel** — that is what the service split is for; nothing in Phases 0–1 touches `pos` |
| D10 | May a machine caller send the price, and are stop-sell, arrival/departure closures, minimum nights and availability enforced for it? | **Yes and yes.** An OTA or CRS booking carries the price the guest was quoted, with its source and commission; 0 is refused unless complimentary. Restrictions are enforced for machines and left to judgement for the desk (PMS-6, PMS-7) |
| D11 | Push or poll: how do the other systems learn a change? | **Poll first** (`GET inventory` every five minutes, no migration), **an outbox in Phase 3** when cancellations flow both ways (PMS-9). The copies the other apps hold are display copies; the PMS stays the one source |
| D12 | The server enforces no role on writes (PMS-2) — fix now, or record it? | **Record it in `PENDING.md` and fix it as its own project** after the wires; the integration door never depends on roles, only on what a key unlocks |

---

## 6 · The audits — what was checked, what could not be

Three read-only audits were run on 15 September: the PMS's own readiness
(every authentication path, the exact body of `POST /bookings`, the exact
availability and rates responses, module switches, multi-tenancy, amplified
risks — 19 findings, folded into § 3), CRS ↔ PMS (the booking shape, money,
transport, reliability, quotas, shared code) and live inventory + leads ↔ PMS
(ids, availability semantics, the Booked handshake, transport, overlap). The
reports are kept beside this plan.

The three reports: `docs/audits/2026-09-15-pms-readiness.md`,
`docs/audits/2026-09-15-crs-pms.md`, `docs/audits/2026-09-15-live-inventory-pms.md`.

Not verified, and why:

- The CRS's live room types for Akkalkot are in Firestore, not the repo; I did
  not sign in to a production Firestore. The reference file is Phase 1 seed.
- Which n8n the CRS's `settings/webhook` points at (Firestore, same reason).
- Whether Amrapali Kolhapur is among the CRS's 28 (same).
- The PMS repository's visibility (`gh` is not on this machine's Git Bash).
- Whether the Hostinger n8n currently holds the Firestore credential and the
  WhatsApp token, and whether the four workflow files import cleanly there
  (the leads app's own plan has that step unticked).
- RES-1 was confirmed by reading on both PMS audits, not reproduced.

---

## 7 · Where the work lives

```
src/modules/crs/              api/src/modules/crs/              the CRS door and its Coming-soon page
src/modules/channel-manager/  (server: none until STAAH)         the channel-manager page (exists)
src/modules/guest-messaging/  api/src/modules/guest-messaging/  the leads page; later the messages module
src/modules/reservations/     api/src/modules/reservations/     the idempotent inbound booking (1.3, 3.4)
src/modules/inventory/        api/src/modules/inventory/        availability out (1.5)
src/modules/guests/           api/src/modules/guests/           sources and attribution (1.4)
src/modules/admin/            api/src/modules/admin/            integration keys, external refs (1.1, 1.2)
deploy/n8n.sh · deploy/n8n/   the workflow files the owner imports (new folder)
docs/API.md                   the contract (1.6)
```

Claim the folder in `HANDOVER.md` before the first edit; a migration number
before the first migration; the other systems' `.env` files are never opened.
