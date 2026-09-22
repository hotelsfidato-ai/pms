# Apps — desktop, kiosk tablet and phone (16 September 2026)

**Status: a plan, nothing built — and set aside for now.** The owner, 21
September (D21-98): the web version first and foremost; the desktop and
phone apps come later. When they do, the owner wants all three as installed
apps to sell. Waiting on decisions A1–A11 in § 7.

Asked for by the owner on 16 September: applications for desktop, tablet and
phone; Expo named for Android and iOS; "more connectivity … also give offline
capabilities as many places will have a server but not very reliable network,
so needs to ensure availability"; and for the tablet, "an app which will just
make sure that the tab is only of this software" — a locked kiosk.

---

## 0 · In one page

**One core, three shells, one new UI.**

| Surface | What runs there | Screens rewritten |
|---|---|---|
| Browser | today's Vite build, unchanged | none |
| **Desktop** | the same build inside **Tauri 2** — silent thermal printing, launch at startup | **none** |
| **Tablet (Android kiosk)** | the same build inside **Capacitor**, pinned by Lock Task Mode | **none** |
| **Phone** | a new, small **Expo** app — housekeeping first, 8–12 screens | new, small |

The desktop and the tablet are the *same* `dist/` in two different wrappers.
Only the phone is a second UI, and it is deliberately small.

**Expo cannot be the answer for all three**, and § 1 measures why: React Native
renders no HTML, and 48,435 lines of this app are HTML and CSS. Porting the 89
screens is a multi-month rewrite of a live hotel, for a desktop result worse
than the one already deployed.

**On availability:** a local server per property is the right end state and the
wrong first step. The client already holds a durable outbox; extending it to
the new shells buys most of the availability for none of the sync risk.
Measure the real outages first (Phase 3), then decide. § 3.

---

## 1 · What exists today — measured, not estimated

Counted on this machine, 16 September, branch `cp6`:

```
285 files, 48,435 lines     src/, excluding tests
 72 page components         src/modules/*/pages/*.tsx
 27 shared components       src/components/
 89 screens, 214 routes     the audit of 16 September
 60 server files            api/src/, excluding tests
```

The stack, and what it means for a port:

| Piece | Runs in a browser | Runs in React Native |
|---|---|---|
| React 19 | yes | yes |
| Tailwind v4 classes | yes | **no** — there is no CSS |
| Radix UI primitives | yes | **no** — DOM only |
| react-router 7 | yes | **no** — a different router |
| Recharts | yes | **no** — SVG and DOM |
| `window.print()` — [Invoice.tsx:185](../src/modules/finance/pages/Invoice.tsx:185) | yes | **no** |
| IndexedDB — the outbox, the query cache | yes | **no** |
| `src/data/repositories` (the seam) | yes | **yes** |
| `src/lib/*` — permissions, business date, CSV, offline tiers | yes | **yes, mostly** |

**What is already built and must not be rebuilt:**

- a service worker that precaches the shell, updates on prompt, and never
  caches the API ([vite.config.ts](../vite.config.ts))
- a durable outbox in IndexedDB, FIFO, one idempotency key minted per action
  and reused on every retry ([src/lib/outbox.ts](../src/lib/outbox.ts))
- the three-tier offline policy — queue / queue and warn / refuse — decided in
  one place ([src/lib/offline.ts](../src/lib/offline.ts))
- a runtime API address from `/config.json`, so the backend can move without
  rebuilding every client ([scripts/write-config.mjs](../scripts/write-config.mjs))

**Two facts that constrain every offline design below:**

1. `app.next_invoice_number()` ([011_model_additions.sql:225](../db/migrations/011_model_additions.sql:225))
   issues a **gapless** number per hotel per financial year by locking a row in
   `invoice_series`. GST requires the gaplessness. **Two writers cannot issue
   from one series.**
2. `ra_no_double_booking` is an exclusion constraint. Two clerks offline can
   both put a guest in 204, and the server refuses the second when signal
   returns — with both guests already upstairs. `offline.ts` already says so in
   its own words.

---

## 2 · The shape recommended

```
packages/core/      repositories, lib logic, types, the outbox rules
                    ── shared by everything; no DOM, no React Native

apps/web/           today's src/  →  dist/
                      ├── served by Firebase Hosting   (browser)
                      ├── wrapped by Tauri             (desktop installer)
                      └── wrapped by Capacitor         (tablet APK, kiosk)

apps/mobile/        Expo — phone only, its own screens, imports packages/core
```

**The API does not change.** Hono, a Firebase ID token and Postgres RLS are
already client-agnostic. A native app gets the same token and calls the same
endpoints; row level security decides what it may see exactly as today. CORS is
not even reached — a native `fetch` sends no `Origin`, so the allowlist at
[api/src/server.ts:61](../api/src/server.ts:61) does not apply to it.

---

## 3 · Availability on a bad network — three options

The owner's requirement: properties may have a local server, the network is not
reliable, and the software must stay available.

### Option A · Client-side only — extend what exists
Every device caches reads and queues writes. No new server.

- Survives an outage of hours. Already largely built.
- **Devices do not agree with each other.** Two clerks, two outboxes, one room
  204. The constraint catches it late.
- Cost: days.

### Option B · A property node — the local server is the authority
A small box per property runs the Hono API and Postgres. Devices on the hotel
LAN talk to it. It syncs to the cloud when the WAN returns.

- Full availability during an internet outage, **and the devices agree with
  each other**, because there is one authority on the LAN. This closes the
  double-booking hole that Option A cannot.
- Works with the gapless invoice series **only under one rule: the property
  node is the sole issuer of its own hotel's invoice numbers, and the cloud
  never calls `next_invoice_number()` for a hotel that has a node.** The table
  is keyed `(hotel_id, fin_year)`, so this partitions cleanly.
- The same rule for room assignment: the node owns its own hotel's rows. A CRS
  or OTA booking arriving at the cloud is queued *to* the node, never applied
  around it.
- Cost: weeks to months, plus a box, plus a backup per property, plus a way to
  deploy to seven of them. It is its own project with its own plan document.

### Option C · Local reads, cloud writes
The node serves reads; writes still go to the cloud.

- Fast, and a read never fails. But a write still fails during an outage, which
  is the case that actually hurts. Half the cost of B for a quarter of the
  benefit.

**Recommendation: A now, B later, and measure in between.** The outbox already
knows every time the API was unreachable and for how long. Report that as a
weekly figure per property (Phase 3), run it for a month, and let the real
numbers choose. If Akkalkot loses the internet for twenty minutes a week,
Option A is the whole answer and Option B is a box to maintain for nothing. If
it loses it for half a day, B is justified and the measurement will say so.

**Do not build B on a guess.** A sync engine that is wrong issues a GST number
twice, and this project has already written down that it refuses to do that.

---

## 4 · What each shell needs

### 4.1 Desktop — Tauri 2 · answered by the owner, 16 September

Chosen because silent printing matters.

- Wraps `dist/` unchanged. A roughly 5 MB installer, using the WebView2 already
  present on Windows 11. Electron would bundle a second Chromium of 150 MB or
  more that then needs patching, and buys nothing this app does not have.
- **Silent printing**: today [Invoice.tsx:185](../src/modules/finance/pages/Invoice.tsx:185)
  calls `window.print()` and a dialog opens. In Tauri the bill and the KOT go
  straight to the named printer. The screens that need it: Bill, Docket,
  Kitchen, Terminal, and the invoice.
- Also: launch at startup, no browser chrome, and a version the owner controls
  rather than whatever Chrome updated to overnight.
- **React Native for Windows is the wrong tool here** and is not proposed.

### 4.2 Tablet — Capacitor, pinned by Android Lock Task Mode

The owner wants the tablet to run this software and nothing else.

- **Capacitor rather than a TWA**, for one reason that matters here: Capacitor
  puts the built assets *inside* the APK, so the app opens with no network at
  all. A TWA fetches its shell from the web and depends on the service worker
  having been installed first. On an unreliable network that difference is the
  requirement.
- **The kiosk is Android, not the app.** Three ways, in order:
  1. **Android Management API** (Google, free) — QR-provision each tablet;
     policy installs the app, pins it, blocks settings, and lets a lost tablet
     be wiped. Right for seven properties. **Recommended.**
  2. `adb shell dpm set-device-owner` on a factory-reset tablet — free and with
     no external service, but done by hand per device and undone by a factory
     reset.
  3. Screen pinning — the user can leave it. **Not a kiosk.** Not proposed.
- Thermal printing on the tablet: a network or Bluetooth printer through a
  Capacitor plugin. The printer model has to be decided before this is built
  (A6).
- No app store is involved. These are the hotel's own tablets, installed
  directly, so Apple's rules and Google's review do not apply.

### 4.2a The POS: routing a KOT, and printing it — asked 16 September

The owner asked whether this system can **route a KOT** and **give a
printout**. Checked on 16 September; the two halves have different answers.

**Printing: built, and half-wired.**

| Piece | Where | State |
|---|---|---|
| Kitchen docket, thermal width, no prices ever | [Docket.tsx](../src/modules/pos/pages/Docket.tsx) | **built**, Print button at `:64` |
| Bill, thermal width | [Bill.tsx](../src/modules/pos/pages/Bill.tsx) | **built**, Print button at `:70`, opened from three screens |
| A docket number per docket, not per order | migration [049_kot_docket.sql](../db/migrations/049_kot_docket.sql) | **built** — starters, mains and a late dessert are three dockets, three numbers, one bill |
| Add-ons indented under the dish on the slip | migration 045 | **built** |
| **Anything that opens the docket** | — | **missing — POS-5.** The screen exists and no code navigates to it |
| **Silent printing** | — | **missing.** `window.print()` opens a dialog; in a kitchen every docket is then a dialog and a click. This is Phase 1's Tauri work |

**Routing: does not exist. There is no station anywhere in the schema.**

- `pos_menu_items` (migration 028) carries category, price, tax rate, active,
  sort order. **No station, no printer, no kitchen.**
- `pos_menu_categories` is the card — Starters, Main course, Spirits — and its
  own comment says it is hotel-scoped because "a kitchen usually serves the
  restaurant and room service from one card". Display order, not routing.
- `pos_sections` (migration 047) is A/C, Non A/C, Bar: **where the table is,
  not where the dish is cooked.**
- `pos_outlets` (migration 024) is a selling point with one revenue category.
  Coarse, and it is a credential, not a kitchen.
- [Kitchen.tsx](../src/modules/pos/pages/Kitchen.tsx) is **one** pass board,
  three columns, every line in the outlet.

So today a tandoor dish, a bar drink and a dessert land on one slip and one
board. What routing needs, and none of it is large:

1. `pos_stations` — hotel-scoped: Tandoor, Chinese, Bar, Dessert, each with a
   printer target.
2. `pos_menu_items.station_id`, nullable, falling back to a default station so
   an unassigned dish is never lost.
3. **The docket splits at fire time**: one Send, one docket per station. The
   number in migration 049 is per outlet per business date and must stay
   unique, so it carries the station — the tandoor chef reads "KOT-7 ·
   Tandoor".
4. `Kitchen.tsx` filtered per station. It already reads `useSearchParams`, so
   `?station=` fits the screen as built.
5. An admin screen to assign dishes to stations — the Menu screen is where it
   belongs.

**Estimate: 1–2 weeks**, inside `src/modules/pos` and `api/src/modules/pos`
only, so one agent can hold the folder.

**The order matters.** Stations must exist *before* the silent-printing work
is finished, or Tauri is wired to print every docket to one printer and the
print-target logic is written twice. Phase 1 therefore carries A11.

### 4.3 Phone — Expo

The owner answered "for all if needs" — staff and guests. They are two
different apps, and one of them cannot be built yet.

**Staff phone app — build this one.** Housekeeping first, then managers.
[PENDING.md:406](../PENDING.md:406) already records why a phone needs its own
screens rather than the desk's: the room controls take 376 px of an 812 px
screen. Expo earns its place here — real push notifications when a room is
released, the camera for a room photo, background sync, and an icon staff tap.
8–12 screens, not 89.

**Guest app — cannot start yet, and this is a finding.** A guest app is
booking, online check-in and messaging. All three modules are Coming-soon stubs
today: `booking-engine`, `online-checkin` and `guest-messaging` each hold two
`.tsx` files and no screens. There is nothing to put in an app. It also depends
on the CRS bridge, which is Phase 3 of
[HMS-INTEGRATION-PLAN.md](HMS-INTEGRATION-PLAN.md) and is waiting on the CRS's
API documents. **The guest app follows those; it does not lead them.**

---

## 5 · The order of work

Estimates, marked as estimates. Nothing here has been measured yet.

| Phase | What | Estimate | Blocks on |
|---|---|---|---|
| **0** | `packages/core` — move the seam and the pure logic out; make the outbox's storage injectable so SQLite can sit behind the same interface | 3–5 days | A1 |
| **0a** | **KOT stations** — `pos_stations`, a station per dish, the docket split at fire, the pass filtered, and the docket actually opened (POS-5). § 4.2a | 1–2 weeks | A11 |
| **1** | **Desktop Tauri** plus silent printing on the four POS screens and the invoice, one printer per station | 1–2 weeks | A2, A6, Phase 0a |
| **2** | **Tablet Capacitor** plus kiosk provisioning, one tablet at Akkalkot first | 1–2 weeks | A3, A4 |
| **3** | **Measure the network.** The outbox reports unreachable-minutes per property per week | 2 days, then a month of data | — |
| **4** | **Staff phone app** (Expo) — housekeeping, then the manager's figures | 4–6 weeks | A5, A7 |
| **5** | **Property node**, only if Phase 3's numbers justify it. Its own plan document first | 6–10 weeks | Phase 3 |
| **6** | **Guest app** — after `booking-engine` and `online-checkin` are built and the CRS bridge is live | not scoped | HMS Phases 1–3 |

Phase 0 is neither optional nor skippable. Every later phase imports it.

---

## 6 · What will bite

1. **Firebase persistence on Expo.** The web SDK needs
   `getReactNativePersistence(AsyncStorage)`, or every app close is a sign-out.
   Use an EAS development build from day one — Expo Go will not carry the
   native Firebase module later.
2. **The outbox's storage.** The rules port; IndexedDB does not. This is why
   Phase 0 makes storage injectable rather than leaving each shell to invent
   its own queue — the exact fault `offline.ts` already warns about, "a rule
   written in four places comes to be wrong in one".
3. **`/config.json`.** A native app has no origin to fetch it from. Tauri and
   Capacitor must ship it or fetch it from a known address; Expo takes it from
   EAS environment variables. The refusing behaviour in `write-config.mjs` must
   be kept, never defaulted — a build that cannot say where its API is must not
   produce one.
4. **The dev sign-ins.** `npm run build:app` fails if they reach the bundle.
   Every new shell must run through that same gate, or the guard is bypassed by
   a wrapper it has never heard of.
5. **The service worker inside Capacitor.** Two caches for the same assets.
   Inside Capacitor the assets are already local, so the service worker should
   be off in that build, or a stale copy of a stale copy becomes possible.
6. **Low-end Android.** Housekeeping phones at an Indian property are not
   flagships. An Expo app is heavier than the PWA on those; test on the actual
   handsets before committing to Phase 4.
7. **Apple.** Not reached by anything in Phases 0–4, because the tablets and
   desktops are installed directly. When the guest app comes, Guideline 4.2
   rejects wrapped websites — that app has to be built for the phone, which is
   another reason it is last.

---

## 7 · Decisions the owner must make — with recommendations

| # | Decision | Recommendation |
|---|---|---|
| A1 | Move the seam into `packages/core` as a workspace, before any app work? | **Yes.** Without it each shell grows its own copy of the rules, which is the fault the service split was done to prevent. It is also the only part of today's code the phone app can reuse |
| A2 | Desktop is Tauri wrapping today's build | **ANSWERED 16 September: yes**, because silent printing matters |
| A3 | Tablet is Capacitor, assets inside the APK, rather than a web wrapper | **Yes.** On an unreliable network, an app that opens without the network beats one that fetches its own shell |
| A4 | Kiosk by Android Management API (free, remote policy, remote wipe), or by `adb` device-owner per tablet? | **Android Management API.** Seven properties is too many to re-do by hand, and a tablet left in a lobby should be wipeable |
| A5 | Phone app first release: housekeeping only? | **Yes.** It is the one job genuinely done walking around, it is already the most offline-tolerant tier, and it is 8–12 screens rather than 89 |
| A6 | Which thermal printer, at the desk and at the POS — model and connection (USB, LAN, Bluetooth)? | **Not mine to guess — the hotel's own printers are the answer.** Phases 1 and 2 cannot be finished without it. One model across all seven properties if you are buying |
| A7 | Apple Developer account (99 USD a year) and Google Play (25 USD once) — open them now or at Phase 4? | **At Phase 4, and only if staff carry iPhones.** Nothing before Phase 4 touches a store; the tablets and desktops install directly |
| A8 | Does any property already have a local server, and what is it? | **Needed before Phase 5 can even be scoped.** If the answer is "the same box as n8n", that changes the design |
| A9 | Ship the network measurement (Phase 3) before deciding on a property node? | **Yes.** Building a sync engine on a guess risks issuing a GST number twice, and this project has already refused to do that |
| A10 | Guest app after `booking-engine` and `online-checkin` are built? | **Yes — it cannot be otherwise.** Both are Coming-soon stubs with no screens today |
| A11 | Build KOT stations (§ 4.2a) before the silent-printing work, and how many kitchens does 5 Elements actually have? | **Yes, before.** Otherwise the print target is written twice. **How many stations is the hotel's own answer, not mine** — if the kitchen is one room with one printer, stations are a switch left off and Phase 0a shrinks to the docket fix alone (POS-5) |

---

## 8 · What this plan does not cover

- The channel manager and the payment gateway, both excluded by earlier
  decisions.
- The CRS bridge — [HMS-INTEGRATION-PLAN.md](HMS-INTEGRATION-PLAN.md), waiting
  on the CRS's API documents.
- Any change to the API, the schema or row level security. Nothing here needs
  one. If a phase turns out to need a migration, that is a signal to stop and
  ask, not to write it.
