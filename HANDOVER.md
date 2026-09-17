# Handover — current state

**Last updated: 15 September 2026**, branch `cp6`. **This top section is
current.** Everything under "Archive" at the bottom is the 28 August state,
kept for the record and superseded.

If you are an agent picking this up: read this section to the end before your
first write. It is the whole brief — the owner should not have to explain any
of it again.

---

## 0 · Read in this order

```
1  HANDOVER.md   this section                        what is going on, what is next
2  MEMORY.md     skim; read 240 onwards properly     274 numbered defects — mistakes already made here
   and, if you are working on ONE service, its src/modules/<service>/MODULE.md, CHANGELOG.md, MEMORY.md
3  CHANGELOG.md  the top three entries               what the last sessions did
4  START-HERE.md sections 1 and 2                    how to run it on this machine
5  PENDING.md    all of it                           what is left, and what was decided against
```

`AGENTS.md` has the working agreement (one agent per service, its own copy,
database and ports; open the screen; a guard is not a guard until it has
refused something). Since 15 September the code is sorted by service — see
§ 3.0.

---

## 1 · What this is

A property management system for **Fidato Hotels**, an Indian group of seven
properties. **One property is live**: 5 Elements Akkalkot, 18 rooms.

```
LIVE   https://pms.fidatohotels.com     the screens   Firebase Hosting, project poms-fad05
LIVE   https://api.fidatohotels.com     the API       Oracle Linux, 130.210.49.220, /opt/fidato
REPO   github.com/hotelsfidato-ai/pms   branch cp6    push normally — the owner's instruction
```

React 19 + Tailwind v4 in `src/`, a Hono API in `api/`, Postgres with row-level
security in `db/`. Screens reach data only through `@/data/repositories` (the
seam); a test enforces it.

---

## 2 · Where it stands on 15 September

```
production runs     59ce389  (16 Sep)     the owner deployed both stages, checked read-only:
                                          API fc2efb0, restarted 15 Sep 19:13 GMT; website bundle
                                          index-B4PT_AOP.js carries the Coming soon pages
before that         1c2e5d0  (15 Sep)     EVERYTHING below is live — API 13:09 GMT, website after
deploy              done 15 Sep by the owner, a day early; checked afterwards (CHANGELOG)
local cp6           the same code; later commits are documentation only
go-live scope       211 / 228  (93%)      the 17 open are the channel manager (excluded)
                                          and the CRS bridge (waiting on its API documents)
staff-first plan    phase 1 of 4 built
clarity plan        all 4 steps built (step 4, 15 Sep: Start here, terms, empty states)
service folders     DEPLOYED 16 Sep (merged to cp6, stage A: server + website)
one hotel system    PLANNED 15 Sep — docs/HMS-INTEGRATION-PLAN.md; waiting on decisions D1–D14
coming soon         DEPLOYED 16 Sep (stage B, website only) — live on pms.fidatohotels.com
route + screen audit  16 Sep: 214 routes, 89 screens, PENDING checked — docs/audits/2026-09-16-…
defect logs         16 Sep: src/modules/<service>/DEFECTS.md — 26 open defects, each in its service
apps (desktop,      PLANNED 16 Sep — docs/APPS-PLAN.md; waiting on decisions A1–A11.
tablet, phone)      Tauri desktop and a Capacitor kiosk tablet wrap today's build; Expo
                    is a small staff phone app, not a port of the 89 screens
design critique     16 Sep — docs/audits/2026-09-16-design-critique.md. 20/40. CONTRAST
                    FIXED the same day, measured: six screens went to 0 failures. Three
                    P0s open — one booking with three statuses, /stay with no error
                    branch, /in-house printing charges under BALANCE
n8n on the box      LIVE 16 Sep at https://n8n.fidatohotels.com — the owner ran both steps.
                    Screen locked to 106.213.87.54, webhooks open, certificate auto-renews.
                    Checked from outside: editor 200, /healthz 200. netavark-firewalld-reload
                    ENABLED, so a PMS deploy no longer cuts it off (MEMORY 279) — recheck after
                    the next deploy. NOTHING connects it to the PMS yet: the machine key
                    (integration plan step 1.1) is not built, and n8n must never hold a staff
                    login while the server enforces no role on writes (PMS-2).
                    Earlier the same day: CAUSE FOUND — every PMS deploy's firewall reload
                    wiped n8n's container network rules.
                    Previously: CHECKED 16 Sep, read-only — NOT USABLE YET. DNS n8n.fidatohotels.com
                    → 130.210.49.220 exists, but the server was never set up for it: no
                    nginx site, no certificate. The container (n8n 2.38.5) has been up 6
                    days yet does NOT answer on 127.0.0.1:5678, and its log says it cannot
                    resolve any internet name (getaddrinfo EAI_AGAIN api.n8n.io) — so a
                    workflow calling WhatsApp, Meta or Firestore would fail too. Nightly
                    backups DO run (/var/backups/n8n, 13–16 Sep), on the same server
parallel agents     16 Sep — .claims/<service>.md (one file per service) and
                    `npm run lane -- <service>`, which sorts what a session changed into
                    yours / shared / somebody else's
mobile pass         BUILT 16 Sep on cp6 (731a3d4), NOT DEPLOYED — on a phone every list
                    built on DataTable is a card list; measured before and after at 375px
dynamic pricing     BUILT 16 Sep on cp6, NOT DEPLOYED — migration 090, the API and the
                    Pricing screen. Nothing is priced, and no property has a base until
                    somebody sets one. docs/PRICING-PLAN.md; P5 is open
```

**Deployed 15 September** — all of it:

> **088 has been live since 15 September, 13:09 GMT: the account-takeover hole
> is closed** (MEMORY 263). `demo@fidatohotels.com` still holds the owner role
> at 5EL with a shared password — the owner left it on for testing.

```
088   SECURITY: adding somebody can no longer take over an existing account
089   Start here: the per-person "Got it" flag (clarity step 4)
      the City ledger no longer invents a contact ("Mr. Agoda") for every account
085   a walk-in records the Walk-in channel; back-fills FH-2609-5001 on deploy
      the rebuilt stay panel (owner's eZee-style reference)
086   a departed group room says which room it was in
      the dev test sign-ins can never reach a built app (build fails if they do)
087   staff-first phase 1: Dashboard, first screen per person, Room type/Floor
      remembered per person, "Reception can use the POS" switch per hotel
      front-end pass: sign-in screen, Dashboard icons, report header facts, Manager report CSV
      one vocabulary: room states, menu, headings, browser tab titles
      one main action per screen: 67 confirms and main actions declared, two guards
      a menu per person, and "Find a screen" (Ctrl K) to reach everything else
      help where the question is: Start here per role, tap-to-explain terms,
      an empty state on every list, Housekeeping's loading/error/empty states
```

**Gates, measured 15 September on this machine:**

```
db/tests/run.sh         588 assertions passed        scratch database, dropped after
db/tests/rerun.sh       89 migrations re-runnable    scratch database, migrated twice
cd api && npm test      359 passed, 28 files         never `npx vitest run` inside api/;
                                                     it cannot reach Firebase (MEMORY 264)
npx tsc -b              clean
npx vitest run          197 passed, 13 files
```

---

## 3 · What to do next, in order

Each item is scoped, with its "done when". **Ask the owner before building
anything the item marks "ask first" — and before any other doubt.** That is
their standing instruction: *"before you have a doubt you need to ask me and
clear it up, then proceed."*

### 3.0 · One folder per service — BUILT 15 September, on branch `service-folders`

The owner asked (15 September) for the code to be split so each service —
front desk, reservations, housekeeping, inventory, CRS, reports, POS and the
rest — has its own folder, so agents can be given one service each and run in
parallel. **The plan is `docs/SERVICE-FOLDERS-PLAN.md`.** The owner took
every recommendation: screens and server per service with the database
history shared; all folders, the six not-built ones brief-only; now, with
every other agent paused; notes per service with a root index.

**Built and verified.** Eighteen service folders under `src/modules/` —
thirteen built (front-desk, reservations, housekeeping, inventory, guests,
finance, night-audit, pos, banquet, stores, reports, admin, channel-manager)
and five with a brief and no code (crs, payments, booking-engine,
guest-messaging, accounting). Each built service has its screens, menu
entries (`nav.ts`), addresses (`routes.tsx`), data and tests in
`src/modules/<service>/`, its server routes in `api/src/modules/<service>/`,
and its `MODULE.md`, `CHANGELOG.md` and `DEFECTS.md`. The core stays where it
was. Nothing a person sees changed: every role's menu (1,023 facts), all 73
screen addresses and the API's 214 routes are proven identical to the start,
and every gate is green (CHANGELOG, 15 September, "the move").

**How to work now: `AGENTS.md`.** One agent per service, claimed below, in
its own git worktree with its own database and ports; another service only
through its front door (`index.ts`, enforced by `src/test/boundaries.test.ts`);
a migration number claimed first (`src/test/migrationNumbers.test.ts`).

**Waiting on the owner:** merging `service-folders` into `cp6`, and deploying
it on its own. And the defects the briefs found (PENDING § 2a) — each a
change somebody would see, so each is the owner's call.

### 3.0a · Every missing service — a folder and a Coming soon page — BUILT 16 September, on branch `coming-soon`

The owner, 16 September: "a HMS with all the requested services which are
currently missing in the current system". Asked how, they took every
recommendation: a folder and a Coming soon page for every missing service
(all twelve), one "Coming soon" section at the foot of the menu for the
owner, admins and general managers, built on a branch after the
service-folder move and deployed after it.

**Built.** Twelve new folders — leads, marketing, crm, spa, online-checkin, laundry, contracts, revenue-management, reputation, loyalty, guest-services, equipment — each
with its brief, log, memory, empty front door, menu entry, address and page;
the five brief-only folders (crs, payments, booking-engine, guest-messaging,
accounting) got a page, an entry and an address; the channel manager's entry
moved into the section and its page is now guarded. **Thirty folders: twelve
working services, eighteen not built.** One shared page
(`src/pages/ComingSoon.tsx`): what it will do, what it needs, where it stands —
nothing invented. Who sees it: `seesComingSoon` in `src/lib/permissions.ts`,
asked by the menu and by each route's guard alike. Reception's menu is
unchanged; the only other change is that Reception, Hotel Manager and Viewer
can no longer find or open the channel manager's page (they could by search
before).

**The build order is the owner's to approve, one service at a time** — root
`CHANGELOG.md`, 2026-09-16. Nothing in any Coming soon folder is built until
the owner says which.

### 3.0b · One hotel system — the CRS, the live inventory, the leads, a channel manager — PLANNED 15 September, ASK FIRST

The owner's goal of 15 September: the CRS (`D:\fidato crs`), the live
inventory and WhatsApp leads app (`D:\fidato tools\new live invetory`) and a
channel manager (definition arrives 16 September) become modules of one
system, with a central CRM, later sold as a product. The plan is
`docs/HMS-INTEGRATION-PLAN.md`; the three audits behind it are in
`docs/audits/`. **Nothing is built. Fourteen decisions (§ 5 of the plan) wait
on the owner; nothing starts before D1, D2 and D4, and D3 (which rooms 5
Elements actually has — the three systems disagree) blocks anything to do
with availability.**

First steps once answered: the "Connections — Coming soon" menu section
(plan step 0.2, folders `crs`, `channel-manager`, `guest-messaging`), then
RES-1 and migration 008 (0.6), then the three doors of Phase 1 in six
folders at once. Two owner actions are urgent and not code: the Meta
WhatsApp token expires about 27 September; the CRS repository is public and
carries a commission figure per hotel (marked simulated — D8).

### 3.0c · Desktop, kiosk tablet and phone apps — PLANNED 16 September, ASK FIRST

The owner asked on 16 September for applications on desktop, tablet and phone,
named Expo for Android and iOS, and gave the reason: **"many places will have a
server but not very reliable network, so needs to ensure availability"** — and,
for the tablet, **"an app which will just make sure that the tab is only of
this software"**, a locked kiosk. The plan is `docs/APPS-PLAN.md`.

**Nothing is built.** The shape recommended is one shared core and three
shells, because React Native renders no HTML: of the 48,435 lines measured in
`src/`, the 72 pages and 27 shared components are Tailwind, Radix and
react-router, and only the seam and `src/lib` port to a phone:

```
desktop   Tauri 2 wrapping today's dist/ — ANSWERED: yes, silent printing matters
tablet    Capacitor wrapping the same dist/, assets inside the APK, pinned by
          Android Lock Task Mode (Android Management API recommended, A4)
phone     Expo — a NEW small staff app, housekeeping first, 8–12 screens.
          The guest app cannot start: booking-engine, online-checkin and
          guest-messaging are Coming-soon stubs with no screens
```

**On availability, the plan refuses to guess.** A property node (a local
server that is the authority for its own hotel) is the right end state, and it
is the only option that closes the offline double-booking hole. But
`app.next_invoice_number()` is a gapless statutory GST counter, and a sync
engine built on a guess issues one twice. So Phase 3 measures the real outage
minutes per property from the outbox for a month, and the numbers decide.

**The POS, asked the same day: can it route a KOT and print one?** Measured
against the schema (plan § 4.2a). **Printing is built and half-wired** — the
docket screen is real, thermal width, no prices, with a Print button, and
migration 049 already numbers each docket rather than each order. But
**nothing in `src/` opens it** (POS-5, new in the POS defect log), and
`window.print()` is a dialog, not silent. **Routing does not exist at all**:
there is no station in the schema, so a tandoor dish, a bar drink and a
dessert share one slip and one pass board. Stations are Phase 0a, 1–2 weeks,
inside the `pos` folders only — and they come **before** the Tauri printing
work or the print target is written twice.

Eleven decisions (§ 7 of the plan) wait on the owner. A2 is answered. Nothing
starts before A1 (the `packages/core` extraction, which every later phase
imports), and Phases 0a, 1 and 2 cannot finish without A6 — which thermal
printer the desk and the POS actually use — or A11, how many kitchens 5
Elements actually has.

### 3.0d · The phone — BUILT 16 September, on cp6, not deployed

The owner asked for the mobile experience to be improved, and chose it ahead
of the pricing build.

**Measured first**, at 375px signed in as a reception clerk. No screen scrolled
the page sideways — but six screens a receptionist lives in (Arrivals, In
house, Walk-ins, All bookings, Guests, Folios) put a table wider than the phone
inside a sideways scroller, so reading one guest's row meant swiping right and
losing their name off the left edge. Housekeeping, the one screen built for a
phone, had **36 controls under 44px**.

**Done** — in `src/components/ui/DataTable.tsx`, the shared core, so it reaches
every screen that uses it: below `sm` each row is a **card** (first column the
heading, every other column a labelled line), the table is unchanged from `sm`
up, sorting keeps its own control, and a column the table hides on a narrow
screen (`hideBelow`) **is shown in the card** — the card has the room the table
did not. Housekeeping's assignee picker and out-of-service button are 44px.
`src/components/ui/DataTable.test.tsx` fails if a column goes missing from the
card, and was seen to fail.

**Re-measured**: six screens render cards (10, 9, 21, 86, 32 and 7 of them),
nothing outside the viewport, no page scroll, Housekeeping 0 small targets.

**The five stay screens use their own cards — the owner's decision, 16
September.** `src/modules/front-desk/components/StayTable.tsx` already had a
card view (`StayCards`) behind a table/cards toggle remembered per device, and
its default was the table — so a clerk who never found the toggle met the
sideways scroller anyway. Below `sm` those cards now render whatever the toggle
says, and the toggle hides; at a desk nothing changed. Measured at 375px: 10 ·
9 · 21 · 86 · 5 cards, nothing outside the viewport; at 1280: the table and the
toggle as they were.

I should have grepped before writing a generic card renderer, and there are now
two of them. **`src/modules/front-desk/DEFECTS.md` FD-4 says what a future
session needs**: on these five screens `DataTable`'s card mode still renders
inside the wrapper that hides it, which is dead markup and not a bug to tidy
away — removing that wrapper shows both.

**Still to do when the owner wants it:** they also asked to "pull mobile design
references" — a reference pass on the phone layouts, not started.

### 3.0e · Dynamic pricing — one base, everything else a difference — PLANNED 16 September, ASK FIRST

The owner's instruction, 16 September: a Deluxe, one person, no breakfast is
the cheapest thing sold and **is the base**; everything else is joined to it by
a difference, so changing the base moves the whole system. Their seven
decisions are in § 4 and the plan is **`docs/PRICING-PLAN.md`**.

**P1 is answered (16 September): counting starts at the first person** — two
adults are the base plus one extra adult. And room configuration is separate
from price: a room type gains a **category**, so the Deluxe variants group
together while each stays its own sellable type.

**Phases A, B and C are built** — migration 090, the API, and the screen at
`/h/:code/pricing` — and proved end to end at 1280 and 375. **Nothing is
priced**: no property has a base until somebody sets one, and until then every
price answers exactly as it did before.

**What is left**
- **P5, the owner's** — a meal-plan difference is charged once, for the person
  the base covers. Whether it should also be charged for the second person
  onward, or whether the extra-adult figure already covers their meals, is
  `docs/PRICING-PLAN.md` § 6.
- **Phase D** — Superior stops carrying its own price and becomes a
  difference. The owner does that **on the screen**; nobody else types that
  number.
- **INV-5** — the Rate calendar writes prices with no guard at all. Closing it
  takes something away from reception, so it waits on the owner.
- The development database has a `pricing_basis` row for 5 Elements
  (Superior · Room Only) that appeared while the screen was open on 16
  September. Harmless — development only, and nothing derives without a base
  figure — but do not assume it was meant.

**Read § 4 before planning anything here**, especially: the base is not the
default, not everything is derived, and the screen ships with every figure
unset.

### 3.0h · Stock and equipment — APPROVED 16 September; Phase 0 DONE

`docs/STOCK-AND-EQUIPMENT-PLAN.md`. The owner asked for two kinds of inventory
planned as a multi-agent job: **equipment** (hotel, restaurant, rooms, with
repairs and buying) and **consumables** (oil, gas, drinks, spares, and the
crockery and cutlery). Measured first: consumables are two-thirds built in the
`stores` service, crockery a third, equipment not started, repairs (058) and
purchase approvals (076) are half-pieces. **Nothing starts until the owner
answers S1–S11 (plan § 5).** Phase 0 is the master's: suppliers and locations,
built once, before any lane.

**APPROVED, all eleven, and the permission table (plan § 6). Phase 0 DONE**
(5a5d746): migration 094, three permissions pinned, the menu names, the Purchasing
and Room systems folders. **Next: 1A Store and 1B Equipment, in parallel.**
**STO-1 IS STILL OPEN** — reception can open the Store; 1A's first task.
**Migration numbers changed rule (plan § 7):** a chat takes the next number after
cp6's highest; the master renumbers at merge. The 094 once given to admin is void.

**S12–S15 APPROVED the same evening — one system, one Inventory Manager.**
Equipment leaving the store waits for the **Inventory Manager** (the `stores`
role renamed; key unchanged); the owner, admin or GM may decide instead; anybody
who sees equipment may ask; stock needs no approval. **Built by the master:**
migration **095** (approval kind `equipment_issue`, `also_decided_by` backups,
the rule at every property and every new one), `api/src/routes/approvals.ts`
(backups decide; the queue no longer hides requests others raised; the asker is
no longer offered Approve), the role's name and equipment grants. Next free
migration after that was 096 — **now taken too, see below.**

**Audit and round 3, later on 16 September.** Merged: **NA-2** (night audit
refuses a stale close — screen opened, refusal tried on the local API) and
**STO-1** (the Store refuses reception on page and server — seen). The owner
answered: **names YES** (approvers see who asked, the asker who decided, the
store keeper who moved stock), **S16** (the Inventory Manager approves a
retirement too, one shared inbox). Built by the master: **migration 096**
(`app.colleague_name`, approval kind `equipment_retire` with its rule),
the approvals queue names the people involved. **Equipment 1B is committed but
NOT merged** — written before S12–S16: its migration is numbered 095 (renumber
to 097 at merge), its role copy predates the Inventory Manager, the
leaving-the-store approval is not built, and its retirement approval must move
to the shared inbox. **Master owes:** a screen to add places and suppliers
(nothing can add one — so no store exists to leave; who may add them is ASKED of
the owner), Equipment and the Inventory Manager's and Housekeeping's working
menus at the equipment merge, EQ-2. **Next free migration: 097.** Owner chose:
**deploy one release** after these merges (steps given in chat, § 9 shape).

**"Finish your pending tasks" — the master's list, done 16 September evening.**
- **Equipment 1B merged** (`a093808`) — S12–S16 built by the chat; migration 097.
- **MEMORY 284: 095 could not be replayed** — every deploy after the next would
  have failed. Guarded 095/096; `db/tests/rerun.sh` now adds a property between
  passes (it was green on an empty database). **The replay test is a gate.**
- **RES-2 closed** — walk-ins use `app.next_reference`. **EQ-2** — migration 098,
  a property with equipment or stock is refused deletion by name. **STO-9** — under
  a finger, dialog Close 44px, inputs and selects 44px with 16px text; desk unchanged.
  Equipment in Housekeeping's menu. Vite serves a chat copy's junctioned node_modules.
- **Places and suppliers** (`/h/:code/places`, core: `api/src/routes/places.ts`,
  `src/pages/PlacesAndSuppliers.tsx`) — the door 094 lacked. **Changed by the owner,
  admin and GM only** (the roles already holding everything on stock and
  equipment); **whether the Hotel Manager and Inventory Manager may too is ASKED of
  the owner** — the owner declined the question once; widening is `PLACE_KEEPERS`.
- **Not done, and why:** HK-1 (the owner deferred it), FD-1 (the owner must pick
  which "in house" number is the definition), the stray typed notes inside comments
  in `navigation.ts` and 068 (left: they may be the owner's), EQ-3 (dev only).
- **Next free migration: 099.**

**17 September morning — the audit, and the Reports page.**
- **LIVE: the owner deployed at 22:00 on 16 September** — server `eaf6916`, website
  published 22:02 (Inventory Manager, Rooms and rates, Store and equipment are on it).
  Everything saved after 22:00 is NOT live: equipment register, places and suppliers,
  walk-in references, 098, touch targets, and the replay guard for 095/096 — the next
  deploy must bring that guard before any deploy after it.
- **MEMORY 286: my worktree clean-up deleted `node_modules/.bin` and `api/node_modules`**
  (git followed the junctions). Every chat's copy was broken overnight. Fixed with
  `npm ci` in root and api; both servers start, every gate passes.
- **Audit, every gate on cp6 `014b4b2`:** web 269 · API 756 · database 736 (98) ·
  replay 98/98 · build clean. The Night audit screen test failed once under load
  (1s findByRole) and passed 3/3 alone — for the night audit chat.
- **Store chat saved STO-2 to STO-11 on `stores/phase-1a`, not merged.**
- **Reports page** https://claude.ai/artifact/7y6HN9Ug7DZAttxoMX5ek6 — built from
  `docs/reports/report-<date>.json` by `docs/reports/build.py`. A scheduled task
  (`fidato-daily-report`, ~09:07 daily, runs while the Claude app is open) audits the
  previous day and adds it; it commits `docs/reports` only and never pushes.

### 3.0g · Round 1 of the service chats — who holds what, 16 September

The owner talks to the master chat; the master hands out the work. Checked for
overlap before handing out — not by service name, by the files each fix
touches.

```
MERGED       16 Sep into cp6, every gate green (CHANGELOG "round 1 merged"):
             reservations RES-3 + RES-1 (091) · master 092 + 093 · inventory INV-3,
             OOS test, INV-5 · reports REP-1/2/3 · pos dates, POS-4, POS-3 ·
             night-audit NA-1 read-only + NA-2 FOUND
IN PROGRESS  uncommitted, not merged: front-desk (8 files) · admin · banquet ·
             finance · guests · housekeeping · stores
NEXT         RES-2 part 2 — reservations (groups.ts) + front-desk (operations.ts) switch
             to app.next_reference; both inline generators still truncate
MASTER       ADM-3 · FD-1 and the numbers that disagree
DECIDED      16 Sep, the owner: NA-2 is fixed by REFUSING A STALE CLOSE (the screen
             sends the day it is closing; the server refuses if that day is already
             closed, changing nothing) · cp6 goes live AFTER the NA-2 fix, as ONE
             release · the claims fix: DONE (MEMORY 281, npm run claim) · old copies
             are removed once their chats are closed
PAIRED LATER front-desk + finance   FIN-2 and the /in-house BALANCE — ONE job:
                                    getFolioBalance is finance's, and front desk
                                    reads it for check-out AND that column
             master + housekeeping  HK-1 needs a migration and the shared live channel
             master + admin         ADM-1 needs a migration on the shared audit trigger
             pos + finance + banquet  BQ-1
             reservations + front-desk RES-2 part 2, after the master merge
OWNER DECIDES POS-2 · POS-5 · NA-1 · API-2 · invoices ₹0 vs dash
BATCH LATER  GUE-1 · BQ-2 · FIN-1 · ADM-2  (a heading, a comment, two cards)
```

**Off-limits in round 1, because a running chat depends on them:**
`front-desk/components/StayTable.tsx` (reservations' All bookings screen),
`front-desk/pages/InHouse.tsx` and every reader of `getFolioBalance` (the paired
job), `api/src/modules/front-desk/operations.ts` (RES-2 part 2), and how rooms,
in-house guests and ADR are COUNTED anywhere (the master's). **094 was
assigned to admin** for ADM-1 on 16 September — **and then taken by the master's
Phase 0 (suppliers and locations), MEMORY 282.** Admin's migration takes the next
free number when it merges; the master renumbers it. Next free on cp6: **095**.

**Found starting the local system, 16 September:** twelve service copies exist
(`git worktree list`) and `.claims/` shows none of them. A claim file written
inside a worktree is only visible in that worktree — the claim design cannot
work across copies as built. Not yet fixed; the owner has been told.

### 3.0f · The design critique — 16 September

`docs/audits/2026-09-16-design-critique.md`. Two isolated agents: a design
review and a mechanical detector with live browser measurement. **20 / 40**,
and the verdict worth keeping is that the product IS authored — the dash rule,
the offline refusals, tap-not-hover — but **the authoring stops at each
service's edge**, which one agent per service will widen unless the shared kit
becomes a contract. `FilterBar` and `moneyCompact` have zero consumers.

**Fixed on the day** (the owner chose it first): contrast, system-wide.
`grey-400` is no longer a text colour, four darker steps of the brand hues
carry small text, the primary button fills with `orange-600`. Re-measured in
the browser: `/stay` 39 contrast failures → 0, and five other screens → 0.
`CHANGELOG.md`, 16 September (contrast).

**Open, in the order the owner chose:**

1. **The numbers that disagree** — one booking reads three statuses, "in house"
   counts four ways, ADR prints two ways. The owner chose this next. It is not
   a UI pass: one derived status and one balance per stay, computed once; one
   date format and one money format everywhere.
2. **`/stay` has no error branch** — twelve grey bars forever on the front
   desk's home screen, under a banner promising the opposite.
3. **`/in-house` prints charges under BALANCE** — one query first, to say which
   of the two figures is wrong.
4. Then the two fix lanes, approved: **distill + clarify**, front-desk +
   housekeeping in one, pos + inventory + finance in the other, so no two
   agents ever open one file.

**Each service's own findings are in the audit**, written so a chat working on
one service reads its section and nothing else.

### 3.1 · Clarity step 2 — one primary action per screen — DONE 15 September

Every dialog's confirm and each screen's main action now declares itself:
primary for the act, danger for a destructive one (Void, Cancel the function).
The bill's main action follows its state — Settle while money is owed, Check
out once it may happen, never both. The Groups page's fake toggle is the
`Segmented` control. `Button` carries `data-variant` for tests.

Two guards, both seen to fail: `src/components/ui/primaryAction.test.ts`
refuses any button beside a Cancel that does not declare a variant, and
`App.test.tsx` "shows one main action on each tab of the stay panel". **Any
new dialog must pass the first.** Details: `CHANGELOG.md`, 15 September (step 2).

**Start at 3.2.**

### 3.2 · Clarity step 3 — the menu by person — DONE 15 September

Each role's sidebar is now the menu it works from — `WORKING_MENUS` in
`src/components/app/navigation.ts`, assembled since the service-folder move from
the `workingMenus` each service's `nav.ts` declares. The owner's lists:

```
reception        Dashboard · Rooms · Calendar · Arrivals · In house · Walk-ins ·
                 All bookings · Guests · New booking · Cashiering
                 + Tables · Till · Terminal · Close restaurant day when "Reception can use the POS" is on
waiter (pos)     Tables · Till · Terminal · Close restaurant day
chef             Kitchen
kitchen manager  Kitchen · Menu · Close restaurant day
housekeeping     Housekeeping · Work orders · Store
stores           Store
everybody        Reports lists only Night audit · All reports · Manager report
owner, admin, gm  + Coming soon: the 18 services not built yet, alphabetical (16 Sep)
owner, admin, gm, hotel_manager, finance, read_only — every section they may open
```

Reception went from 47 entries (live build) to 15. Housekeeping, kitchen and
stores have no Dashboard in their menu and land on their own work
(`workingHomeFor`). **Nothing changed a permission** — everything a role may
open is reachable by **Find a screen** (top bar, Ctrl K, or the button at the
foot of the menu), which also understands retired words ("folio", "day end",
"floor"). The palette did not exist before (MEMORY 261). The restaurant roles
and housekeeping could not see their own screens until now (MEMORY 260).

**A new screen must be added to the right working menus, or it is search-only
for those roles.** Give it `keywords` for the other words people use. Guarded by
`navigation.test.ts` (each list pinned; search still reaches what left a menu)
and App.test "find a screen" — all seen to fail.

**Start at 3.3.**

### 3.3 · Clarity step 4 — help where the question is — DONE 15 September

The owner chose a card per role, gone when they tap "Got it" (not after a
count of sign-ins, which could hide it before anybody read it).

- **Start here** (`StartHere.tsx`, words in `startHereCards.ts`): reception
  five jobs, housekeeping three, the waiter three, the chef one; none for the
  GM or the owner. Each job links to its screen and names the real button.
  Shown only on the person's landing screens (`START_HERE_ON`) — each screen
  places it, because the kitchen board covers the display and the Rooms grid
  is full height. "Got it" is secondary (one orange button per screen) and is
  remembered on the server (089, the person's own row only); the account menu
  brings it back.
- **Terms** (`Term` in `components/ui`, words in `src/lib/glossary.ts`): tap,
  not hover. Every line is checked against the code that makes the figure.
  Never inside a link — a linked Dashboard tile takes none.
- **Empty states**: every table says what belongs there; Housekeeping has
  loading, error and empty states for the first time (MEMORY 269).

**If a button's label changes, `startHereCards.ts` is the other place to
change it** — the card names buttons. **If a calculation changes, its line in
`glossary.ts` changes with it.** Guarded by App.test "start here" and "trade
words", 089's database block and `firstScreen.test.ts` — all seen to fail.

**Done when** someone who has never seen the system books, checks in, takes
a payment and checks out without being told anything. **That needs a real new
person — the owner's to arrange.** It has not been run.

**Start at 3.4 — and ask first.**

### 3.4 · Staff-first phase 2 — reports in the owner's layout — ASK FIRST

The owner's eight eZee exports are in `D:\reports fidato\` (outside the repo;
never commit them). `docs/REPORTS-SPEC.md` was derived from them. Scope:
one shared report layout (hotel name top left in navy, title top right in
maroon, the "As on / PTD / YTD / Currency" line, dotted rules, footer
`date · time · user · Page x of y`), PDF on A4 and Excel on every report, the
Manager report's five missing sections, and the full four-page Night Audit
report (13 sections — the audit *runs* today, the printed report does not
exist). **Done when** each report run for 25 Aug 2026 on the demo data matches
its PDF line by line — e.g. Manager report Room Charges today `12,142.88`,
PTD `419,578.77`.

Ask before building:

- **Excel means a real `.xlsx`, or is the CSV that Excel opens enough?**
  `src/lib/csv.ts` deliberately avoided a spreadsheet library. Do not add one
  unasked.
- **PDF generated in the browser or on the server?**

### 3.5 · Staff-first phase 3 — documents on the voucher template — ASK FIRST

The CRS voucher `FH-2026-00002` is the template. **It is not in the repo or
in `D:\reports fidato\`** — it was sent in a chat. Ask the owner to save it
into `D:\reports fidato\` first. Needs from the owner (all recorded in
`PROGRESS.md` → "Still needing a person"): Fidato's exact registered name as it
prints, the GSTIN for bills (the voucher shows `27AAGCF5655F1ZI`), bank details
per hotel, policies and times, and **how WhatsApp and email should send**
(through the n8n on the box, or a direct service). Decided already: a
**billing entity** setting chooses the legal name + GSTIN, Fidato's by
default; **bank account is per hotel**; documents get **WhatsApp and email**
send options; hotel names print as "5 Elements By Fidato Hotels".

### 3.6 · Staff-first phase 4 — every reservation task in three screens or fewer

Measure first: a table of every reservation task with its screen count today,
then cut each one over 3. Step 3.2 above is this phase's "menu hubs", done
early.

---

## 4 · Decisions the owner has made — do not re-ask

```
16 Sep   the desktop app is a real installed application, because silent thermal printing matters (APPS A2)
16 Sep   the tablet is Android and must be locked to this software alone — a kiosk, not a browser
16 Sep   the phone app is for staff AND guests eventually; the reason for all of it is availability
         on a bad network, at properties that may have a local server
16 Sep   PRICING: the base is Deluxe · one person · room only; everything else is a difference from it
16 Sep   ⚠ THE BASE IS NOT THE DEFAULT. Single occupancy is the base a price is built from; what a
         room is sold as by default (room_types.base_occupancy, 2 today) is a different setting and
         is NOT changed by the pricing work — the owner's words: "single occ is not the default
         option but it is the base, so base and default in setting rooms are different"
16 Sep   not everything will be derived from the base — the owner will set some prices directly
16 Sep   the pricing screen ships with every figure UNSET (a dash) and the owner types them in
16 Sep   Superior stops carrying its own price and becomes a difference; the dated rate row stays as a typed price
16 Sep   D10: bookings from SU and every outside system ARE held to stop-sell and minimum
         nights, and a price of 0 is REFUSED unless marked complimentary. The desk keeps its
         own judgement — these bind machines only
16 Sep   D3: 5 ELEMENTS AKKALKOT HAS 18 ROOMS. The PMS is right. One is lived in by the GM,
         which is why the owner's audit counted 17 — that room is taken off sale, not deleted.
         The owner calls this "NC"; the database already has it as a room block with reason
         house_use and no end date (migration 022), which availability subtracts (044)
16 Sep   INV-5: owner, admin and GM may set prices. PLUS A NEW STAFF ROLE — a person, "like a
         revenue manager", who changes prices and pushes them to the OTAs when the owner, admin
         and GM are not there. SU is only the system interface; it does not set prices.
         APPROVED 16 Sep as REVENUE MANAGER (named so it is never confused with the channel
         manager service). CAN: set prices (Pricing, Rate calendar, Rate plans); set
         restrictions (stop sell, minimum nights, closed to arrival/departure); see
         availability, all bookings, occupancy and ADR reports, OTA commission. CANNOT: bills,
         payments, invoices; guest details and ID documents; staff and roles; property and room
         setup; check-in and check-out; the POS
16 Sep   MIGRATION NUMBERS ASSIGNED by the master: 091 reservations (RES-3), 092 master (the
         reference generator), 093 master (the revenue manager role)
16 Sep   BUILT on branch master/references-and-revenue-role (55157bd), NOT on cp6: 092 and 093,
         every gate green except migrationNumbers, which fails on the gap at 091 until the
         reservations chat's RES-3 lands. MERGE ORDER: reservations (091) → this branch →
         then RES-2 part 2, where reservations (groups.ts) and front-desk (operations.ts) each
         switch their door to app.next_reference. Both inline generators also TRUNCATE past
         four digits (MEMORY 280) — part 2 removes them
16 Sep   RES-2: every NEW booking reference is FH-<hotel code>-YYMM-<number>, e.g.
         FH-5EL-2608-4858. Old bookings keep the references they were given
16 Sep   "NC" = NOT FOR SALE, HOUSE USE. Already possible on the Housekeeping board (take the
         room out of service, reason house use, no end date); the reason is now labelled NC
16 Sep   the mobile pass comes first, then the pricing build
16 Sep   PRICING COUNTS PEOPLE FROM ONE: the base is one person, so two adults = base + one
         extra adult, three = base + two. The extra-adult and extra-child figures are set like
         any other price. Nothing already priced moves — a price says what it covers
         (rates.covers_persons), and today's rows keep the room type's own figure
16 Sep   ROOM CONFIGURATION AND ROOM PRICE ARE TWO THINGS. A room type gains a CATEGORY, so
         Deluxe, Deluxe valley view and Deluxe with an extra bed group under Deluxe while each
         stays its own sellable type with its own capacity and its own difference from the base
16 Sep   the Room setup field "The rate covers" will need a truer name once the base covers one
         person — the owner sees that screen before the wording changes
16 Sep   pricing differences are in RUPEES, never percentages
16 Sep   breakfast and the other meal plans are priced PER PERSON
16 Sep   a difference may be set for a period; where nothing is set for a date, the base applies
16 Sep   a typed price applies to ONE date or to a date range — the screen offers both
16 Sep   one Pricing screen, shaped like a calendar: the dates, the base and each difference on it
16 Sep   every missing service gets a folder and a Coming soon page — all twelve, not only the four asked for
16 Sep   one Coming soon section at the foot of the menu, owner, admin and GM only; reception unchanged
16 Sep   the Coming soon work goes on a branch after the service-folder move and deploys after it
14 Sep   "Group" is called Dashboard: tiles for the chosen hotel, a table of all hotels below
14 Sep   Rooms and Calendar are two menu entries with their own addresses
14 Sep   first screen after sign-in: the GM sets it per person; the person can change their own
14 Sep   the Room type / Floor switch stays, remembered per person on the server
14 Sep   "Reception can use the POS": a per-hotel switch — ON at 5 Elements, OFF for new hotels
14 Sep   n8n: screen locked to the owner's address, webhook paths open to everybody
14 Sep   legal name on a bill is Fidato's, chosen in settings; bank details per hotel
15 Sep   impeccable skill: WRITTEN GUIDANCE ONLY — never run its downloaded binary
15 Sep   Bill at the desk, Folio in Finance
15 Sep   a shorter menu keeps everything reachable by search
15 Sep   report names keep their words, in sentence case
earlier  channel manager and payment gateway excluded; attachments parked;
         housekeeping live refresh deferred; the night audit is run by a person
```

---

## 5 · The owner's standing rules

These come from the owner, in their words where quoted, and override any
habit of yours.

- **NO DECISION WITHOUT THE OWNER'S APPROVAL.** Their words, 16 September:
  *"if u have any dought u need to ask me and you are not allowed to take
  decisions unless they are approved"*. A choice that changes what is built,
  what a person sees, what a figure means, or what ships is the owner's —
  bring it as a question with a recommendation and **wait**. Carry on with the
  parts that need no decision; do not guess the rest, and do not treat
  silence, a plan, or your own earlier suggestion as approval.
- **Ask before any doubt.** Give a recommendation with the question.
- **The Firebase Admin private key lives in `api/.env`**, which is gitignored
  and must never be committed, printed, or echoed.
- **No default prices, anywhere.** An unpriced thing shows a dash, never a
  zero. Never invent a number.
- **Never show a figure the database hasn't agreed to.**
- **Open the screen before claiming it works.**
- **Record every mistake in `MEMORY.md`**, numbered, with the rule it teaches.
- **Every code block you give the owner is labelled with WHERE it runs**
  (their PC in PowerShell, the server over ssh, …). No placeholders in
  commands. Go step by step.
- **Production is the owner's to touch.** Deploys, and any write on the box,
  need their explicit yes in that conversation. Read-only checks are fine.
- **The test sign-ins never reach production.** `npm run build:app` fails if
  they are in the bundle; the API refuses the dev header under
  `NODE_ENV=production`.
- **The n8n encryption key is a master password.** Never paste it anywhere.

---

## 6 · Consistency — the rules every screen and label follows

**Naming (the clarity plan, 15 Sep).** One thing, one name everywhere. Say it
the way the desk says it out loud; keep the industry word only where the
industry reads it (Finance, reports, filings). Sentence case always — only
acronyms and form names keep capitals (`navigation.test.ts` enforces it for
the menu and fails on two entries sharing a name). A button says what happens,
verb first. The menu label, the page's heading and the browser tab say the same
words (`PageHeader` sets the tab through `useDocumentTitle`). A term that
cannot be plain explains itself on first use.

**Room states — one set of words** (keys unchanged; only labels changed):

```
key (data, tests)   what a person reads   meaning
Vacant              Empty                 no guest in it = Free + Needs cleaning + Arriving
—                   Free                  the tile's word: clean, empty, nobody expected
Occupied            In house              a guest is staying (includes due out)
Arrivals            Arriving              somebody checks in today
Reserved            Reserved              held for a LATER booking — not an arrival
Blocked             Out of service        cannot be sold
Due Out             Due out               leaves today
Dirty               Needs cleaning        needs cleaning
```

⚠ Rename a number by **what it counts**, never by what the word sounds like —
MEMORY 258.

**The desk's glossary:**

```
say            not                          where
Bill           Folio                        desk screens (Folio stays in Finance)
Booking        Reservation                  desk screens (the report name stays)
Guests         Pax                          everywhere
Month so far   MTD / PTD                    Dashboard (the Manager report keeps PTD, as printed)
Property       Hotel                        settings, pickers
Order 12       KOT 12                       on screen (the printed kitchen slip keeps KOT)
```

**Design system** — `src/styles/theme.css` and `docs/design-system.md`. Use the
tokens; do not invent colours. Surfaces are flat with hairline borders; shadows
are for overlays only. One icon family: `lucide-react` (in 85 files), one size
and stroke, and a different glyph for each destination. `variant="primary"`
means solid brand orange — one per screen. Money and counts use tabular
numerals. A null is a dash, never a zero (`Amount` in `ReportShell` does it).

**Help lives where the question is.** A trade word a new person will not
know is a `Term` from `src/lib/glossary.ts` — one definition, checked against
the code, never a second copy in a tooltip. Every list draws four states:
loading, failed, empty (what belongs here, and where it comes from), full.
A job card (`startHereCards.ts`) names real buttons; rename one, change both.

**Where things live (since 15 September).** A service's screens, menu
entries, addresses, data and tests are in `src/modules/<service>/`; its server
routes in `api/src/modules/<service>/`; new database checks in
`db/tests/modules/<service>.sql`. Read its `MODULE.md` first. Another service
is reached only through its `index.ts`. The core — design system, shell,
session, data index, server wiring, migrations — is shared and frozen
(AGENTS.md). **A service not built yet has a Coming soon page** in its own
folder (`pages/`), listed in the Coming soon section; the day it is built,
its real screens replace the page and its entry moves to a working section.

**Menus are per person.** Each service declares its menu entries in its own
`nav.ts`: the section, the place in it, and `workingMenus` — the restricted
roles whose menu the entry is in; `navigation.ts` assembles them into the one
menu and each role's working menu. `listed: false` keeps an entry out of
every sidebar but in search; `keywords` are the other words people type. A
new screen names its working menus, or it is search-only for those roles.

**Facts on documents** come from the session, never from a literal:
`useDocumentIdentity()` gives the property in view and the signed-in person's
name. `ReportShell` uses it. **`FolioPanel.tsx` and `CheckInFlow.tsx` still
hold `const USER = "front desk"`** (MEMORY 256) — named, not yet fixed.

---

## 7 · Working on this machine — the traps

```
Postgres        D:\fidato-pg, port 55432, password pw. Does NOT restart after a
                reboot. Start (PowerShell on this PC):
                D:\fidato-pg\pgsql\bin\pg_ctl.exe -D D:\fidato-pg\data -l D:\fidato-pg\pg.log start
                From Git Bash pg_ctl never returns — the server IS up; check with psql.
servers         In the Claude desktop app, start them with the Browser pane's
                preview_start: "api" (8787) then "web" (5173, or the next free
                port). Never `npm run dev` in a shell there.
test logins     three buttons on the sign-in page: Owner, General Manager,
                Reception. The account menu's "View as" switches between them.
                If GM/Reception are missing: psql … -d fidato -f db/dev/dev-testers.sql
rebuild db      db/migrate.sh brings `fidato` up to date and never drops.
                db/tests/run.sh and rerun.sh use scratch databases only.
commit          PowerShell 5.1 passes `git commit -F - @'…'@` as a PATH.
                Write the message to a file and `git commit -F <file>` (MEMORY 255).
server reads    PowerShell → ssh mangles quoted SQL. Pipe a script to
                `ssh … "bash -s"`, start it with an empty line (a BOM kills
                line 1) and end each line with " #" (the \r lands in a comment).
                Key: ssh-key-2026-09-01.key in the owner's Downloads. User opc.
browser pane    An emulated viewport breaks screenshots and click coordinates.
                Measure with JS instead, and reset to "desktop" before clicking.
console         The pane keeps old errors across reloads. Log a MARK, reload,
                and read only what comes after it before calling anything broken.
skills          impeccable and the taste skills are installed locally and
                gitignored. Written guidance only — never run impeccable's binary.
```

---

## 8 · What only the owner can give

Current list, ordered by what blocks most: `PROGRESS.md` → "Still needing a
person". The top of it: backups are on the same disk as everything they back
up (P0); the deploy above; rotate the Firebase Admin key (it passed through a
chat); the demo's rates and menu are what the hotel is selling; the
`demo@fidatohotels.com` owner account.

---

## 9 · Deploying — only when the owner says so

Server first, then the website: the new screens need the new server (a
"Got it" sent to the old one is refused). At a quiet moment at the desk —
the API restarts for a few seconds; the offline queue holds anything
tapped meanwhile. Never during the night audit.

**Checked read-only on 16 September for this deploy — two stages, back to
back.** The owner's decision: the service-folder move deploys on its own,
then the Coming soon pages. The server is on `cp6` at `1c2e5d0` (what is
live), working tree clean (one untracked `api/.db-password`, which no
incoming commit touches); disk 46%; last backups 15 Sep; the API healthy.
Locally `cp6` (`4d10248`) → `service-folders` (`fc2efb0`) → `coming-soon`
are fast-forwards. **Neither stage has a migration.** `coming-soon` changes
no server file, so stage B is the website alone.

### Stage A — the service-folder move (server, then website)

```powershell
# 1 · the owner's PC, PowerShell — put the move on cp6 and push it
cd "D:\fidato pms"; git checkout cp6; git merge --ff-only service-folders; git push origin cp6
```
The quotes matter: without them PowerShell reads `pms` as a second argument.
Expect "Fast-forward", then the push. Then confirm:

```powershell
# 1b · the owner's PC, PowerShell, same folder — this copy is the pushed one
git status --short; git log -1 --oneline
```
Expect no files listed, then `fc2efb0 One hotel system: the plan …`.

```powershell
# 2 · the owner's PC, PowerShell — connect to the server
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

```bash
# 3 · on the server, inside that ssh session — a backup BEFORE anything changes
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```
Expect a green ✓ and a file name with today's date. `launch.sh` backs up only
AFTER it has migrated, so this is the copy from before.

```bash
# 4 · on the server, same session — get the code
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" from `1c2e5d0` to `fc2efb0` — the same commit as step 1b.

```bash
# 5 · on the server, same session — install it (migrations run here)
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect it to end in green: `https://api.fidatohotels.com is live.` If it
stops with a red ✗ or "NOT READY TO SERVE", stop there and send the output.
Migrations are one transaction (a failure leaves the database as it was),
and when the code cannot load, nothing is restarted — the old API keeps
running. **Do not roll the server code back by hand: that reopens the
security hole 088 closes.**

**If preflight says "no bootstrap accounts" ✗** — the placeholder
administrator `REPLACE — your name` is switched on (migration 008 re-creates
it whenever the row is missing; MEMORY 271). The API is already running. On
the site: People → REPLACE — your name → **Deactivate** (never delete it — a
deleted row comes back on the next deploy). Then, on the server:

```bash
# 5a · on the server, same session — preflight again
cd /opt/fidato/api && sudo -u fidato env HOME=/tmp npm run --silent preflight
```
Expect `Ready.`

```powershell
# 6 · the owner's PC, PowerShell — the server restarted today
curl.exe -s https://api.fidatohotels.com/health
```
Expect `"ok":true` and a `startedAt` with today's date.

```powershell
# 7 · the owner's PC, PowerShell — build the website
cd "D:\fidato pms"; $env:API_URL="https://api.fidatohotels.com"; npm run build:app
```
Expect `✓ no test sign-in in dist` and `✓ dist\config.json → https://api.fidatohotels.com`.

```powershell
# 8 · the owner's PC, PowerShell, same folder — publish it
firebase deploy --only hosting:app
```
Expect `Deploy complete!`

**9 · Look at it.** Open https://pms.fidatohotels.com, press Ctrl+Shift+R,
sign in. **Nothing should look different — that is the point of the move.**
Open Rooms, a guest's bill, the Till and All reports; each opens as it did.
Screens already open elsewhere say "A new version is ready": reload between
guests.

**If the website is wrong:** Firebase console → Hosting → Release history →
the previous release → Roll back. Instant. **If the server is wrong after
step 5**, stop and send the output — `1c2e5d0` is the commit to return to,
and it already carries 088's fix, so returning to it is safe.

### Stage B — the Coming soon pages (website only, straight after)

```powershell
# B1 · the owner's PC, PowerShell — put the Coming soon pages on cp6 and push
cd "D:\fidato pms"; git merge --ff-only coming-soon; git push origin cp6
```
Expect "Fast-forward", then the push. Nothing on the server: this stage
changes no server file, and the next server deploy pulls it.

```powershell
# B2 · the owner's PC, PowerShell, same folder — build the website
$env:API_URL="https://api.fidatohotels.com"; npm run build:app
```
Expect `✓ no test sign-in in dist` and `✓ dist\config.json → https://api.fidatohotels.com`.

```powershell
# B3 · the owner's PC, PowerShell, same folder — publish it
firebase deploy --only hosting:app
```
Expect `Deploy complete!`

**B4 · Look at it.** Ctrl+Shift+R and sign in as the owner or a GM: the menu
ends with **Coming soon** — 18 entries, Accounting export to Spa. Open Spa:
"Coming soon", what it will do, what it needs. Reception's menu is
unchanged. Rolling back is the same Firebase button as above.

---

## 10 · Pages published for the owner

```
clarity plan (critique, naming rules)   https://claude.ai/artifact/2ZiqpnMVjFsS1B1YuCHr5s
front-end pass (before / after)         https://claude.ai/artifact/6Gxpi2Ys5YsDFzSMZfB3ZC
audit of 15 September                   https://claude.ai/artifact/NHsssNJwPvww2Un5nn6Shy
staff-first plan                        https://claude.ai/code/artifact/8a98bddb-ff0f-4642-b36e-b9c9b5df5c2f
one folder per service (plan)           https://claude.ai/artifact/2hxwNWXdAC9DpfitP935xR
```

They are private to the owner's claude.ai account and another agent may not be
able to open them. **Nothing in them is needed to continue** — every decision,
rule and list they hold is written into this file, `PENDING.md` and
`PROGRESS.md`.

---

## 11 · When you stop

1. A `CHANGELOG.md` entry for your session, newest first, in its template.
2. Every defect you found or made, numbered in `MEMORY.md`.
3. This section brought up to date: section 2 (state, gates you actually ran)
   and section 3 (what is next). Move finished items out; do not append.
4. Folder claims below released.

## Folder claims

**Now a command, since 16 September:** `npm run claims` lists who holds what;
`npm run claim -- <service> "what"` and `npm run release -- <service>`. Kept in
the git directory every worktree shares — the `.claims/` folder described below
could only be seen by the copy that wrote a file there (MEMORY 281).

**Previously moved to `.claims/` on 16 September.** One file per service —
`.claims/pos.md` is the POS agent's and nobody else's — because three agents
claiming three services all wrote to this one table at the same time, which
made the register of who owns what the thing they collided over.

```
.claims/README.md      how to claim, and what a claim covers
.claims/<service>.md   create before your first write · DELETE when you stop
npm run lane -- <svc>  what this session changed, and whose it is
```

Nothing here any more. Read `.claims/` for who is holding what right now.

---

# Archive — the handover of 28 August 2026

> **Superseded.** Everything below is the state at the end of CP6, before
> the system was deployed. It is kept because the reasoning in it is still
> the reasoning behind the code. Its gate numbers, its instructions and its
> folder claims are all out of date — the current ones are at the top of
> this file.

**Last updated:** 28 August 2026, end of CP6.
Keep this file current. It is the first thing any agent reads after
`CONTEXT.md`, `MEMORY.md` and `AGENTS.md`.

---

## Folder claims

```
FREE    src/pages/reports/
FREE    src/pages/admin/
FREE    src/pages/  (guests · companies · properties · notifications · billing · rates)
FREE    src/data/  src/components/ui/  src/lib/
```

Nothing is currently held. Claim before your first write — see `AGENTS.md`.

---

## Gates, as of this update

```
FRONTEND   npx tsc -b        0 errors
           npx vitest run    81 passed · 6 files
           npm run build     clean · 16.0s

API        npx tsc --noEmit  0 errors        (cd api)
           npm test          10 passed       against live Postgres, as pms_app

DATABASE   db/tests/run.sh   18 migrations · 51 assertions · 0 failed
                             + dev identities (local only)

           142 tests total across the three suites.
```

The two suites are separate on purpose: the API's tests need a live Postgres
and a node environment, not jsdom, so the root `vitest.config.ts` excludes
`api/**` and the API runs its own.

> ⚠ **THIS FILE IS STALE BELOW THIS LINE.** It was last written on 28 August,
> before the system was deployed. The gate numbers, the "deploys are paused"
> instruction and the CP6 status below are all out of date.
>
> **Read `CHANGELOG.md` first — that is the current record.** In short:
>
> - The system is **live**: `pms.fidatohotels.com` (Firebase) and
>   `api.fidatohotels.com` (Oracle Linux, Mumbai), serving 5 Elements Akkalkot.
> - **Commits and deploys are no longer paused.** That instruction was lifted
>   by the owner on 8 September. Push normally.
> - There are **two databases and they differ**: portable Postgres 17 here,
>   PostgreSQL 16 on the server. A dump only restores forwards — use
>   `db/backup.sh --portable`. Read defect 190 before touching a backup.
> - **Current gates:** 483 database assertions · 78/78 migrations re-runnable ·
>   254 API tests · 163 interface tests · 3 clean builds.
> - **In flight:** Stage C4, the waiter's order pad. The server half
>   (`POST /till/orders/batch`) is built and tested; the pad itself is not.
>   The running-total decision is made — see `CHANGELOG.md`.

---

## Stage 1 — where it stands

```
CP0  ████████████  toolchain · Tailwind painting · tokens registered
CP1  ████████████  design system — 32 primitives ported from the CRS
CP2  ████████████  every primitive on /design-system · 3 distinct list states
CP3  ████████████  shell · repository seam · demo data calibrated to the reports
CP4  ████████████  the tape chart — 17 rooms × 14 days, no horizontal scroll
CP5  ████████████  five flows, each walked end to end in a browser
CP6  ████████████  36 screens real · 2 left as honest placeholders
```

CP6 is complete. Every screen below was opened in a browser and read, not
merely typechecked — that habit has now caught eight defects that passed all
three gates.

---

## The 36 screens that are real

**Group**

```
/                              group dashboard
/design-system                 the living style guide
/reports                       the taxonomy · starrable, 7 of 11 built
/reports/manager               the daily flash — Today · PTD · YTD
/reports/city-ledger           per-account, negatives visible
/reports/no-show               prints empty, as the real export does
/reports/monthly-occupancy     bar chart, full houses in green
/reports/monthly-stats         daily grid, Available varies 17/18
/reports/yearly-stats          monthly grid with grand total
/reports/lodging-tax           statutory, two-level CGST/SGST headers
/properties                    one configured, six deliberately unnamed
/guests                        grouped from stays · overlap warning
/companies                     booking sources and what each brought in
/notifications                 derived conditions, nothing stored
/admin/properties              why adding one waits for the auth bridge
/admin/users                   the roles, not invented staff
/admin/roles                   the live permission matrix
/admin/audit-log               130 entries, append-only
/admin/integrations            STAAH · Sattva · Firebase · CRS, honest status
/admin/settings                what the property is configured as
```

**Property — all under `/h/:code/`**

```
stay                 the tape chart
housekeeping         mobile board, visible offline queue
arrivals             today, check-in from the row
arrivals/upcoming    the next fortnight
in-house             staying tonight
in-house/due-out     departures, opens on the folio tab
folios               open accounts, both directions
reservations         the whole book · 5 filters · 83 on file
walk-ins             18 on record, taken from Stay view
room-types           10 Superior · 8 Deluxe, 17 sellable
rate-plans           EP · CP · MAP · Room Only
rates                rack against achieved, 14 days, read-only with reason
payments             59 receipts · ₹3,54,840 · reversals struck through
invoices             58 ready to bill · no number issued, deliberately
city-ledger          6 accounts · ₹59,883 outstanding
night-audit          the pre-flight checklist · Run disabled with reason
```

**Left as placeholders, on purpose**

```
/h/:code/cashiering    unspecified
/h/:code/pos           Sattva is live in eZee today — this is a migration
```

Neither is a shortcut. Guessing at either would put a screen in front of
someone that contradicts what they use every day.

---

## Three things that were deliberately NOT built

Each is a case where building the obvious thing would have been worse than
leaving a visible gap.

**No invoice number is issued.** `5EFH154` is the hotel's real next GST number.
A number shown on screen but never printed on a filed return leaves a hole in a
statutory sequence, and a hole in a GST series is a question from an assessor.
Issuing moves to Stage 8, when the numbers are *recorded* rather than displayed.

**The night audit does not run.** It posts room charges and rolls the business
date, and the business date is a constant in this stage. Posting charges without
advancing the date would double-charge every occupied room the next time anyone
pressed the button. Everything the audit would *check* is computed live —
that is the part a manager actually reads.

**Rate cells are read-only.** No channel is connected, so a rate changed here
would move on this screen and nowhere else — not on Agoda, not in the
confirmation a guest receives.

All three are shown disabled with the reason on the face of the screen. Rule 6:
a blocked action is never hidden.

---

## Verified figures the screens currently show

These reconcile to the real 25 August exports. If a change makes one of them
move, something is wrong.

```
Stay view      17 rooms × 14 dates · 21 bars · no horizontal scroll
               All 17 · Vacant 11 · Occupied 6 · Arrivals 1 · Blocked 1 · Due Out 4
Manager rpt    PTD 132/431 = 30.63% · ADR ₹3,178.63 · RevPAR ₹973.50
               Guest Ledger closing ₹59,883
City ledger    6 accounts, closing sums to ₹59,883   ← reconciles to above
Payments       59 receipts · ₹3,54,840 · none dated after 25 Aug
Reservations   83 on file = 14 due in + 8 in house + 60 out + 1 cancelled
Room types     10 Superior + 8 Deluxe = 18 physical, 17 sellable (308 held)
Rates          Superior 6/10 on 25 Aug is PAYING rooms — 5 sold + 1 comp
Guests         30 guests · 2 flagged for overlapping stays
Dashboard      29.41% occupancy, 5 of 17 rooms   ← matches the Night Audit
```

---

## Data-integrity fixes made during CP6 — read before touching the store

Three defects in the seeded ledger surfaced only once Payments, Invoices and
the Audit Log were built. All three are fixed in `src/data/store.ts`; the
reasoning is in the comments there and in `MEMORY.md`.

1. **Receipts dated in the future.** The seed posted settlements at
   `stay.departure`, so a booking departing 2 September carried a receipt a
   week ahead of the business date. Now: a departed stay settles at check-out,
   an in-house stay shows a deposit at check-in, and an unarrived booking
   carries no receipt at all.
2. **Charges on stays that had not arrived.** Room charges posted at
   `stay.arrival` regardless of whether that date had happened, putting future
   charges into the audit log, into every guest's total spend and into the
   year-to-date column of the Manager Report. Now: `if (stay.arrival >
   BUSINESS_DATE) continue`.
3. **ADR and RevPAR included extras.** `netOf()` is room + extras; ADR is room
   revenue over rooms sold, by definition. The ₹18,181 of extras was inflating
   the year-to-date rate by about ₹140 a night.

`BUSINESS_DATE` now lives in `src/data/fixtures/property.ts` — one source, next
to the calibration it belongs with. `repositories/stays.ts` re-exports it, so
nothing that imported it from the seam had to change.

---

## Audit, 28 August — one gap found and closed

An audit against this project's own definition of done (`AGENTS.md`: *empty ·
loading · error, all three*) found **14 of 26 queries on the CP6 screens had no
error path**. `Directory.tsx`, `admin/Admin.tsx`, `Rates.tsx` and
`NightAudit.tsx` rendered a skeleton or an empty table forever instead of an
error with a retry.

Latent in Stage 1 — the queries read an in-memory store and cannot fail. It
would have become live the moment Stage 2 puts a network behind the seam, which
is exactly what the seam exists for.

Fixed and **verified by deliberately throwing** from `listGuests` and
`getRateGrid`, loading both screens, confirming the error state, then reverting
the probe. Both paths render with a retry.

```
Error paths now:   26 of 26 queries
Rule 2 violations: 0   (no screen imports fixtures or the store)
TODO / stub markers: 0
```

---

## CP7 — done, 28 August

**The App API exists.** `api/` — Hono, `pg`, `firebase-admin`, its own package
and its own test runner.

```
api/src/env.ts          validated config; refuses to start rather than warn
api/src/db.ts           the pool, and withUser() — the whole security model
api/src/auth.ts         Firebase token → subject; no staff read outside RLS
api/src/routes/hotels.ts
api/src/server.ts       auth as middleware, so a new route is authenticated
                        by existing rather than by remembering
api/test/isolation.test.ts
```

Verified live, not just typechecked. As the Agra clerk and then the owner,
through real HTTP, against real Postgres:

```
health              {"ok":true,"database":"reachable","role":"pms_app"}
no token            401
unknown subject     401  "No active staff record for this account."
Agra clerk          may work in 1 property   · groupAdmin false
owner               may work in 0 (all)      · groupAdmin true
```

**The `set_config` leak test was proved by breaking it.** Flipping `is_local`
from `true` to `false` in `withUser` fails *scopes the setting to the
transaction, not the session* and nothing else. Restored, all 10 green.

**One defect found in my own test.** *Refuses a cross-tenant write* selected its
source rows FROM the other property; RLS hid them, the `INSERT` inserted
nothing, and it passed vacuously — the exact trap `MEMORY.md` already records.
It now asserts the source row count first, and asserts nothing landed after.

### CP7 needed one migration

`018_api_access.sql`. `staff_hotels` had RLS forced and **zero policies** —
deny-all for `pms_app`. Isolation still worked, because `app.auth_hotel_ids()`
is `SECURITY DEFINER` and reads it as owner, so nothing looked broken. The API
asked *which properties may I work in, and as what role* and got an empty list,
which reads as "none" and is not the same fact as "denied".

One `select` policy: a person reads their own access rows and nobody else's.
Not `insert` — granting a hotel belongs to `pms_admin`, and a clerk who could
insert there could grant themselves the property next door.

### Still needing a person, now visible in a real response

`GET /api/hotels` returns **both** properties to the Agra clerk, because
`hotels_read` is `app.is_active_staff()`. The response separates the two facts
so the interface cannot confuse them — `hotels` is what they may read,
`scope.hotels` is what they may work in — but the read grant itself should be
confirmed rather than discovered later.

---

## CP8 — done, 28 August

**Sign in works, and the role comes from Postgres.**

```
src/pages/SignIn.tsx           password form + dev identities
src/lib/api.ts                 the HTTP client; the only place that
                               knows how a request is authenticated
src/lib/session.ts             who is signed in, and what they may do
src/components/app/AccountMenu.tsx     replaces RoleSwitcher
db/dev/dev-identities.sql      local sign-in, NOT a migration
```

`src/components/app/RoleSwitcher.tsx` is **deleted**, and the demo `role` is out
of `src/lib/ui.ts`. `grep -rn "setRole\|RoleSwitcher" src/` returns nothing. It
was a preview control, and a preview control beside a real session is how a
clerk previews themselves as an owner.

Verified in a browser, both identities, end to end:

```
deep link while signed out   →  /signin, 0 nav links, no shell flash
sign in · Agra clerk         →  "Agra Clerk, Front Desk"
                                27 nav links · NO Administration
                                menu: one property, no picker
sign out                     →  /signin, 0 nav links
sign in · Owner              →  "Group Owner, Owner"
                                29 nav links · Administration present
                                menu: both properties + group-admin badge
```

The nav difference is the point: 27 against 29, decided by a role read from
`staff_hotels`, not chosen from a dropdown.

### Two vocabularies had to be mapped

`staff_hotels.role` is `owner · gm · front_desk · housekeeping · pos · stores ·
finance · read_only`. `src/lib/permissions.ts` is `owner · admin · manager ·
front_desk · housekeeping · finance · viewer · automation`. Neither is wrong —
the database says what someone was hired as, the matrix says what a screen may
show them. `ROLE_FROM_DB` in `src/lib/session.ts` is explicit and total, so a
new database role is a compile error rather than a silent fall to `viewer`.

`pos` and `stores` map to `viewer` for now. Neither posts anywhere yet; that
changes when Stage 7 brings the POS bridge.

### Three defects, all found by opening the page

1. **CORS pinned one port.** `CORS_ORIGIN` was `:5173`; Vite took `:5202`, the
   preflight failed, and the interface said *"could not reach the server"*.
   Development now allows any localhost origin; production still pins exactly
   one. A foreign origin is refused either way — verified with curl.
2. **The error message named the wrong cause.** A blocked preflight and a dead
   server are indistinguishable to `fetch` by design. It now names both.
3. **Nothing redirected away from `/signin`.** Signing in succeeded, the API
   returned 200, and the person was left staring at the form they had just
   completed. `SignInRoute` sends a signed-in visitor to `/`.

### One thing that surprised me about the database

The demo staff, the two properties and the `staff_hotels` grants are created by
**`db/tests/suite.sql`**, not by `008_seed.sql` — the seed migration only makes
the `REPLACE@fidato.in` bootstrap user. `dev-identities.sql` ran before the
suite, found zero rows and failed its own assertion, which is the assertion
working. It now runs after.

Worth knowing before Stage 12: **there is no production seed for staff or
properties.** A real deployment provisions them through
`app.provision_property()` and an admin path that does not exist yet.

### Still on demo data

Screens read the in-memory store; `useUi.hotelId` is still
`5-elements-akkalkot` while `useSession.hotelId` is a Postgres uuid. Both are
commented as such. **CP9 makes them one value** — that is the seam swap, and it
is the next thing.

---

## Audit, 28 August — after CP7 and CP8

Re-ran all three suites and read back what I built. Two defects and one piece of
stale documentation, all fixed.

**A reload signed you out.** The dev subject lived in module state, so every
refresh dropped the session. That is annoying in development and *fatal to
CP10*, whose whole assertion is *check a guest in, reload, the guest is still
checked in* — it could not have been attempted. Now kept in `sessionStorage`:
tab-scoped, so a shared machine does not inherit the last person's identity,
and cleared on sign-out. Verified all three ways — reload keeps the session and
lands on the deep link, sign-out clears the key, and a reload after sign-out
stays signed out.

**`src/lib/firebase.ts` still described CP8 as future work.** It said the
preview role in `src/lib/ui.ts` was current; that role was deleted at CP8. Doc
drift inside a file nobody had reason to re-open.

**Degraded behaviour checked deliberately.** With the API stopped, sign-in fails
with *"Could not reach http://localhost:8787. Check the API is running, and
that it allows this origin."* — both plausible causes named, because a blocked
preflight and a dead server are indistinguishable to `fetch`.

Clean: 0 Rule 2 violations, 0 stale references to the deleted role switcher,
0 TODO markers. `src/pages/SignIn.tsx` imports `devAuth` from `@/lib/api` —
that is a build-time flag, not repository data, so the seam is intact.

### Where the code is

```
src/pages          20 files   5,188 lines
src/components     26 files   4,987
src/data           27 files   4,368
src/lib             8 files   1,206
api/src             5 files     505
api/test            1 file      235
db/migrations      18 files   3,246
```

39 routes · 1 placeholder pair remaining (cashiering, pos) · 142 tests.

---

## CP9a — the demo data is in Postgres, 28 August

**`api/scripts/load-demo.ts` — `cd api && npm run load-demo`.**

CP9 swaps the repositories onto HTTP. That is only a fair test of the seam if
**both sides hold the same data** — otherwise every screen changes its numbers
at the same moment it changes its transport, and there is no way to tell a
transport bug from a data difference.

So the loader reads the fixtures — the same module the frontend reads, with its
import-time assertions still in force — and writes them into Postgres.

```
5 Elements Akkalkot (5EL)
18 rooms · 17 sellable · 2 room types
30 guests · 1 group booking
83 reservations · 82 assignments · 132 postings

room-nights sold 1–25 August: 132   ← matches the real Night Audit
room revenue:        ₹3,76,745.54   ← matches the Manager Report exactly
```

Idempotent — reruns give the same figures. It **verifies before committing**;
the first version checked afterwards and left a wrong load in the database
while reporting drift. A verification that cannot prevent what it verifies is a
report, not a check.

It connects as a **superuser, deliberately** — creating a property, its rooms
and 83 reservations across every guest is an administrative act no single staff
member has the RLS scope for. Nothing in `api/src` may follow that example.

### Six things the schema knew that the fixtures did not

Every one surfaced as a constraint failure, and every one is the schema being
right.

1. **`reservations.room_id` does not exist.** Migration 011 replaced it with
   `room_assignments`, because one column can hold one room and a guest who
   moves mid-stay needs two. The flat `Stay.roomNumber` the screens read is a
   reservation JOINED to its assignment — that join is CP9b's real work.
2. **Day-use is native.** Migration 015 relaxed the date check to
   `check_out >= check_in` and made `is_day_use` a GENERATED column. My first
   pass pushed day-use departures to the next day, which would have turned
   every one into an overnight stay and put a wrong Day Use figure on the
   Manager Report.
3. **A group booking cannot share a reference.** `(hotel_id, reference)` is
   unique, and rightly — a clerk searching FH-2608-5010 would otherwise get
   three rooms and no way to tell which they are billing. The group now owns
   the bare reference; members carry it suffixed by room. **The API must return
   the group's reference for display**, or the Pancham Hall block shows three
   references the guest was never quoted.
4. **Tax must reconcile to the cent.** `fp_tax_consistent` requires
   `tax_amount = round(amount × rate / 100, 2)`. Two of the 83 folios carry tax
   that is more than 5% of the room charge — it also covers extras, or several
   rooms on one group folio. The room line now carries statutory 5% and the
   remainder posts as its own `tax` line, so the total is preserved and the
   discrepancy is visible rather than absorbed.
5. **"Room Only" is not EP.** The live eZee Night Audit prints both, and the
   Rate Plans screen already documents them as distinct, so `meal_plans` gained
   an `RO` row. ⚠ That row is inserted by a *demo loader* and belongs in a
   migration — `meal_plans` is group reference data.
6. **The ledger is append-only, and said so.** Reloading the property hit
   `folio_postings_append_only`. Both that and `hotels_no_delete` are lifted for
   the cleanup statement only and restored immediately, as migration 017 does.

### Two gaps this exposed

**Complimentary rooms are not modelled.** The Manager Report prints
`Complimentary Room` on its own line, and the only way to find one in Postgres
is `agreed_rate = 0`. That works while nothing else is booked at zero. A comp is
a decision someone made, reported separately for the owner and for tax; a
zero-rate sale is a different event that happens to cost nothing. **It needs a
column.**

**Nobody can see anyone else's access.** `staff_hotels_self` is
`staff_id = app.current_user_id()`, and a group admin holds no rows of their
own — so the admin reads **zero**. Safe, and it means the Users and Roles
screens cannot show who may reach what. Found by an API test asserting the
owner could see more grants than the clerk; they see none.

### Two API tests were asserting a number, not a fact

`gives the Agra clerk exactly one property` and `lets a clerk read only their
own access rows` both hard-coded `1`. That number was standing in for *however
many grants the fixture happens to give*, which is not a fact about the system —
loading the demo property broke both. They now assert the invariant: the scope
equals the grants held, the list is non-empty, and somebody else's rows exist to
have been hidden.

### Still to do — CP9b

The repositories still read the in-memory store. The transport swap is next, and
its measure is unchanged: `git diff --stat src/pages src/components` prints
zero.

---

## CP9b — the first modules are on HTTP, 28 August

**`properties` and `rooms` now fetch. No screen changed.**

```
$ diff <screens before> <screens after>
  ZERO — no page or component changed during the repository swap
```

46 files under `src/pages` and `src/components` were hashed before the swap and
after. Not one moved. `git status --short src/pages` shows no modified file at
all since CP6 — every entry is a new screen, none is an edit.

That is the seam's whole claim, and it is the first time it has been tested:
one folder changed its transport and 36 screens did not notice.

### What moved

```
api/src/routes/property.ts     GET  /api/hotels/:code
                               GET  /api/hotels/:code/rooms
                               PUT  /api/hotels/:code/rooms/:number/housekeeping
src/data/repositories/properties.ts    fixture → fetch
src/data/repositories/rooms.ts         store   → fetch, reads AND writes
```

Reads and writes moved **together** — but see the audit below: the claim was
true of the `rooms` module and false of the housekeeping SCREEN, which called a
different write path entirely. I wrote it down before testing it.

The id a screen puts in a URL is now the hotel **code** — `/h/5EL/stay`.
`hotels.code` is commented *"appears in URLs"* in migration 002, and it is what
a person can read back over the phone. The screens never knew either id; they
put whatever the repository hands them into the link.

### Migration 019 — what a property is beyond its name

`hotels` carried no address, phone, email or GST rates. None is cosmetic: a GST
invoice must print the supplier's address, and while the RATE per posting is
correctly frozen on `folio_postings.tax_rate`, nothing said what rate to apply
to the next one. Per property, because GST is a state subject and the group has
properties in two states.

### A silent zero, caught immediately

The moment `properties` swapped, the dashboard showed three properties at **0%
occupancy** — no error, no empty state, just zeros. Every unswapped module still
guarded on the fixture id and returned `[]` for the database code.

`isDemoProperty()` now accepts both, with a removal condition written on it:
delete when the last module is on HTTP. A silent zero on a report an owner reads
is the worst failure this project has, and a half-finished swap produces them by
construction.

### Two screens disagreed about who was in a room

The tape chart said 7 rooms occupied; the housekeeping board said 6, and listed
room 202 under **Vacant clean with the guest's name beside it**. A housekeeper
would have walked into an occupied room.

`listHousekeeping` derived occupancy from `departure > businessDate` and
excluded day-use stays. Both are wrong for the same reason: a guest is in the
room until they **check out**. Due-out means still here, leaving today; a
day-use guest books no night but is sitting in the room. This is `MEMORY.md`
defect 3 in a second place — **derive from status, because a date cannot tell
you whether the person has actually left.**

Three independent derivations now agree:

```
tape chart      Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
housekeeping    Vacant clean 10 · Occupied 7 · Out of order 1
Postgres        7 rooms occupied on 2026-08-25
```

The loader also never set `rooms.occupancy_status`, so Postgres thought the
house was empty. It is now derived from the assignments rather than typed in.

### The test suites split, deliberately

`src/test/setup.ts` stubs `@/lib/api` for every frontend test — jsdom has no
server. The split is now explicit:

```
src/**/*.test    the SEAM'S CONTRACT — scoping, cloning, the shape a
                 screen receives, and that nothing reaches around it
api/test         whether the SQL is right, against real Postgres, as
                 pms_app, with RLS in force
```

A mock cannot tell you a query is correct. A test that pretends otherwise is a
green light sitting on top of a broken database.

### Verified after the swap

```
Dashboard    5 Elements 30.63% · ADR ₹3,179 · RevPAR ₹974   ← unchanged
             3 properties, 37 rooms, all read from Postgres
Stay view    17 rooms × 14 dates, counts as above
Rooms        18 physical · 17 sellable · 308 out of service
Property     address, phone, GSTIN, CGST 2.5 + SGST 2.5, all from the database
```

### Still on the store

`stays`, `folios`, `operations`, `statistics`, `reportData`, `managerReport`,
`stayview`, `directory`, `billing`, `admin`, `notifications`. They read the same
data — that was CP9a's purpose — so the half-swapped state is coherent rather
than merely tolerable.

---

## Audit after CP9, 28 August — three defects, all mine

**I claimed the room write path worked without testing it. It did not.**

The housekeeping screen calls `operations.markRoom`, not `rooms.setHousekeeping`.
`markRoom` wrote to the in-memory store while the board's rooms had moved onto
HTTP — so a clerk marked a room clean, the store changed, Postgres did not, and
the next read showed the old state with nothing to explain it. **Two write paths
to one fact is one too many.** `markRoom` now delegates, and
`listHousekeeping` reads its rooms from the same place.

**Check-in and walk-in wrote an occupancy value into a housekeeping field.**
`setRoomHousekeeping(room, "occupied")` — but the schema keeps
`occupancy_status` and `housekeeping_status` independent, because a room can be
occupied *and* dirty. The store conflated them. Those two calls are **deleted**
rather than ported: the board derives occupancy from stay status, so checking a
guest in moves them into the room without anyone writing it down. Check-out's
`dirty` is a genuine housekeeping fact and now goes to Postgres.

**Room 202 sat under "Vacant clean" with a guest's name beside it.** Covered
above; a housekeeper would have walked into an occupied room.

### Now verified end to end, not asserted

```
click "Mark room 208 inspected"
  → screen moves 208 from Vacant clean to Inspected
  → select housekeeping_status from rooms where number='208'  →  inspected
```

And every refusal, by curl against the live API:

```
308 (out of service) → clean    409  "This room is held out of service.
                                      Release it before cleaning it."
209 → "sparkling"               400  '"sparkling" is not a housekeeping state.'
room 999                        409  "Room not found."
5EL room, as the PUNE clerk     409  "Room not found."
```

That last one is isolation working through the ordinary code path: RLS hid the
row, so the route genuinely could not see it. A room that exists but is not
yours gives the same answer as one that does not exist — deliberately.

### Reconciled, three ways

```
tape chart      Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
housekeeping    Vacant clean 10 · Occupied 7 · Out of order 1
Postgres        7 rooms occupied on 2026-08-25
```

### The lesson, written down

**Swapping a module's transport is not finished until the SCREEN that uses it
has been clicked.** Checking that `rooms.ts` reads and writes the same place
proved nothing, because the screen never called `rooms.ts`. Trace from the
button, not from the module.

---

## CP9c in progress — the stays route is built and verified

`api/src/routes/stays.ts`. The API half is done and proven against the
fixtures; the repository swap is the next step.

```
GET /api/hotels/:code/stays        the whole book
GET /api/hotels/:code/stays/:id    one reservation
GET /api/hotels/:code/groups       the Pancham Hall block
```

Verified against the live database, and every figure matches the fixtures:

```
83 total   due-in 14 · in-house 5 · due-out 3 · checked-out 60 · cancelled 1
           ↑ the same split the Reservations screen tabs already show
without a room     1  — the cancelled booking, which released it
group              3 members · shared reference FH-2608-5010 · rooms 302, 303, 305
complimentary      FH-2608-5002, room 206
day-use            FH-2608-5003, room 202, nights = 0
sources            all six · plans  CP · EP · MAP · Room Only
```

### Three things the join had to get right

**`roomNumber` is a join, not a column.** Migration 011 removed
`reservations.room_id`. The room comes from `room_assignments`, and this is the
join CP9 exists to get right.

**Filtering to `released_at is null` lost 60 stays' rooms.** A check-out
releases the room — so every departed stay came back with no room number, and
Folios and Invoices print "room 202" for exactly those. It now takes one
assignment per reservation, preferring the one still held and then the most
recent. That is also what a room MOVE needs: two assignments, current one wins.

**`due-out` is derived and stored nowhere.** `checked_in` AND departing on the
business date. A view of today, not a fact about the booking.

### Two hours lost to a stale process, twice

`tsx` without `watch` does not reload, and a restart that hits `EADDRINUSE`
fails into the log while the OLD server keeps answering. Twice I read a correct
query's output as wrong because the process serving it predated the fix.

**Check `tail -1 /tmp/api.log` says the server started before trusting a
response.** On Windows `pkill -f` does not reliably kill it; use the port:
`Get-NetTCPConnection -LocalPort 8787 | Stop-Process`.

---

## Deferred items closed, 28 August

Everything below had been found, written down, and left. All fixed.

### Migration 020 — three notes that were not fixes

**D1 · `reservations.is_complimentary`.** A comp was detectable only as
`agreed_rate = 0`. That worked while exactly one booking sat at zero and would
have broken the first time anyone booked a free room for another reason —
silently, by moving a number on the Manager Report. A comp is a decision; a
zero rate is a price. Backfilled from the old marker.

**D2 · `Room Only` moved out of the demo loader.** The row is right — the live
eZee export prints it alongside EP — but `api/scripts/load-demo.ts` was
inserting it into `meal_plans`, which is group reference data every property
shares. A demo script reshaping that is how the group ends up with a plan
nobody chose.

**D3 · a group admin can now read access grants.** `staff_hotels_self` is
self-only, and an admin holds no rows of their own, so the admin read **zero**
— leaving the Users and Roles screens nothing to show. `staff_hotels_admin`
grants read (not write) to a group admin. Granting a hotel still belongs to
`pms_admin`.

### `db/tests/rls.sql` — the guard that did nothing

`run.sh` called it behind `if [ -f ... ]` and **the file never existed**, so the
branch was skipped in silence for the whole project. All 51 assertions run as
`postgres`, which has `BYPASSRLS`; they prove the constraints and prove nothing
about isolation.

Seven checks, as `pms_app`:

```
✓ denies by default (0 rows with no session)
✓ sees 4 reservations, 0 from another property
✓ refuses a cross-tenant INSERT
✓ a cross-tenant UPDATE changes 0 rows (and must not be read as success)
✓ reads 1 own access rows, 0 belonging to anyone else
✓ refuses DELETE on folio_postings as pms_app
✓ group admin: 2 of 2 properties, 2 access grants, through the policy
```

**Proved able to fail.** Opening `hotel_isolation` on `reservations` to
`using (true)` is caught by check 0, psql exits 3, and `run.sh` fails the run.

Two things that made the hole possible are also fixed: a missing `rls.sql` is
now **fatal**, and the output is shown rather than piped into `grep` — piping
made the exit status grep's own, so a raised exception left the run green.

### The stale-server footgun

Twice in CP9 a restart hit `EADDRINUSE`, the trace went into an untailed log,
and the OLD process kept answering — correct SQL read as broken because the
code responding was not the code on disk.

```
/health now reports startedAt      a stale process is visible, not suspected
EADDRINUSE is fatal                with a message naming the cause and the fix
npm run serve                      frees the port first (scripts/free-port.mjs)
npm run dev                        tsx watch — reloads on edit
```

Verified: starting a second server frees the port and `startedAt` moves.

### And one more of the same shape, found while proving it

`run.sh` printed *"database is being accessed by other users"*, then carried on
and ran the migrations against the OLD database — where 005 failed complaining
about a column 011 had removed. The confusing error was three steps downstream
of the real one.

It now terminates other backends first and treats a failed DROP or CREATE as
fatal, with a message naming the cause. The API survives having its connections
terminated: `pg.Pool` reconnects, and `/health` came back green.

### Gates after all of it

```
DATABASE   20 migrations · 51 assertions · 7 isolation checks · run.sh exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean
```

---

## Audit, then CP9c — stays and folios on HTTP, 28 August

### The audit found one thing, and it was mine

**Migration 020 gave complimentary its own column. The API route kept guessing
from the price.** I added the column, wrote it in the loader, and left the one
place that actually serves the data still inferring `agreed_rate === 0` — so
the fix did nothing where it mattered.

Proved the fix by making them disagree: set a second booking's rate to zero
WITHOUT marking it complimentary.

```
zero-rate stays: 2
flagged complimentary: 1     ← the old inference would have said 2
```

Otherwise clean: 0 Rule 2 violations, 0 stub markers, production `npm start`
does not touch the port-freeing script.

### Stays and folios moved together, because they had to

A folio is keyed by its reservation id. Swapping stays alone would have left
the interface asking the store for postings under a Postgres uuid it had never
seen, and **every folio would have read zero** — which displays as "settled",
the wrong answer to *does this guest owe anything*.

```
api/src/routes/stays.ts      GET /:code/stays  ·  /stays/:id  ·  /groups
api/src/routes/folios.ts     GET /:code/folios ·  /stays/:id/folio
                                                ·  /stays/:id/postings
src/data/repositories/stays.ts   store → fetch, stays AND folios
```

**The filtering stayed in the repository.** Arrivals, in-house and departures
are three questions about one list; 83 rows is not a dataset worth three
endpoints that can disagree. One request, cached, sliced three ways — exactly
what the store did, so the swap changes transport and nothing else.

### The measure, again

```
$ diff <46 screen files, CP9 baseline> <after stays + folios>
  ZERO — no page or component changed
```

### Verified in the browser, figures unmoved

```
Folios      outstanding ₹60,667 · overpaid ₹784 · net ₹59,883 · 10 open
            ↑ net matches the Manager Report's guest ledger and the city
              ledger, independently derived
Arrivals    7 expected
Stay view   All 17 · Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
```

The overpaid guest still sorts first with `₹784 over`.

### One deliberate infidelity, written into the SQL

The store lumps every positive charge into `roomCharges` and reports
`extraCharges` as 0. The folio route reproduces that exactly rather than
splitting them properly, **because CP9 is a change of transport**: a figure
that moves here cannot be told apart from a query that is wrong. Splitting them
is a separate, visible change.

### Still on the store

`stayview` (the tape chart), `operations` (the five flows), `statistics`,
`reportData`, `managerReport`, `directory`, `billing`, `admin`, `notifications`.
The chart's numbers above are still store-derived — they match because both
sides hold the same data, which was CP9a's purpose.

---

## CP9d and the first write — 28 August

### The tape chart is on Postgres

`stayview` needed no new endpoint: it derives from rooms and stays, both
already on HTTP. It fetches all three lists **once** and then computes — asking
the transport inside the per-room loop would have been eighteen requests and
eighteen chances for the chart to disagree with itself halfway down.

Balances come from `/folios`, which returns only non-zero ones — so **absent is
zero**, and eighty-three separate lookups are avoided to learn the same thing.

```
Stay view   14 columns · All 17 · Vacant 10 · Occupied 7
            Arrivals 1 · Reserved 9 · Blocked 1 · Due Out 3 · Dirty 0
            ↑ identical to the store-derived figures
```

### A guest is checked in, and stays checked in

**`POST /api/hotels/:code/stays/:id/check-in`** — the first write.

Walked through the interface, five steps, then reloaded:

```
Arrivals → Lata Bhosale → Check in
  guest 2 adults → room 208 → ID captured → CP → confirm
reload /h/5EL/in-house
  208  Lata Bhosale  FH-2608-5005  In house      ← survived

Postgres:  checked_in · room 208 · occupancy occupied · adults 2
           the 204 pre-assignment RELEASED, so she holds one room, not two
```

Refusals, tested before the success:

```
room 308 (out of service)   That room is held out of service.
no ID and no reason         Capture the guest's ID, or give a reason.
room 203 (occupied)         Room 203 is held by FH-2608-4859 for part of that stay.
checked in twice            Already checked in.
```

Each is a sentence a clerk can act on, not a constraint name.

**`FOR UPDATE` on the reservation row.** Two clerks checking the same booking in
at once would otherwise both read `confirmed`, both write `checked_in`, and both
assign a room. The second now waits and finds the status already moved.

### Three defects, all the same shape

**The gate read a different source from the action it guarded.** `checkIn` moved
to HTTP; `checkInAllowed` still read the store — so it looked up a Postgres uuid
in a store that has never seen one and disabled the button permanently, with
"Reservation not found." A clerk would have faced a check-in they could never
perform and no way to learn why. **A gate that consults a different source from
the action it guards is not a gate.**

**The room picker blocked the guest's own room.** `assignableRooms` marked a
room taken when "a booking covers tonight" — which counted the arrival being
checked in as the reason it could not be checked in. Status, not dates.
MEMORY.md defect 3, third occurrence.

**A rename would have forced the first screen change.** The API calls it
`status`; the store called it `housekeeping`, and `CheckInFlow` was written
against the store. The mapping went in the repository. That is what a seam is
for, and it is the one thing this checkpoint measures.

### The measure, unbroken

```
$ diff <46 screen files, CP9 baseline> <after stayview, stays, folios, check-in>
  ZERO — no page or component changed
```

### What is on HTTP now

```
properties · rooms · stays · folios · stayview · check-in
```

Still on the store: the other four flows (charge, reverse, settle, check-out),
`statistics`, `reportData`, `managerReport`, `directory`, `billing`, `admin`,
`notifications`.

---

## CP10 complete — all five flows write to Postgres, 28 August

```
POST /:code/stays/:id/check-in
POST /:code/stays/:id/charges
POST /:code/stays/:id/charges/:postingId/reverse
POST /:code/stays/:id/payments
POST /:code/stays/:id/check-out
```

### The ledger, exercised for real

Six rows for one stay, from the live database:

```
 id  | category |          description       |  amount  | reverses
-----+----------+----------------------------+----------+---------
  12 | room     | Room 202 · 1 night         |  1800.00 |
 142 | food     | Restaurant dinner          |   600.00 |
 143 | food     | Reversal — Restaurant …    |  -600.00 |     142
 144 | payment  | Received — UPI             | -1990.00 |
 145 | payment  | Reversal — Received — UPI  |  1990.00 |     144
 146 | payment  | Received — Cash            | -1890.00 |
```

**The posting count goes UP when something is undone.** Nothing is edited and
nothing is deleted, so every correction is visible and the balance is always
the sum of what actually happened.

### Every refusal, tested before the success

```
check out with a balance     ₹1,890 is still outstanding. Settle the folio,
                             or transfer it to the city ledger, before
                             checking out.
check out while OVERPAID     The guest has overpaid by ₹100. Refund it
                             before checking out.
reverse twice                That posting has already been reversed.
check out twice              This stay has already departed.
charge of zero               A charge of zero is not a charge.
```

An overpaid folio blocking check-out matters: the hotel is holding money that
is not its own, and nobody chases a refund they are owed.

### Migration 021 — the permission was the design telling me something

The reversal endpoint first took `select … for update` on the posting, to stop
two clerks reversing the same charge at once.

```
ERROR:  permission denied for table folio_postings
```

`pms_app` has SELECT and INSERT here and deliberately **not UPDATE** — the
ledger is append-only, and `FOR UPDATE` needs the update privilege even when
nothing is updated. The permission was not in the way; it was saying the lock
was the wrong tool.

A **unique index on `reverses_id`** says the same thing without a lock, and
says it to everyone rather than only to the code path that remembers to take
one. Two concurrent reversals now leave one inserted and one refused, and the
`23505` comes back as *"That posting has already been reversed."* rather than a
500.

### Verified through the interface, not only by curl

```
Folios → Sameer Gokhale → Settle → Cash ₹1,890 → Take payment
  Postgres:  folio_postings  payment  -1890.00
             payments        cash      1890.00
→ Check out
  Postgres:  reservation checked_out · folio closed
             room 202 → vacant / dirty
```

The room reaches housekeeping's board the moment the guest walks out, rather
than the next time somebody remembers.

### The tax rate moved server-side

`taxOn()` in `src/lib/rules.ts` still shows a clerk what will be charged, but
the figure that lands in the ledger is computed where the rate lives — from
`hotels.cgst_rate + sgst_rate`. GST is a state subject; a constant in the
browser is the wrong place for it.

### The measure, still unbroken

```
$ diff <46 screen files, CP9 baseline> <after all five flows>
  ZERO — no page or component changed
```

Six checkpoints of writing to an in-memory store, then five flows moved onto a
real database, and not one screen noticed.

### Gates

```
DATABASE   21 migrations · 51 assertions · 7 isolation checks · run.sh exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean
```

### Still on the store

`createWalkIn`, `statistics`, `reportData`, `managerReport`, `directory`,
`billing`, `admin`, `notifications`. All read the same data, so the remaining
half-swapped state stays coherent.

---

## Audit, 28 August — the walk-in was writing nowhere

**`createWalkIn` still wrote to the in-memory store while every screen had
moved onto HTTP.** A clerk would have taken a walk-in, seen it reported as
successful, and then found no such guest — no error, no row, and somebody
standing at the desk. Reachable from any empty cell on the tape chart.

It now creates the guest, the reservation, the assignment and the first night's
charge in **one transaction** in Postgres.

```
walk-in into an occupied room   Somebody is already in that room.
the same room twice             Somebody is already in that room.
a real walk-in                  FH-2608-5031 · Vikas Pawar · checked_in
                                room 209 occupied · charge 6400.00 + 320.00
```

Two things the schema corrected on the way:

- **`walk_in` is not a valid assignment reason, and should not be.**
  `ra_reason_valid` allows arrival, move, upgrade, downgrade, fault,
  group_consolidation. A walk-in **is** an arrival — the column records what
  happened to the ROOM, not how the booking was taken.
- **The reference is generated by the database.** `nextReference()` produced one
  client-side, which cannot stay unique the moment two clerks take a walk-in at
  the same desk.

### `operations.ts` no longer touches the store at all

Not to read, not to write. The only thing it still takes from `src/data/store.ts`
is the `Posting` **type**. `listHousekeeping` was the last reader and now calls
`listStays`.

### Gates

```
DATABASE   21 migrations · 51 assertions · 7 isolation checks · exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean

$ diff <46 screen files, CP9 baseline> <now>
  ZERO — no page or component changed
```

### A handover for an agent outside this session

`START-HERE.md` is new, and it is the file to open first. It assumes no shared
context: how to start all three processes, the six rules, how to verify, what
not to touch, what to do next, and the five questions only a human can answer.
It names the fact that Postgres lives in a temp directory and how to rebuild it
if that directory is gone.

---

## The next stage — `AGENT-STAGE-3-4.md`

Written 28 August. Stage 3 (auth bridge) and Stage 4 (front desk and folio, end
to end) in six checkpoints, CP7–CP12.

The finding that shapes it: **`MASTER.md` §5 specifies an App API that verifies
the Firebase token, sets `app.user_id` and connects as `pms_app` — and that API
does not exist.** No `api/`, no `server/`, no functions directory. It is the
largest missing piece in the project and both stages sit on it.

One human decision is named there and does not block the work: where Postgres
lives in production. The recommendation is DigitalOcean managed Postgres at
$15/mo, because the constraint across every free tier is backups, not storage —
and finding C3 is still open.

`db/tests/rls.sql` is the one item in that plan that depends on nothing and can
start immediately.

---

## Open, and needing a human rather than an agent

1. **The four keyboard checks.** Tab through `/h/:code/stay`. Ring on buttons or
   only inputs? Brand or browser default? Does Escape close Dialog and Drawer?
   Does focus return to the trigger? Focus *trap* is confirmed; the rest is not
   measurable from a script.
2. **Names and room counts for six of the seven properties.**
3. **Does the CRS accessibility fix ship now or go to backlog?** Two defects,
   live in production, found by porting. Details in `MEMORY.md`.
4. **The commercial question.** Under about ₹4 lakh a year for the group,
   buying eZee wins and this stops. Not revisited since the numbers changed.
5. **Room charges post whole-stay at arrival, not pro-rata nightly.** A guest
   arriving 24 August for four nights carries all four nights' charge today.
   Real night-audit posting is one night at a time. Changing it moves every
   in-house balance, so it belongs with the night audit at Stage 8 rather than
   as a quiet edit now.

---

## Open on the database — `D:\PMS FIDATO\db`

**Re-verified 28 August by rebuilding from zero**, not quoted from a previous
run. `db/tests/run.sh` dropped the database, applied all 17 migrations and ran
the suite: **51 assertions across 21 suites, 0 failed.** Against the live
catalogue: 22 tables, all 22 with RLS enabled, 32 policies.

Tenant isolation was checked by hand as `pms_app` (which does **not** have
`BYPASSRLS`), scoped to the Agra clerk: 4 reservations visible, **0 belonging to
another hotel**. The four `app.*` helpers are all `SECURITY DEFINER`, which is
why `staff_hotels` can carry RLS with no policy at all — the join table is
invisible, and only the trusted function may read it. That is deliberate and
correct.

Three items still outstanding:

- **`hotels_read` is `app.is_active_staff()`** — every active staff member can
  read every hotel row. Almost certainly deliberate, since the property
  switcher needs the list, but it means an Agra clerk can enumerate all seven
  properties. Worth confirming rather than discovering later.

- **Concurrency testing.** All 51 assertions ran serially. Nothing has yet
  exercised two clerks booking the same room in the same millisecond, which is
  what the `EXCLUDE` constraint exists for.
- **Backup and WAL archiving**, logged as finding C3. A verified schema with no
  recovery path is a partial result.
