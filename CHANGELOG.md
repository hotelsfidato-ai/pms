# Changelog

**Every agent writes here. One entry per working session, newest first.**

This exists because a commit message explains a commit, and nobody reads 165
of them to find out what happened last week. `MEMORY.md` records *mistakes*;
this records *work*.

**Since 15 September each service keeps its own log too:**
`src/modules/<service>/CHANGELOG.md`, same entry shape. Work inside one service
goes there; work across services, in the core, or on the process goes here.

---

## How to write an entry

Write it **as you go**, not at the end from memory. Copy this shape:

```markdown
## YYYY-MM-DD · what you were asked to do

**Asked for:** the owner's request, in their terms, not yours.

**Shipped**
- what changed, and where — `path/to/file`
- one line each, in plain words

**Found** (defects — also number them in `MEMORY.md`)
- what was broken, how it was found, whether it is fixed

**Proved**
- the gate numbers you ACTUALLY ran, not the ones you expect
- for every guard added: that it fails when the bug is put back

**Left open**
- what you did not do, and why. Blocked on a decision? Say whose.

**Commits:** `abc1234 … def5678`
```

### Three rules for this file

1. **Numbers you ran, not numbers you remember.** "254 API tests" is a claim.
   Run them.
2. **A guard is not proved until it has refused something.** If you added a
   test, break the code and watch it fail, then say so here. Eleven guards in
   this project passed with the bug reintroduced before anyone checked.
3. **"Left open" is not a confession, it is the handover.** The next agent's
   first question is always *what was in flight?*

---

## 2026-09-16 (plan) · Desktop, kiosk tablet and phone — which architecture

**Asked for:** the owner asked which architecture to build desktop, mobile and
tablet applications on, naming Expo for Android and iOS and asking what is
better for desktop given this system. Their answers on the two questions put
back: the desktop must be a real installed application because silent printing
matters; the tablet is Android and must be locked so "the tab is only of this
software"; the phone is for staff and guests eventually; and the reason behind
all of it is availability — "many places will have a server but not very
reliable network".

Then, second question: **can this POS route a KOT and give a printout?**

**Shipped**
- `docs/APPS-PLAN.md` — the plan. One shared core, three shells: Tauri wraps
  today's `dist/` for desktop, Capacitor wraps the *same* `dist/` for the
  Android kiosk tablet, and Expo is a new small staff phone app rather than a
  port of the 89 screens. Eleven decisions (A1–A11) with a recommendation each.
- `docs/APPS-PLAN.md` § 4.2a — the KOT answer, measured against the schema,
  and Phase 0a ahead of the Tauri work.
- `src/modules/pos/DEFECTS.md` — **POS-5**, below.
- `HANDOVER.md` § 2 (the state block), § 3.0c (the new item) and § 4 (three
  decisions the owner made today).

**Found** (no code defects; four findings that shape the plan)
- **React Native cannot reuse this UI.** Measured: 285 files and 48,435 lines
  in `src/` excluding tests, 72 pages and 27 shared components, all of it
  Tailwind v4, Radix, react-router and Recharts. Only `src/data/repositories`
  and most of `src/lib` port. "Expo for all three surfaces" is a multi-month
  rewrite of a live hotel for a desktop result worse than the deployed one.
- **The guest app cannot be started.** `booking-engine`, `online-checkin` and
  `guest-messaging` are Coming-soon stubs — two `.tsx` files each, no screens.
  There is nothing to put in an app, and it also waits on the CRS bridge.
- **The gapless GST counter is what constrains every offline design.**
  `app.next_invoice_number()` (migration 011) locks a row in `invoice_series`
  per hotel per financial year. Two writers cannot issue from one series, so a
  local property node is only safe if it is the *sole* issuer for its own
  hotel — which the `(hotel_id, fin_year)` key does allow.
- **The API needs no change for any of this.** A native `fetch` sends no
  `Origin`, so the allowlist at `api/src/server.ts:61` is not even reached;
  the same Firebase ID token and the same RLS apply unchanged.
- **POS-5 · the kitchen docket is built and nothing opens it.** `DocketPage`
  is real, thermal width, no prices, with a Print button
  (`pages/Docket.tsx:64`) at `/h/:code/till/orders/:id/kot/:no`. No file in
  `src/` navigates to it; the bill, by contrast, is opened from three screens.
  The waiter is told "Kitchen docket 5" and no paper appears. Logged in
  `src/modules/pos/DEFECTS.md`. The 16 September route audit missed it because
  it matched **API** routes to callers, and this is a **website** route.
- **KOT routing does not exist.** There is no station in the schema:
  `pos_menu_items` (028) has no station or printer column; `pos_menu_categories`
  is the card and says so in its own comment; `pos_sections` (047) is where the
  *table* is, not where the dish is cooked; `pos_outlets` (024) is a credential
  with a revenue category. `Kitchen.tsx` is one board for every line. Today a
  tandoor dish, a bar drink and a dessert share one slip.

**Proved**
- Nothing to prove: no code was written, no gate was run, and none is claimed.
  Every figure above was counted on this machine on 16 September, branch
  `cp6`, by reading the files named.

**Left open**
- All eleven decisions A1–A11 except A2, which the owner answered. Nothing
  starts before **A1** (extracting `packages/core`), and Phases 0a, 1 and 2
  cannot finish without **A6** — which thermal printer the desk and the POS
  actually use — or **A11**, how many kitchens 5 Elements actually has.
- **POS-5 is not fixed**, only recorded. Whether dockets are meant to print at
  5 Elements today, or the pass screen is the intended path with the docket
  kept for a reprint, is the owner's answer and nobody has asked them.
- The `pos` folder was **not claimed**: no code in that service was touched,
  only its defect log.
- **A8** is a question only the owner can answer: does any property already
  have a local server, and what is it? Phase 5 cannot be scoped without it.
- Whether a property node is built at all is deliberately deferred to Phase 3,
  which measures real outage minutes per property from the outbox for a month.

**Commits:** documentation only; not yet committed.

---

## 2026-09-16 (pricing B and C) · The Pricing screen

**Shipped** — the screen the owner asked for: one screen, shaped like a
calendar, holding the dates, the base and each difference.

- `/h/:code/pricing` — a month of dates with the base on each; click one, or
  choose **a period**, and type a figure. The differences sit under it: every
  room type (per room) and every meal plan (per person), each a figure or a
  dash. Under that, **what a room actually costs on that date** for every type
  × plan, read back from the database rather than worked out on the screen,
  each marked *Set here* · *From the base* · *Old rack rate* · *Not priced*.
- `api/src/modules/inventory/pricing.ts` — one read for the whole screen, and
  three writes: which room is the base, the base figure, a difference. The
  arithmetic stays in the database, where the channel manager will meet the
  same rules.
- **Guarded.** The first rate screen with a `canSee` and a route guard:
  `RATE_SETTER_ROLES` = owner, admin, GM. Reception's grant is `rate: READ`,
  and the guard asks the navigation, which asks the grant — so without this a
  clerk could set the figure every price is built from. Proved by opening it
  as reception: "This page is not part of your role."

**Proved, at 1280 and at 375:** chose the base, typed a figure for one date,
and watched every other room and plan derive it; set a room-type difference
and watched that room read the base plus it — *From the base · 1 person*. At
375px: nothing outside the viewport, no sideways scroll, **0 controls under
44px**. 212 web tests · 370 API tests (a new `pricing.test.ts`) · 622 database
assertions · types and build clean. Every figure written while testing was
removed from the development database afterwards.

**Three found, all recorded:**
- **INV-4, fixed before it shipped** — with no base typed, the screen showed
  the room type's **rack rate** as "the base, one person": a two-person figure
  presented as a one-person one, and the figure everything else would then be
  built from. It now shows a dash and names the rack rate that still answers.
  `app.price_for` returns a price AND its source; reading the number without
  the source is how a fallback becomes a fact.
- **INV-5, open and NOT fixed** — the **Rate calendar** writes prices and has
  no guard at all, so a reception clerk who types the address can set one
  today. Closing it takes something away from a role that has it, which is the
  owner's call.
- **MEMORY 278, mine** — this morning's card heading was a `<p>`, and Guests
  puts a `<div>` in its first column. Invalid HTML, which React reported on
  every render since it shipped; found by reading the browser console. Now a
  `<div>` marked `data-card-heading`, with the test reading that rather than
  the tag.

---

## 2026-09-16 (pricing A) · One base price, and everything else a difference

**Asked for:** *"this room is the base price and other things are connected by
a difference to this, so that when a change happens it reflects all through the
system"*. The plan is `docs/PRICING-PLAN.md`; this is its first phase, the
schema. **No screen yet, and nothing is priced.**

**Migration 090**
- `pricing_basis` — one row per property naming **which** room type and plan is
  the base. A pointer, not a number: the figure stays in `rates`, so a season on
  the base flows into every derived price for free.
- `rate_offsets` — a difference in **rupees**, with dates, per room type (per
  room) or per meal plan (per person). The same no-overlap constraint `rates`
  has: two differences covering one day is the same unanswerable state two
  prices are.
- `rates.covers_persons` — **the line that stops this repricing anything already
  sold.** The base covers one person; every row written before today covers
  what its room type says, and NULL means exactly that. An old typed price
  keeps its meaning to the rupee.
- `room_types.category` — Deluxe, Deluxe valley view, Deluxe with an extra bed
  group under one name while each stays its own sellable type with its own
  capacity. Configuration, not price; the owner's distinction.
- `app.price_for` answers a price **and what it covers** — typed → derived →
  rack → NULL. `app.rate_for` keeps its name, signature and meaning.
  `app.tariff_for` counts extra people above what the covering price covers, so
  two adults on a derived price are the base plus one extra adult.
- `app.set_offset` writes a difference over a range, splitting and trimming what
  is already there and putting the tail back.

**Nothing changes until the owner acts.** No property has a basis, so nothing
derives; `covers_persons` is NULL everywhere, so nothing recounts.

**Two rules the gate found, not me:**
1. A difference on the **base** room type can never apply — the base's price is
   typed. It must not reach the base type's other plans either, or breakfast on
   the base room would cost it twice over. A season on the base is a typed base
   row.
2. A standing difference and a seasonal one cannot both cover a day — which is
   why `app.set_offset` exists. Asserted that the standing difference is still
   there a year after the season ends.

**Proved:** `db/tests/modules/inventory.sql`, 23 new assertions — **620
assertions, exit 0**, RLS proven as `pms_app`; **API 359 tests, exit 0** via
`npm test`; migration numbering and web types clean.

---

## 2026-09-16 (mobile, part two) · The stay screens use their own cards

**Asked for:** the owner's answer to the question the first mobile pass raised —
should the five screens that already have purpose-built cards show them on a
phone? **Yes.**

**Shipped** — `src/modules/front-desk/components/StayTable.tsx`:
- Below `sm` the bespoke `StayCards` render **whatever the remembered toggle
  says**. The toggle hides on a phone: at a desk, a table of forty rows against
  cards is a real choice; on a phone it is not one.
- The pairs inside a card go to one column below `sm` and wrap instead of
  truncating — two 160px columns turned "Booking.com" into "Booking.c…".
- `data-stay-cards` marks the list, because `DataTable` now has cards too and a
  test that matched the shape alone passed with these cards deleted. **Proven
  by deleting them**: "the stay cards are not rendered on a phone".

**Measured at 375px**, signed in and reading each screen: Arrivals 10 cards, In
house 9, Walk-ins 21, All bookings 86, Folios 5 — nothing outside the viewport,
no page scrolling sideways, no toggle. At 1280: the table and the toggle
unchanged, 0 cards. Types clean · **212 web tests**, exit 0 · build clean, "no
test sign-in in dist".

**Recorded** — `src/modules/front-desk/DEFECTS.md` FD-4, including the two
things the next person needs: there are two card renderers, and the wrapper
that hides one of them is not a bug to be tidied away.

---

## 2026-09-16 (mobile) · A list is a card list on a phone

**Asked for:** improve the mobile experience; the owner chose the mobile pass
before the pricing build.

**Measured first**, at 375px as a reception clerk, twelve screens: no screen
scrolled the page sideways, but **six screens a receptionist lives in put a
table wider than the phone inside a sideways scroller** — Arrivals, In house,
Walk-ins, All bookings, Guests, Folios. Housekeeping, the one screen built for
a phone, had **36 controls under 44px**. The Till has no heading (like the
Kitchen — POS-3).

**Shipped**
- `src/components/ui/DataTable.tsx` (the shared core, so this reaches every
  screen that uses it): below `sm` each row renders as a **card** — the first
  column its heading, every other column a labelled line — and the table
  renders unchanged from `sm` up. **A column hidden on narrow screens
  (`hideBelow`) is shown in the card**, because the card has the room the
  table did not. Sorting keeps a control, which the card list would otherwise
  lose with the header row. A long value wraps instead of being clipped.
- Housekeeping: the assignee picker 36 → 44px; the out-of-service button
  40×44 → 44×44.
- `src/components/ui/DataTable.test.tsx` — four tests. The one that matters
  fails if a column goes missing from the card, **proved by making the card
  skip hidden columns**: "the card dropped Source".

**Proved:** re-measured at 375px — six screens now render cards (10, 9, 21,
86, 32, 7 of them), nothing outside the viewport, no page scroll; Housekeeping
0 controls under 44px. Types clean · 210 web tests, exit 0 · build clean.

**Found, and the owner's to decide:** `StayTable` already had a card view
(`StayCards`) with a manual table/cards toggle, used by Arrivals, In house,
Walk-ins, All bookings and Folios. I should have grepped before writing a
generic one (`AGENTS.md`: "reusable pieces — check before you build"). Nothing
is duplicated on screen — a person sees one or the other — but there are now
two card designs, and on a phone the bespoke one only shows if that person has
chosen "cards". The question is in the handover.

---

## 2026-09-16 (fixes) · The People guard and the shadowed rate-plans route

**Asked for:** "now fix the people guard and the rate-plans route."

**Shipped**
- **PEO-1 fixed** — `/people` is wrapped in
  `<RequireAccess path="/people" resource="user">`
  (`src/modules/admin/routes.tsx`), with the reason above it. A reception
  clerk who types the address now gets "This page is not part of your role"
  instead of a screen with Add somebody, Password, Edit and Deactivate on it.
- **INV-1 fixed** — `GET /api/hotels/rate-plans` removed from
  `api/src/modules/inventory/roomTypesAndPlans.ts`; the reason stays in its
  place. It could never run: `GET /api/hotels/:code` matched "rate-plans" as a
  property code, so it answered 404. Nothing called it; the meal plans come
  with `GET /:code/rate-plans`.
- Both closed in their service's `DEFECTS.md` with what was done, and marked
  fixed in `PENDING.md`.

**Proved:** web types clean · 206 web tests, exit 0 · **359 API tests, exit 0**
· strip-check 68 files · api types clean.

**Found — MEMORY 277, mine:** I first ran the API suite as `npx vitest run`,
which points it at the development database, and 43 tests failed on data
drift. The suite is `npm test` (its own database, decision D1). Re-run
properly: 359 passed. The development database was written into by that bad
run; `npm run demo` reloads it.

---

## 2026-09-16 (defects) · Every service carries its own defect log

**Asked for:** "each folder needs to contain its own defects file, so that when
I start a new session on a specific service it shows all the defects for that
service and what the previous solution was — so you don't recompute the
solution, and errors are prevented before they become big."

**Shipped** — `src/modules/<service>/DEFECTS.md`, thirty of them, replacing the
per-service `MEMORY.md` (same content, the name everybody uses, no second file
to drift):
- **Open defects, with the fix when it is done** — 26 across eleven services,
  every one from `PENDING.md` § 2a and § 2c and the audits, now sitting in the
  service a session will be working in: RES-1/2/3, REP-1/2/3, ADM-1/2/3 with
  PEO-1 and API-2, INV-1/2/3, POS-2/3/4, GUE-1, FIN-1/2, BQ-1/2, HK-1, NA-1,
  FD-1/2.
- **Fixed ones, with what was actually done** — so the solution is read, not
  worked out again. FD-3 (the walk-in refusal) is named as the worked example
  for RES-1; HK-2 (the board's offline read) carries 274's fix.
- **Each service's project-wide entries**, carried over from the old file and
  now quoting each root entry's own rule line where it has one — 49 for the
  front desk, 42 for the restaurant, 30 for administration.
- Every pointer repointed in 45 files (`CLAUDE.md` step 4, `AGENTS.md`,
  `HANDOVER.md`, the root `MEMORY.md` header, every `MODULE.md` and service
  changelog). The root `MEMORY.md` keeps its name and its plain numbers; 276 is
  the last.

**Proved:** `src/test/boundaries.test.ts` now requires `DEFECTS.md` in every
service folder beside `index.ts` and `MODULE.md` — **shown to refuse**: with
`spa/DEFECTS.md` moved away the run failed naming that file, and passed when it
was back. Web types clean; 206 tests, exit 0.

**Left open:** the 26 open defects themselves. The file says, for each, what the
fix is when somebody does it.

---

## 2026-09-16 (audit) · Every route called, every screen opened, and PENDING checked

**Asked for:** "do a full in-code audit on what was pending, and if all the
routes are working well; start it in local for testing; an audit of all the
routes which are present at the moment."

**Done —** `docs/audits/2026-09-16-routes-and-pending.md`. Run locally
(Postgres 55432, API 8787, website 5173) with the demo data; production read
read-only for § 5. Two local writes, both undone: the banquet module switch,
and probes that created nothing.

**Measured**
```
routes                214  (92 GET · 92 POST · 13 PATCH · 10 PUT · 7 DELETE)
GET proven answering   81 as the owner · 69 as a reception clerk
answering wrongly       1  GET /api/hotels/rate-plans (INV-1, confirmed live)
no caller anywhere     13  attachments 5 · approvals 4 · night-audit 2 · add-ons 2
called by something
  other than the web    5  /health and the four POS-bridge routes
screens                89 addresses · 86 opened and rendered · 0 console errors
```

**Found (PENDING § 2c)**
- **PEO-1**: `/people` has no route guard — a clerk can open it and sees
  buttons the server refuses. One line to fix; the test already exists.
- **POS-2**: two restaurant add-on routes have no caller anywhere.
- **API-2**: a clerk can read the audit log and the property settings through
  the API, though both screens are refused to them.
- **POS-3**: the Kitchen screen has no heading.
- The five heading mismatches and INV-1 confirmed on screen and by running.

**Corrected mid-audit, before it reached the owner:** a probe made it look as
though a clerk could create staff and set another person's password. The
routes validate the body before they check authority, which is what I saw;
the guards are there (`app.may_set_password`, `app.require_group_admin`), and
row-level security hides the rows. Nothing was created or changed.

**Proved:** the sweeps above; `PENDING.md` § 5's missing route-reachability
gate was built as a script and is now a candidate test.

**Left open:** the seven-step order in the audit's § 6, for the owner to
approve, and everything already in `PENDING.md`.

---

## 2026-09-16 · Every missing service: a folder and a Coming soon page

**Asked for:** "ok now for a hms with all the requested services which are
currently missing in the current system". Asked how (four questions, each
with a recommendation), the owner took every recommendation: a folder and a
Coming soon page for every missing service — all twelve, not only the four
they had named; one "Coming soon" section at the foot of the menu for the
owner, admins and general managers; on a branch after the service-folder
move, deployed after it; then a build order to approve, one service at a
time.

**Shipped — branch `coming-soon`, on top of `service-folders`, not deployed:**
- **Twelve new service folders:** `leads` (Leads and WhatsApp), `marketing`,
  `crm` (Central CRM), `spa` — the four the owner asked for on 15 September —
  and `online-checkin`, `laundry`, `contracts`, `revenue-management`,
  `reputation` (Reviews), `loyalty`, `guest-services`, `equipment` (Hotel
  equipment, "When a hotel asks") — the standard list in `PROGRESS.md`. Each
  has `MODULE.md`, `CHANGELOG.md`, `DEFECTS.md` (its own defect prefix, added
  to the root `MEMORY.md` header), an empty `index.ts`, `nav.ts`,
  `routes.tsx` and `pages/<Name>.tsx`.
- **The five brief-only folders** (`crs`, `payments` — marked "Parked" —
  `booking-engine`, `guest-messaging`, `accounting`) got the same page, entry
  and address; their briefs and front doors say so.
- **The channel manager** moved from Inventory (unlisted) into the section;
  its route is now guarded.
- **Core:** `src/pages/ComingSoon.tsx` — one page for all of them: what it
  will do, what it needs before it can be built, where it stands today;
  nothing invented. `seesComingSoon` in `src/lib/permissions.ts` — owner,
  admin, GM — asked by the menu and by every route guard alike.
  `navigation.ts` has the `coming-soon` section; `App.tsx` mounts the routes.
- **Thirty service folders:** twelve working services, eighteen not built.

**Found**
- Checked before writing: the desk's Post a charge list
  (`src/lib/rules.ts`, `CHARGE_CATEGORIES`) offers Laundry but no Spa,
  minibar or telephone line, though the folio has those categories. The
  pages say exactly that.
- **MEMORY 276, mine:** "Contracts and allotments" was cut off in the
  sidebar ("Contracts and allotm…"). Found by opening the screen as a GM,
  after every gate had passed. Renamed "Contracts" before committing; a new
  test refuses a menu label over 21 characters — proved by putting the long
  name back.

**Proved** (on the final code, exit codes read)
```
web types        clean (tsc -b --force)
web tests        206 passed, exit 0 (two new: the Coming soon list for
                 owner/admin/GM and nobody else; the pages refused to exactly
                 the people the menu hides them from; plus the label length)
build            clean; no test sign-in in dist
api types        clean (untouched)
menus            every role's menu and search compared fact by fact with
                 before: owner, admin and GM gain the 18-entry section at the
                 foot; Reception, Hotel Manager and Viewer lose only the
                 channel manager's page from search (and cannot open it);
                 nothing else in any menu moved, appeared or went
screens          as Reception: no section, /coming-soon/spa refused; as GM:
                 the section at the foot, all 18 pages opened from the menu,
                 each with its heading and pill (Online payments "Parked",
                 Hotel equipment "When a hotel asks"); phone and desktop widths
```

**The build order — proposed, the owner approves one service at a time**
```
before any   deploy the service-folder move, then this; RES-1 and 008; which rooms 5 Elements has
 1  Channel manager      the definition arrives 16 Sep; the largest gap; needs the three doors
 2  Leads and WhatsApp   the Meta token expires about 27 Sep; the app exists — connect it
 3  Fidato CRS           bookings in, rooms and prices out
 4  Guest messages       the leads app's WhatsApp pipeline, reused; four later services need it
 5  Accounting export    independent and small — can run alongside 1–3
 6  Online payments      only if the owner un-parks it; before the booking engine
 7  Booking engine       after 4 (and 6, for deposits)
 8  Online check-in      after 4
 9  Central CRM          after 2 and 3
10  Marketing            after 2 and 9
11  Contracts            independent — alongside
12  Laundry              independent, small — alongside
13  Guest services       independent, small — alongside
14  Spa                  once the owner says which hotels have one
15  Reviews              after 4
16  Loyalty              after 9
17  Revenue management   needs a year of bookings in this system
18  Hotel equipment      when a hotel asks
```

**Decided by the owner:** the four answers above (HANDOVER § 4).

**Left open:** the build order's approval; merging `service-folders` and
then `coming-soon` into `cp6`, and deploying each on its own.

---

## 2026-09-15 (one system) · The plan to connect the CRS, the live inventory, the leads and a channel manager

**Asked:** "integrate the 3 to 4 different services into this … the CRS system
into this itself, and the channel manager (being defined, finalised tomorrow) —
prep sections saying coming soon … build a full HMS … the live inventory and the
leads captured from Meta ads over WhatsApp as a CRM … a central CRM with all the
data … the ability to replicate this and sell it as a product … use agents to
find the compatibility issues … create the plan of execution."

**Done — a plan, nothing built, nothing changed in any system:**
`docs/HMS-INTEGRATION-PLAN.md`, with its page at
https://claude.ai/artifact/WzopVpwms2vPUrgawHUapy. Read from the code of
all three applications (`D:\fidato crs`, `D:\fidato tools\new live invetory`)
and a read-only look at production (one hotel, 5EL, 18 rooms; six booking
sources; modules banquet and reception_pos; n8n running on the box in local
mode). Three read-only audit agents — the PMS's own readiness, CRS ↔ PMS, live
inventory + leads ↔ PMS — 66 findings, their reports in `docs/audits/`.

**What the plan says, in short.** Only the PMS has a server, so it is the hub:
its API is the contract and the n8n on its box is the only place the other
systems' credentials may live (MASTER-ARCHITECTURE already says so). For a
hotel on the PMS, the PMS is the record; the other apps hold display copies.
Three doors to open in the PMS (an identity for machines, a home for other
systems' ids, an idempotent booking route), then three wires (availability
out, bookings in from the CRS and the leads, the channel manager on the same
paths). Phases 0–7; six agents in six folders after Phase 0.

**Found on the way, each the owner's call (PENDING § 2a):** the server
enforces no role on writes (API-1); two API responses turn an unpriced room
into ₹0 (INV-3); the booking reference is generated unlocked in two copies
(RES-2); `POST /bookings` has no idempotency, and RES-1 is worse than written
(RES-3). And the same hotel is 18 rooms in the PMS, 17 in the CRS's reference
file and 17 differently-numbered rooms in the live inventory.

**Mistake, MEMORY 275:** I quoted a commission figure off the wrong line of a
file I had only skimmed; an audit agent caught it before it reached the owner.

**Decided by the owner:** nothing yet — fourteen decisions (D1–D14) wait in
the plan's § 5, each with a recommendation.

---

## 2026-09-15 (the move) · One folder per service — built and verified

**Asked for:** split the code so each segment has its own folder and several
agents can work at once; the owner took all four recommendations and said
"now"; then "run multiple agents to complete this".

**Shipped** — on branch `service-folders`, from tag `pre-service-folders`
- **Eighteen service folders** in `src/modules/`: thirteen built, five with a
  brief and no code (crs, payments, booking-engine, guest-messaging,
  accounting). Every screen, dialog and data file of a service lives in its
  folder; its server routes in `api/src/modules/<service>/`; its server tests
  in `api/test/modules/<service>/`; new database checks in
  `db/tests/modules/<service>.sql` (suite.sql frozen as history).
- **The shared files became lists:** the menu, the screen addresses and the
  server's mounts are assembled from each service's `nav.ts`, `routes.tsx` and
  `api/src/modules/<service>/index.ts`. A service adding a screen edits no
  shared file.
- **The mixed files were split along whole sections:** six web data files and
  `Directory.tsx` in place first, then six server files endpoint by endpoint.
  Shared helpers moved to core `result.ts`, `http.ts` and `api/src/folio.ts`.
- **Guards:** a service is reached only through its front door (web and
  server); every service folder has its door and brief; migration numbers are
  unique and contiguous; every menu entry lands in a real section and no two
  claim one place. All seen to fail when broken.
- **Each service's brief**, `CHANGELOG.md` and `DEFECTS.md`; AGENTS.md rewritten
  for working by service (own worktree, database and ports; claims; requests;
  notes with prefixed defect numbers).
- **How it was done:** the web moves, guards and lists by me, one commit per
  service; then six agents in parallel git worktrees — three for the server,
  one for the web tests, two for the briefs — merged one at a time, every gate
  after each.

**Found**
- 272 · the move silently narrowed a guard (Rule 2b); widened, seen to fail.
- 273 · the agents' worktrees sat inside the repo — test runner and git saw
  them; excluded and ignored.
- 274 · MINE: since the Start here commit every web test run exited 1 (two
  uncaught rejections) while I reported green by reading pass counts. The
  housekeeping board now catches a missing offline store, as OfflineBar does.
- The business date was about to be homed in a service; it is the core's.
- From the briefs, not fixed, the owner's call (PENDING § 2a): RES-1 a refused
  booking can leave records behind; REP-2 the Manager report's year is typed
  as 2026; REP-1 the monthly and yearly statistics show fixed months; ADM-2
  the flat 2.5% + 2.5% GST on Settings and Properties; ADM-1 the audit log's
  "admin"; BQ-1 no bill can be charged to a banquet function; INV-1 a
  shadowed route; headings unlike their menu entries; FIN-1 a stale comment.

**Proved** — final run on 7f60029, every gate judged by its exit code
- Web: types clean; 204 tests in 18 files, exit 0.
- API: types clean; 359 tests in 28 files, exit 0; 68 files load.
- Database: 588 assertions; 89 migrations re-runnable.
- Build: clean, no test sign-in, config at the live API.
- Unchanged from the start: every role's menu under four module states (1,023
  facts), all 73 screen addresses with the same screens, the API's 214 routes
  with the same pattern answering first for every request, 10 middleware in
  order.
- On screen, local: 41 screens across every service as the General Manager;
  as Reception, the working menu of 15, Start here on Rooms, the till.

**Left open**
- Merging `service-folders` into `cp6`, and deploying it on its own — the
  owner's.
- PENDING § 2a (the briefs' defects) and § 2b (the till is one 3,555-line
  file; the web tests need this machine's root `.env`; the agents' worktrees
  are still in `.claude/worktrees/`).
- The owner's stray note in a comment in `navigation.ts` (there since 5
  September) — theirs to keep or remove.

**Commits:** `pre-service-folders..service-folders`.

---

## 2026-09-15 (plan) · One folder per service

**Asked for:** split the code so each segment — inventory, CRS, reports, POS
and the rest — has its own folder, and a folder for every service a hotel
system offers, so several agents can each work on one; "plan this task".

**Shipped**
- `docs/SERVICE-FOLDERS-PLAN.md` and the owner's page: 12 built services plus
  the core, 6 not-built ones as brief-only folders, the six server files that
  serve several services and where each endpoint goes, the shared files that
  become lists, the rules for parallel agents, and a ten-step order of work.
- `HANDOVER.md` § 3.0 points at it: planned, nothing moved.

**Found**
- `RoomTypesPage` and `RatePlansPage` in `src/pages/Directory.tsx` are routed
  nowhere (already in PENDING).

**Proved**
- Counts measured, not estimated: 51 screens, 24 flows, 22 data files (barrel
  used by 79 files), 26 server files and 27 mounts, 89 migrations, `suite.sql`
  5,867 lines; each mixed file's endpoints grouped by path.

**Left open**
- The owner's four decisions (depth, which folders, when, where notes go).

**Commits:** the plan commit.

---

## 2026-09-15 (deploy) · Everything since 10 September is live

**Asked for:** the owner ran the deploy a day early and asked what preflight's
errors meant, then "deploy complete, check the live site".

**Shipped** (by the owner, from `HANDOVER.md` § 9)
- Server: `1c2e5d0`, migrations 085–089, API restarted 15 Sep 13:09 GMT.
- Website: the owner's build `index-DkwUzh40.js`, published to Firebase.

**Found**
- 271 · the deploy re-created the placeholder administrator `REPLACE@fidato.in`
  (deleted 9 September; migration 008 re-inserts it whenever the row is
  missing). Preflight refused to call the server ready. The owner switched it
  off from People at 13:14 GMT; preflight then passed. Not an open door —
  sign-in needs a Firebase uid that only a group administrator can attach.
- The folder name needs quotes in PowerShell (`cd "D:\fidato pms"`); § 9 now
  carries them.

**Proved** — read-only, after the deploy
- API: healthy, as `pms_app`, started 13:09 GMT; 088's guard and the new staff
  columns present; both walk-ins have their channel; "Reception can use the
  POS" on; the owner's sign-in link untouched (only `updated_at` moved).
- Preflight: every check green, "Ready." (the owner's run).
- Website: the live main bundle is the owner's build, byte-named the same as
  `dist`; it carries the new screens; `config.json` points at
  `https://api.fidatohotels.com`; no test sign-in in any built file; the API
  answers the test header with 401 and allows the live site's origin (CORS).
- NOT checked by me: the signed-in screens — I do not enter the owner's
  password, and the in-app browser could not open the live site. The owner's
  checklist is in this session's reply.

**Left open**
- The owner's answer on fixing 008 (PENDING 1a).

**Commits:** the post-deploy documentation commit.

---

## 2026-09-15 (deploy prep) · The steps for the 16 September deploy

**Asked for:** "give me the deploy steps for tomorrow".

**Shipped**
- `HANDOVER.md` § 9 rewritten from the checks below: a backup BEFORE the
  pull (`launch.sh` backs up only after it has migrated), what each step
  prints when it worked, a health check that the server really restarted,
  what to look at on the site, and what to do if it goes wrong.

**Found**
- `launch.sh` migrates before it backs up. Not changed — the step is added
  to the procedure instead.
- `api/.db-password` (written by `launch.sh`) is not in `.gitignore`: it shows
  as untracked on the server. Harmless while nobody commits there; a one-line
  ignore is worth adding.

**Proved** — read-only, nothing on the server changed
- Server: on `cp6` at `1f77239`, clean but for that file, so the pull
  fast-forwards; root's git trusts `/opt/fidato`; the deploy key reads
  GitHub's `cp6`; API healthy since 9 Sep; disk 46%; last backup 15 Sep 03:00.
- Database: 088 and the 087/089 columns absent, as expected; 085 will fill
  the channel on 2 walk-ins; 087 will switch "Reception can use the POS" on
  for the one hotel.
- Locally: strip-check loads all 42 API files; `npm run build:app` passes
  (no test sign-in in `dist`, config points at the live API). Not published.

**Left open**
- The deploy itself — the owner's, on 16 September.

**Commits:** the deploy-prep commit.

---

## 2026-09-15 (step 4) · Help where the question is

**Asked for:** "yes, continue with step 4" — the clarity plan's last step.
The owner chose, before any code: a card per role, and it goes when they tap
"Got it".

**Shipped**
- **Start here** — a card of each person's first jobs, each a link to the
  screen it happens on, with the real button named: reception five (take a
  booking, check a guest in, take a payment, check a guest out, open the cash
  drawer), housekeeping three, the waiter three, the chef one; none for the GM
  or the owner. Only on the person's landing screens (reception: Dashboard,
  Rooms, Calendar; housekeeping: its board; waiter: Tables and Till; chef: the
  kitchen board). A job done on the screen you are on is not a link.
  `src/components/app/StartHere.tsx`, content in `startHereCards.ts`.
- "Got it" is remembered per person on the server — 089,
  `staff.start_here_dismissed`, `app.set_start_here` (the caller's own row
  only) — so it follows them to any terminal. The account menu shows
  **Show Start here again** once it has been put away.
- **Tap-to-explain terms** — `Term` (dotted underline; tap, not hover, because
  the desk and the POS are touch screens) over one glossary,
  `src/lib/glossary.ts`, every line checked against the code that produces the
  figure. On the Dashboard (Occupancy, ADR, RevPAR, Owed by guests, City
  ledger), the Manager report (PTD, YTD, the two ledgers, occupancy, ADR,
  RevPAR, no-shows, day use, complimentary), the Form C hint at check-in, and
  the Folios and Night audit descriptions.
- **Empty states** — six tables that said "Nothing here yet" now say what
  belongs there and where it comes from (Payments, Company accounts, Guests,
  Companies and agents, Users, Audit log); the kitchen's empty columns speak
  in their own words; Housekeeping got loading, error and empty states.
- The desk's last three "folio"s are "bill" (and the check-in line now says
  where the ID-skip reason really goes: the stay's note).

**Found** (numbered in `MEMORY.md`)
- 265 · three desk sentences still said "folio" after step 1; one was untrue.
- 266 · the City ledger printed an invented contact for every account
  ("Mr. Agoda") on screen and in its CSV, since 28 August. Fixed in its own
  commit: the company's real contact on its own row, a dash everywhere else.
- 267 · `startHere.ts` beside `StartHere.tsx` collided on Windows. Renamed.
- 268 · MINE: my first placement of the card left the Rooms screen 41px of
  rooms on a phone. Measured, moved inside the rooms' scroll.
- 269 · Housekeeping drew nothing while loading, on failure, or when empty.
- 270 · a deliberate break that missed the behaviour — caught, redone.
- Noted, not changed: on a phone the Rooms screen's controls take 376px of 812
  before any room shows (PENDING).

**Proved**
- Database: all 588 assertions passed (7 new for 089); all 89 migrations
  re-runnable. The new block fails without 089.
- API: 359 passed in 28 files — 4 new for the card's flag, 2 for the ledger's
  contact; each group seen to FAIL with its change stashed.
- Front end: `tsc -b` clean; 197 passed in 13 files — 7 new. Each of the six
  behaviours seen to fail under a deliberate break (the GM one needed a second
  try, MEMORY 270).
- On screen, local, against the real API: reception lands on Rooms with the
  card; "Got it" → `PUT /api/me/preferences` 200 → `desk@fidato.in` flag true
  in Postgres → still gone after a reload → back from the account menu, flag
  false. The GM sees no card. RevPAR and PTD open their meanings. The City
  ledger shows no "Mr." anywhere. Measured at 1280×800 and 375×812.

**Left open**
- The plan's own "done when" — somebody who has never seen the system books,
  checks in, takes a payment and checks out without being told — needs a real
  new person. Not something I can run.
- The waiter's and chef's cards are proved by tests only: the local dev
  sign-ins have no waiter or chef.
- The deploy: 089 joins 088 and the rest.

**Commits:** the step 4 commit, and the city-ledger commit.

---

## 2026-09-15 (review) · An audit, a security review, and an account takeover closed

**Asked for:** before step 4, "do an audit of the code and tell me how much
is complete, and also review the code for bugs and security vulnerability".

**Shipped**
- 088 · `app.may_claim_address` / `app.require_claimable_address`, and
  `POST /admin/staff` asks it before any Firebase account is touched.

**Found**
- 263 · SECURITY, live 9–15 September: any hotel manager could take over the
  owner's login — or anybody's — by "adding" their email with a password of
  their own. `ensureAccount` sets the password of an account that already
  exists, and it ran before any check of whose address it was; Firebase is
  not in the transaction, so the database's later refusal changed nothing.
  Fixed; NOT deployed.
- 264 · MINE: proving the fix, I took it out and ran its tests — and the
  API suite carried the PRODUCTION Firebase key from `api/.env`, so the
  unfixed code created `owner@fidato.in` and `pune@fidato.in` on the live
  sign-in service. Read-only checks after: neither existed before, neither
  is linked to staff, they are the only test-looking accounts of the five.
  The wrapper now blanks the key and `guards.test.ts` fails if it returns.
  Removing the two accounts is the owner's call.
- Minor: Bill, Docket and Kitchen set no browser-tab title, so the tab keeps
  the previous page's name.
- Checked and clean: token verification (revocation on; the dev header cannot
  run in production — env.ts throws and the service sets NODE_ENV); SQL
  (parameterised everywhere; the one dynamic SET list is hard-coded columns;
  the database's dynamic SQL is migration-only, over catalog names); CORS
  (allowlist in production); the POS bridge (hashed keys, service account
  under RLS); the live stream (header auth, signal only); uploads (generated
  paths, type allowlist, filename scrubbed); no raw-HTML sinks in the web app;
  the audit trail records `app.current_user_id()`, never the browser's
  "front desk"; staff edits take only name and phone.

**Proved**
- Database: all 581 assertions passed (7 new for 088, among them the owner's
  address refused in capitals); all 88 migrations re-runnable.
- API: 353 passed in 28 files. Under the Firebase-free wrapper the two new
  refusals FAIL with the fix taken out (a 500 — the request reached
  `ensureAccount`) and pass with it; the new guard fails if the suite ever
  carries a service account again.

**Left open**
- The deploy. Interim, on the owner's yes: deactivate or re-password
  `demo@fidatohotels.com` (owner role at 5EL, shared password).
- Whether the hole was used: CHECKED, read-only — it was not. No real
  account's tokens were reset after it went live (the owner's last on 8 Sep;
  the other two only at creation on 9 Sep).
- The review was single-context; the skill's sub-agent pass was not run.

**Commits:** the review commit.

---

## 2026-09-15 (step 3) · A menu for each person, and the search it depends on

**Asked for:** "continue with step 3, the menu by person". The owner chose
the lists before any code (`HANDOVER.md` § 3.2): reception's core eight plus
All bookings and the cashier drawer; the restaurant and kitchen roles get
their own screens; three reports listed for everybody; no revenue Dashboard
for housekeeping, kitchen and stores.

**Shipped**
- `WORKING_MENUS`, `sidebarFor`, `workingHomeFor` in `navigation.ts`; the
  sidebar shows what a person works from. `listed: false` for ten reports and
  the unconnected channel manager. Floor is "Tables" (menu and heading).
- "Find a screen" — `CommandPalette.tsx`, opened by the top bar, Ctrl K and a
  button at the foot of a shortened menu. Every screen the role may open, with
  "Not in your menu" on the ones that left it; `keywords` on 36 entries so the
  retired words still land. The top bar says "Find a screen", and shows Ctrl K
  on Windows instead of a ⌘ key the desk does not have.
- Housekeeping, kitchen and stores land on their own work after sign-in.

**Found**
- 260 · waiter, chef and kitchen manager could not see the restaurant; house-
  keeping could not see Work orders. Fixed with `canSee`; no permission changed.
- 261 · the search button opened nothing since CP0. Built.
- 262 · my critique counted the development build ("Design system" is dev-only):
  reception's live menu was 47, not 48. Corrected everywhere it was written.
- Counting error in my own question to the owner: listing three reports
  removes ten, not nine.

**Proved**
- `navigation.test.ts` pins each role's list and that search still reaches
  what left a menu; failed when Night audit was planted on reception's list,
  and three tests failed when search was limited to the listed menu.
- App.test "find a screen": Ctrl K + "rate plans" reaches Rate plans, and
  "folio" reaches Folios; both failed with the palette unmounted.
- `npx tsc -b` clean; `npx vitest run` 190 passed in 13 files.
- On screen: Reception's sidebar 15 entries with "Find a screen" at its foot,
  and "folio" found Folios marked "Not in your menu"; GM's Reports lists three
  and no Channel manager.

**Left open**
- Record search (guests, bookings) in the palette. Clarity step 4.

**Commits:** the step 3 commit.

---

## 2026-09-15 (step 2) · One main action per screen

**Asked for:** "continue with step 2, the primary buttons" — the clarity
plan's second step, as scoped in `HANDOVER.md` § 3.1.

**Shipped**
- Every dialog's confirm and each screen's main action declares itself: 67
  buttons, each edit checked against its label before it was applied.
  Destructive confirms — Void, Cancel the function — are `danger`, not orange.
- The bill follows its state (`FolioPanel.tsx`): Settle is primary while money
  is owed, Check out once it may happen; never both. Not before arrival, when
  checking in is the act.
- The Groups page drew its selected view in primary orange — two buttons
  faking a toggle. It is the system's `Segmented` control now.
- `Button` carries `data-variant`, so a test can see what a button means.
- The desk's bill no longer says "folio": its balance label, and the
  settle / check-out reasons in `src/lib/rules.ts` (wording only; every rule
  unchanged — `rules.ts` is shared and frozen, and this is the saying-so).

**Found**
- 259 · the new guard's first red was a wrong root path, not a finding.
- Survey regexes missed six unmarked confirms; the guard found them (dish
  dialog Add, Form C Save, till discount Apply, bill Post charge, and two
  that needed an explicit secondary: the Assign room trigger and the import
  dialog's Close).

**Proved**
- `primaryAction.test.ts` failed naming exactly `RoomSetup.tsx:385` when that
  confirm's variant was removed; restored, it passes.
- The stay-panel test failed with `['Settle', 'Check out']` when Check out was
  made always-primary; restored, it passes.
- `npx tsc -b` clean; `npx vitest run` 181 passed in 13 files.
- Opened as Reception on local data: New booking has one primary ("Confirm the
  booking", grey until the form can be sent); Tanvi Bhide's stay panel shows
  "Settle and check out", and on Bill exactly one orange "Settle" with Check
  out blocked beneath it and its reason.

**Left open**
- `Terminal.tsx` draws its own touch buttons, not `<Button>`; its send action
  is not marked. Clarity steps 3 and 4: `HANDOVER.md` § 3.2 onwards.

**Commits:** the step 2 commit.

---

## 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

**Asked for:** start it locally and say what is pending from the owner's side,
with an audit of how much is done; then use the installed impeccable and taste
skills to fix the sign-in screen, the Dashboard (icons — "it looks plain") and
the reports, and show the changes on a canvas; then critique the whole site,
audit it, and plan how to make every view and name clear enough that "a simple
person" can start using it; then a handover so another agent can continue
without the owner re-explaining.

**Shipped**
- The owner-side list in `PROGRESS.md` rewritten to what is actually
  outstanding — it still asked for the Oracle box and the Firebase key, both
  live for weeks.
- Sign-in: a split with the group's real mark (in `src/assets/brand/` all
  along, never used outside the design-system page), the primary button it had
  never had, a password reveal through `Input`'s own `trailingSlot`, and a
  recovery line naming the GM — `src/pages/SignIn.tsx`.
- Dashboard: a lucide icon on every tile, the four headline figures set larger,
  the six house counts in one row, warning colour only above zero, one icon per
  quick report — `src/pages/Dashboard.tsx`.
- Reports: the property and the person on every report come from the session
  (`src/lib/documentIdentity.ts`), and the Manager report has CSV.
- Step 1 of the clarity plan — one vocabulary: room states on the pills, the
  Dashboard and housekeeping; sentence case across the menu and headings; the
  menu label, page heading and browser tab say the same words
  (`src/lib/documentTitle.ts`); a heading on Rooms; the owner's glossary (Bill at
  the desk, Folio in Finance; Guests not Pax; Order not KOT on screen).
- `navigation.test.ts`: fails on a Title Case menu label or two entries with one
  name.
- `.gitignore`: the installed agent skills (`.agents/`, `.claude/skills/`,
  `skills-lock.json`) — third-party, not the hotel's code.
- `HANDOVER.md` rewritten at the top as the current brief; the 28 August state
  kept below it as an archive. `CLAUDE.md` added so a Claude session reads it
  first.

**Found**
- 256 · every report printed "5 Elements By Fidato Hotels" and "front desk" —
  literals no caller ever overrode. Fixed in `ReportShell`; the same two
  literals remain in `FolioPanel.tsx` and `CheckInFlow.tsx`.
- 257 · the sign-in button was a secondary button. Fixed. The same default
  leaves 279 of 282 buttons secondary — clarity step 2.
- 258 · the Rooms screen named every state twice, and my own plan mapped two of
  them wrong (Vacant is Empty, not Free; Reserved is not Arriving). Fixed.
- Critique 22/40: the menu shows reception 47 entries in the live build
  (48 in the dev build I counted — MEMORY 262; the design-system page is
  dev-only); no help or glossary anywhere; every tab titled
  "Fidato PMS"; four pages with no heading.

**Proved**
- 574 database assertions, 87 migrations re-runnable, 350 API tests in 28
  files — run this morning. `npx tsc -b` clean; `npx vitest run` 179 passed in
  12 files after the last change.
- The sentence-case guard failed on a planted "Night Audit" and passed when it
  was put back.
- Opened as Owner and as Reception: sign-in (phone and desktop measured), the
  Dashboard, Rooms, Housekeeping, the reports list, the Manager report and
  Lodging tax — tab titles, headings and words checked on each.

**Left open**
- Clarity steps 2–4 and staff-first phases 2–4: `HANDOVER.md` § 3, in order.
- Nothing since 14 September is deployed. The owner runs the deploy.
- The critique was a declared single-context run and impeccable's detector was
  not run — the owner chose written guidance only.

**Commits:** `bdf2932 … e9b4bac`, and the handover commit.

---

## 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

**Asked for:** fix the walk-in bug and the booking it damaged; give n8n webhook
access; get local testing running; redesign the stay panel to an eZee-style
reference; fix a departed group room showing "Room —"; hard-coded local test
sign-ins for the GM and the desk, never in production; plan a "staff-first"
programme from the owner's report exports and CRS voucher; then start its
phase 1.

**Shipped**
- 085: a walk-in records the Walk-in channel, and a refused walk-in leaves no
  guest behind (the refusal now comes before the first write). The deploy
  back-fills FH-2609-5001.
- `deploy/n8n.sh`: the screen answers only the owner's address, webhook paths
  answer everybody; `allow` swaps the address.
- The local Postgres moved to `D:\fidato-pg` — Windows Storage Sense was
  deleting it from `%TEMP%`.
- One stay panel, rebuilt to the owner's reference — `StayDrawer.tsx`.
- 086: `app.stay_room()` — a departed group room says where it stayed.
- Test sign-ins for GM and Reception (`db/dev/dev-testers.sql`) with a "View
  as" switcher; `scripts/check-no-dev-login.mjs` fails a build that contains
  them.
- Staff-first phase 1 (087): Dashboard; Rooms and Calendar as two entries; the
  first screen after sign-in set per person; Room type / Floor remembered per
  person; "Reception can use the POS" per hotel, refused by the server too.

**Found**
- 242–254 in `MEMORY.md` — among them: any clerk could switch a hotel's
  modules; a refused receptionist was told the menu was empty; the Calendar link
  opened Rooms; the Manager report's period always began on 1 August; the
  landing redirect was lost to StrictMode's double render.

**Proved**
- 574 database assertions, 87 migrations re-runnable, 350 API tests, 176
  interface tests at the end of the day. Every screen opened in all three roles.

**Left open**
- The deploy. "Two in-house numbers" (property page 11, Dashboard 10) — needs
  one definition, owner to choose.

**Commits:** `d703c30 … 6238e5b`

---

## 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box

*Reconstructed on 15 September from `git log` — no entry was written at the
time. The commit messages carry the detail; `PENDING.md` was written the same
day as the end-of-phase record.*

**Shipped**
- Booking sources as the group's list with a per-property rate, on screen and
  through the API (`2471fed`, `9b708e3`, `c047f8d`).
- Discounts: a free hand up to 10%, named promotions beyond it (`1890b67`).
- The floor can close its own outlet (`63ef8a5`).
- Admin end to end — four endpoints that had no way in (`bc99567`).
- The property screen, run by its general manager (`d3788f2`); adding somebody
  makes them able to sign in, with a password (`fc98b6a`, `a09e24e`); retiring
  people (`23f18f3`).
- A gate that fails when a seam function has no caller (`9eed9c1`).
- n8n installed beside the PMS, its certificate renewing, backups taken before
  an upgrade migrates (`c126656`, `8c6c0e9`, `1f77239`).
- **Deployed:** production has run `1f77239` since 10 September.

**Commits:** `5d9c459 … 1f77239`

---

## 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

**Asked for:** the owner reported banquet would not turn on and that
admin was "not fully built", then asked for questions before any
building. Four decisions taken, then phase 1 of the resulting plan.

**Decided by the owner**
- Banquet: enable it for Akkalkot
- Approvals: **discounts above a threshold** only — not voids, rate
  overrides or comps
- Attachments: **parked**, all four uses in scope eventually, needs
  architecture first
- Channel manager and payment gateway: **excluded for now**

**Shipped**
- **Banquet turns on.** The switch carried
  `disabled={busy === module || module === "banquet"}` beside a note
  reading *"Not built yet"*. Stage 14 built it — three screens, four
  tables, an API — and nobody came back for the switch. Guard added:
  *every module the API accepts has a switch somebody can press.*
- **A property can be created in production.** `/admin/properties`
  carried a card explaining that the form *"belongs with the auth
  bridge"* — a dev-only screen — while `README.md` step 8 told the owner
  to add six properties there. The form now ships and **keeps the
  provisioning key**; a wrong key and a missing key both return 403 with
  a sentence somebody can act on, from the database.
- `components/flows/StaffAdmin.tsx` — the panels, shared by the console
  and the properties screen.
- `README.md` step 8 is true, and now names the Firebase link people
  miss.

**Found**
- **214** a switch that said "not built yet" about something built.
- **216** a screen that explained why it could not do its own job.
- **217** ⚠ **RETRACTED: adding a user was never missing.** I reported
  it as a P0, built a screen, and was wrong three ways.
  `src/pages/People.tsx` has done the whole job since **7 September**,
  at `/people`, in the sidebar — and it badges *"Cannot sign in"* on an
  unlinked account, which is the step I thought I was adding. **The
  problem I found had been found and fixed the day before.** Reverted.

**Proved**
```
db/tests/run.sh    515 assertions      api npm test  273 · 23 files
db/tests/rerun.sh  81 of 81            vitest        172
tsc -b  0   api tsc  0   strip-check 32   build:all  3 clean
```
Both new guards proved by putting their bugs back: the banquet switch
disabled again fails two assertions, and the module test was found
**vacuous first** — no `/modules` branch in the test stub meant zero
switches rendered and "none is disabled" was trivially true of none.

**Left open**
- **The server is six commits behind** and still holds the `launch.sh`
  that destroys TLS on every upgrade.
- Phase 2 begins with the **reachability gate**, deliberately before the
  two remaining features. 217 is the argument for it: a capability
  audited by URL prefix answers a question about the prefix.

**Commits:** `236125f … 5d9c459`

---

## 2026-09-08 (deploy) · Live, and four faults on the way there

**Asked for:** push today's work to Firebase and the Oracle box.

**Deployed**
```
API   api.fidatohotels.com   81 migrations · preflight 12 of 12
app   pms.fidatohotels.com   verified in the live bundle, not assumed
```
The published bundle was checked for today's work rather than trusted:
the order pad, the held state, preparation times, courses and the
by-table pass are all present, and the development sign-in shortcut
appears **zero** times.

**Found** — 209 to 212, all in the deploy path
- **209** **a parameter property took the live API down.**
  `constructor(public readonly reason: string, ...)` is valid TypeScript
  that `node --experimental-strip-types` cannot load — it erases types
  and emits nothing. `tsc` accepted it, vitest transpiled it, three
  clean builds said nothing. **Nothing in this repository ran the API
  the way the server runs it.** Ninth deploy-only fault of that shape.
- **210** the gate written for 209 **passed the bug it was written
  for** — `node --check` parses without running the stripping
  transform. Caught by putting the bug back. The working version calls
  `stripTypeScriptTypes`, the loader's own function.
- **211** **every upgrade destroyed TLS.** `launch.sh` overwrites the
  nginx config, where certbot's 443 block lives, then skipped certbot
  *because the certificate existed*. nginx came back on port 80 only,
  the app calling an https API that had stopped speaking https, and
  every step reported success. *"Leaves the certificate alone"* was true
  and not enough: the files survived, the configuration using them did
  not.
- **212** **the preflight ran as the one user that could never pass** —
  root, against a peer-authenticated socket as `fidato`. It has called a
  healthy box `NOT READY TO SERVE` since defect 192. 12 of 12 pass when
  run as the right account.

**Shipped**
- `api/scripts/strip-check.mjs`, wired as `npm run strip-check` **and
  into `launch.sh` before the service restart** — so a deploy stops
  before touching a running service rather than after it is already
  crash-looping. The second placement matters more than the first.
- `launch.sh` re-applies an existing certificate to the rewritten
  config, and runs the preflight as `$DB_USER_ADMIN`.
- `deploy/README.md` documents the pull, which needs root's write access
  **and** the login user's deploy key, because `/opt/fidato` belongs to a
  nologin account with neither a home nor a key.

**Left open**
- **The server has not pulled these fixes yet.** The box is correct — it
  was repaired by hand — but its `launch.sh` is still the one that
  breaks TLS. Pull before the next upgrade.
- Nothing verifies the deploy from OUTSIDE the box. Every fault above
  was found by `curl` from a laptop, and three of the four looked
  healthy from inside.

**Commits:** `6170aa6 … f2bb955`

---

## 2026-09-08 (night) · Course sequence and the pass by table — Stage C5

**Asked for:** course sequence, and a kitchen view by table. The last of
Stage C.

**Shipped**
- **`081_courses.sql`** — `course` on the category and on the dish, with
  the same fallback shape as 079 so there is one idea and not two.
  `app.course_of` is the only place it is written.
- **NOT `sort_order`, and the menu itself proves why.** Akkalkot sorts
  Starters·0, Main course·1, **Beverages·2**, Desserts·3 — a drink sits
  between the mains and the puddings, because that is a sensible order to
  read a card in. A pass built on that would fire every drink after the
  mains, every service. Two questions, two columns.
- `app.pos_order_courses` — what a table is still waiting for, lowest
  course first and unsequenced last, with per-stage counts. Served and
  voided lines excluded: a course that reached the table is not something
  the kitchen is holding.
- **The pass has a second view.** *By stage* is what a chef on a section
  works from; *by table* is what the person calling the pass works from —
  "is table 7 ready to go" cannot be answered from three columns that
  scatter one table's food across the screen. Kept in the URL, so a pass
  screen that reloads comes back where it was.
- Tables sort oldest-first, by their **oldest** dish; courses group in
  order with **Any time** last.

**Found** — 207, 208
- **207** the `nulls last` clause turned out to be **intent, not
  mechanism**: Postgres already defaults `ASC` to that, so removing it
  broke nothing and the assertion could not tell the two apart. The
  suite now guards the plausible wrong fix instead —
  `coalesce(course, 0)`, tidying the null away, which fires the drinks
  first. Two assertions catch it.
  **Fourth "can this guard fail?" check today and the first where the
  answer came before the guard was trusted.**
- **208** the general shape of that: a column that happens to sort
  correctly today is not the same as a column that means what you need.

**Proved**
```
db/tests/run.sh    515 assertions (11 new)   api npm test  272 · 23 files
db/tests/rerun.sh  81 of 81 re-runnable      vitest        170
tsc -b  0    api tsc --noEmit  0             build:all     3 clean
```
Opened in a browser, with three tables on the pass: courses grouped
**Course 1 → Course 2 → Any time**, the unsequenced drink sorting after
the sequence rather than ahead of it, tables oldest-first, estimates
shown. The course field was supplied at the network boundary because the
running API predates it — see below.

**Left open**
- **The local API server still needs restarting.** Third session running.
  It does not reload, so it serves neither the prep times, the timings,
  nor the courses. Everything is verified against the harness, which
  builds fresh from the migrations.
- **Stage C is now complete.** C1 through C5.

**Commits:** `cfa3bae …`

---

## 2026-09-08 (night) · Timing capture — Stage C3

**Asked for:** timing capture. Ordered, started, passed, served.

**Shipped**
- **`080_kitchen_timings.sql`** — `pos_line_events`, append-only. Every
  move a dish makes through the kitchen is its own row, with who made it.
- **A ledger, not four columns, because dishes go backwards.** The
  kitchen endpoint allows any move between preparing, ready and served —
  deliberately, because a chef marks a dish ready, the waiter does not
  come, and it goes back. Columns would overwrite the first time or
  refuse the move. Rows keep both: ready at 19:20, back at 19:24, ready
  again at 19:31.
- **Written by a trigger, not by the routes.** Four paths change
  `kot_status` today and the fifth will be written by somebody who has
  not read the migration. Same reasoning as 075.
- `app.pos_line_timings` — the four durations, from the **LAST** entry
  into each state, because a dish sent back was ready when it was ready
  the second time. Null everywhere something has not happened yet.
- **`at_pass_min` is the one that ruins food** and nothing showed it
  before. `app.pos_line_lateness` compares actual cook time against the
  079 estimate; null when either half is missing, never zero, which
  would read as "exactly on time".
- The pass now shows the estimate and, for a ready dish, **how long it
  has been under the lamp** — judged on a much shorter clock, because
  two minutes there is worse than eight in a pan.

**Found** — 204, 205, 206, all mine
- **204** the assertion that mattered most **passed with its own bug in.**
  `now()` is the transaction time, so every event in the test block
  shared a timestamp and `min(at) = max(at)`. The guard was comparing two
  spellings of the same number. Third false green today. Now asserted on
  explicit, distinct times, and the bug fails two assertions.
- **205** I spelled row-level security by hand instead of using
  `app.auth_hotel_ids()`. **Nine API tests returned 500.** Isolation is
  written once; a second spelling is a second thing to get wrong.
- **206** the append-only guard blocked **every teardown in the repo** —
  deleting an order cascades to its lines and on to the timings. Narrowed
  to the rule that is actually true: a timing may go with the dish it
  describes, and only then. When a new constraint breaks five existing
  places, the constraint is usually too wide.
- Applied 201's lesson the same day: the pass renders `!= null`, so a
  cached feed from before these fields exists shows a dash rather than
  "undefined min est". Verified against a server that genuinely omits
  them.

**Proved**
```
db/tests/run.sh    504 assertions (12 new)   api npm test  270 · 22 files
db/tests/rerun.sh  80 of 80 re-runnable      vitest        170
tsc -b  0    api tsc --noEmit  0             build:all     3 clean
```
Both directions. `pos_line_timings` rewritten to `min(at)`: *"the timing
used the premature ready at +5"* and *"it sat at the pass for 14 minutes
| 18.0"*. The recorder detached from `pos_order_lines`: three tests fail,
*"expected [] to deeply equal [ 'sent' ]"* — which is the whole argument
for the trigger.

Opened in a browser: the pass shows **— est** against a stale server, not
"undefined min est".

**Left open**
- **The local API server still needs restarting** to see the real
  estimates and pass clock. Unmanaged process on 8787, not this
  session's, does not reload.
- C5 — course sequence and a kitchen view by table — is the last of
  Stage C, and now unblocked.

**Commits:** `ab10b38 …`

---

## 2026-09-08 (late) · Preparation times — Stage C2

**Asked for:** preparation times. The column three stages have been
waiting on.

**Shipped**
- **`079_prep_times.sql`** — `prep_minutes` on the dish and on its
  category, nullable with no default, checked 1..480. `app.prep_minutes`
  resolves dish → category → null, and is the only place that fallback
  is written. `app.pos_order_prep_minutes` gives the longest dish on a
  round — what the table actually waits — and **returns null if ANY live
  dish is untimed**, because "the longest of the ones we happen to know"
  reads as a promise and is not one.
- **Null is not zero, and that is the whole feature.** "0 min" sorts a
  dish to the front of a kitchen display and gets it started last.
  Untimed shows a dash, the same rule the prices follow.
- `POST /till/menu/items/:id/prep` and `/categories/:id/prep`. Null
  clears and falls back; a MISSING field is refused, because a screen
  that forgot to send it would otherwise wipe a time somebody set. The
  category reply says **how many dishes it actually moved**.
- The menu payload carries the resolved time and the dish's own, so a
  screen can tell "12, chosen here" from "12, inherited" — without it,
  clearing a dish looks like it did nothing.
- `PrepControl` on the menu screen: tap to set, empty to clear, `*` for
  inherited.
- Queued offline, deliberately — no scarce resource, no money, and two
  managers disagreeing is last-writer-wins.

**Found** — 201, 202, 203, all mine
- **201** the menu screen printed **"undefined min"** on its first open.
  The browser held a menu response from before the field existed, because
  `till-menu` was persisted for seven days this morning. **A week is the
  right life for the data and the wrong life for its shape.** Fixed with
  a per-build `__CACHE_BUSTER__`, and the control now renders `== null`
  so a missing field reads as untimed. Adding the define to
  `vite.config.ts` alone killed 18 tests — **`vitest.config.ts` does not
  inherit from it.**
- **202** `returning app.prep_minutes(id)` reads the row as it was, not
  as it is. Clearing a dish reported the old number back. Caught by
  *"expected 3 to be 15"*. Fixed with a second statement rather than a
  CTE, which would have been a second copy of the fallback.
- **203** **the API typecheck gate had been red all afternoon** — my two
  cross-boundary test files. I had been running `tsc -b` at the root,
  which does not check `api/`. 196's lesson again.

**Proved**
```
db/tests/run.sh    492 assertions (9 new)   api npm test  266 · 21 files
db/tests/rerun.sh  79 of 79 re-runnable     vitest        170
tsc -b  0    api tsc --noEmit  0            build:all     3 clean
```
Guard proved in the dangerous direction: `pos_order_prep_minutes`
rewritten as a naive `max()` — which silently ignores nulls — gives
*"one untimed dish makes the whole round NULL | 25"*. It would have
promised a table 25 minutes on a round it could not estimate.

Opened in a browser: the menu screen shows **&mdash;** on every untimed
dish and on the category, against a server that omits the field
entirely.

**Left open**
- **The local API server needs restarting to see this.** It is an
  unmanaged process on 8787 that this session did not start and does not
  reload; it still serves the menu without `prepMinutes`. Restart it and
  the times appear.
- C3 (timing capture) and C5 (course sequence, kitchen by table) are now
  unblocked.

**Commits:** `88c02cc …`

---

## 2026-09-08 (evening) · A room charge with the line down

**Asked for:** room charging must work even when the net goes — stored,
and **synced before anything closes.**

**Shipped**
- **`till-rooms` is now kept on the device.** The owner's decision,
  reversing the one I left open this morning. A waiter cannot pick a
  room from a list they cannot see. The note in `src/App.tsx` records
  what was weighed: it is a small daily list already visible at the
  till, not a guest database — documents, folios and history stay off.
- **`ruleFor` now takes the request body**, and has exactly one branch
  that reads it. `/settle` is four different acts at one address: room
  is **held**, cash/card/UPI stay **refused** because a drawer is
  counted at close. A split bill qualifies only if EVERY part is a room
  charge.
- `api/test/roomChargeOffline.test.ts` — the whole chain, and it imports
  the frontend's own `ruleFor` rather than restating it.

**Found**
- **199** *the sync-before-close guard already existed.*
  `app.pos_day_end_blockers` has refused to close a day over an open
  bill since migration 050 — and a held charge means the bill is still
  open, so the day cannot close. **It holds across devices**, which no
  client-side check could. I nearly rebuilt it.
- **200** the settle endpoint is the only write whose tier depends on
  its body, and the reasoning for why is now written where it is read.
- My own, twice: the test skipped its whole file on a wrong column name
  (`room` for `room_number`) — the defect-195 shape again, caught
  because 4 skipped is not 4 passed; and it asserted `sum(amount)`
  against the bill's `payable`, coming out 16 short on 336 — exactly the
  5% — because a folio keeps net and tax in separate columns. The test
  was wrong, not the code.
- The teardown hit `pos_order_lines_frozen`: a settled bill's lines
  cannot be deleted, which is correct. Now follows `till.test.ts`'s
  established pattern — reverse the postings, lift the trigger for the
  delete, put it back — rather than inventing a third spelling.

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    261 · 20 files
npx vitest run     168                   npm run build:all   3 clean
```
Guard proved in the dangerous direction: `isRoomCharge` made to return
true for everything → *"cash must not queue: expected 'queue-warn' to be
'refuse'"*.

**Left open**
- **Not walked in a browser.** No guest is checked in on the development
  database, so the waiter's own screen for this could not be opened. The
  server chain is covered by tests; the two UI mechanisms are the ones
  verified this morning with `till-menu` and the pad's held state. It
  should be walked once a property has somebody in house.
- **The accepted risk:** a guest can check out while a charge is held.
  The server refuses it on drain and the outbox keeps and shows the
  refusal — loud, not silent, but somebody must chase it. See 200.

**Commits:** `e6cc053 …`

---

## 2026-09-08 (later) · The order pad — Stage C4

**Asked for:** a waiter on the floor should not walk back to the till.
Tapping a table opens a pad over the floor plan; dishes go on with no
network; one Send puts the round in the kitchen. Then: build it.

**Shipped**
- **`src/components/flows/OrderPad.tsx`** — the pad. Opens over the
  floor, never navigates. Reuses `DishDialog` unchanged, because that
  component never touched the network and its `onAdd` already carried
  the batch endpoint's shape.
- **`src/lib/draft.ts`** — an unfinished order, written to IndexedDB as
  it grows. One draft per table. A **separate store from the outbox on
  purpose**: everything in the outbox is destined for the server and
  drains on reconnect; a draft may never be sent, and mixing them means
  a half-taken order leaves for the kitchen because the wifi came back.
- **`src/lib/pricing.ts`** — `unitPriceOf`, the one place a dish is
  priced on this side. `DishDialog` had its own copy; the pad would have
  been a third.
- **`sendOrder()`** in the seam — one `POST /till/orders/batch`, with
  **three** outcomes, not two: sent · refused · **held**.
- `src/App.tsx` — `till-menu` added to the persisted set, so the pad
  opens with no signal. `till-rooms` deliberately not added: it carries
  guest names and a waiter's own phone is not the front-desk machine.
- `src/pages/Floor.tsx` — the tap no longer calls the server or leaves
  the screen. A running table is tappable too (another round on the same
  bill). **A table with an unsent round is marked "not sent"** — it is
  invisible otherwise: the kitchen has nothing, the bill has nothing,
  and only one waiter's phone knows.

**Found**
- **195** `padTotal.test.ts` skipped its own most important case and
  reported PASS with the bug deliberately in. It looked for a dish with
  sides *and no variations*; the only dish with sides has variations, so
  it returned quietly. Eleventh guard in this project caught doing this.
- **196** ~~the API suite cannot run~~ — **RETRACTED, and it was my
  error.** I ran `npx vitest run` instead of `npm test`. The documented
  command is wired to `scripts/with-test-db.sh`, which already builds a
  scratch database, applies all 78 migrations, loads the fixtures that
  create AGR and PUN, seeds the demo and drops it afterwards. Run
  properly: **257 passed, 19 files, 0 failed.** I published a false
  finding about a design contradiction that does not exist. Worse: the
  wrong command writes to the *development* database and deleted the
  order-pad orders I had just made — the exact fault that harness was
  built to end.
- **198** `with-test-db.sh` hardcoded `psql.exe` with no fallback, so
  the API gate was Windows-only. Third file found carrying that line
  (188 was the first). Fixed with the detection block `migrate.sh`
  already uses; suite re-run green afterwards.
- My own: the refusal toast read *"Nothing was sent — Nothing was sent.
  Dish 2…"*. Seen in a browser, not in a test. The title now names the
  table, which is what a waiter with three tables needs.

**Proved** — opened in a browser, not typechecked
```
db/tests/run.sh    483 assertions        vitest (root)   163 passed
npm run build:all  3 clean builds        tsc -b          0 errors
api npm test       257 passed · 19 files · 0 failed
```
Walked end to end in a browser against the live local API:
- pad opens over the floor · **zero API requests from three dish taps**,
  and **no `/till/menu` fetch at all** — it came from IndexedDB
- running total ₹480 for 40+260+180; the bill came back ₹504, which is
  the 5% tax the pad says it excludes
- draft survived a full page reload; floor showed "not sent"
- **one POST** for the round · "Kitchen docket 6"
- refused → **pad stayed open with both dishes**, table named
- offline → *"AC1 is held. The kitchen does not have it yet."* No docket
  number claimed. Outbox banner appeared, drained on reconnect, ₹504 →
  ₹546.

Guard proved in both directions: `unitPriceOf` broken to drop sides →
*"the sides were not added to the dish's price: expected 300 to be 350"*.

**Left open**
- **Stage C2 next.** C2, C3 and C5 all wait on the same missing
  preparation-time column.
- `till-rooms` is not cached, so **room-charging from the pad is not
  possible offline**. Owner's decision, deliberately not taken here.
- Two waiters opening the *first* order on one table while both offline
  still makes two bills. Rare, visible on the floor in seconds, and
  merging is an existing till action.
- Test orders sit on AC1 and AC2 in the **local** dev database.

**Commits:** not yet committed — in the working tree.

---

## 2026-09-08 · Deploy to production, then Stage C

**Asked for:** get the system live on Oracle and Firebase for beta testing;
then make the floor faster — a waiter should take an order at the table
without walking to the till, and dishes should not each hit the server.

**Shipped**
- **The system is live.** `https://pms.fidatohotels.com` (Firebase) and
  `https://api.fidatohotels.com` (Oracle Linux, Mumbai). All twelve preflight
  checks pass. Akkalkot's 18 rooms, menu, rates and staff moved from the
  development machine.
- `deploy/launch.sh` — `SKIP_TLS=1`, EPEL enabled by name, SELinux
  `httpd_can_network_connect`, a read-only admin database role, an upload
  directory outside the checkout
- `db/backup.sh --portable` — a plain-SQL dump an older PostgreSQL can read
- `db/restore.sh`, `db/migrate.sh` — no longer Windows-only; `BACKUP_DIR`
- `.env.production` — keeps the development sign-in shortcut out of the build
- **The till: one round trip per dish instead of three.** `src/pages/Till.tsx`
  writes the server's own reply into the cache instead of refetching what it
  was just handed. Measured 78ms tap-to-screen.
- **The live channel is debounced** (350ms, trailing) — it was firing four
  invalidations per row change, so the till got slower the faster a waiter
  worked.
- **`POST /till/orders/batch`** — a whole order in one request: opens it, adds
  every dish, fires one kitchen docket. Six dishes in 289ms. All-or-nothing:
  a refused dish rolls the entire order back.
- `addOneLine()` extracted from the single-add route (205 lines of pricing,
  variations, add-ons, line merging) so the batch endpoint calls it rather
  than copying it.

**Found** — defects 187–194, all fixed
- **187** every shell script stored non-executable; the documented deploy
  command could never run from a clean clone
- **188** `restore.sh` hardcoded `.exe` paths — it could not run on the server
  it exists for
- **189** the restore's safety copy had nowhere to write, so it refused
- **190** a dump from PostgreSQL 17 cannot be read by 16
- **191** **502 while every part was healthy** — SELinux forbids nginx from
  opening a network connection. Only visible from outside the machine.
- **192** the preflight had never once been able to run on a server: peer
  authentication means only the `postgres` account can be `postgres`
- **193** the development sign-in shortcut shipped to the live login page
- **194** the till cost three round trips per dish

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    254
db/tests/rerun.sh  78 of 78 re-runnable  vitest          163
npm run build:all  3 clean builds
```
Guards proved in both directions by reintroducing the bug: the batch rollback
(*"a half-written order survived the refusal"*), the role-list drift, the
no-show room release, the moved-guest double charge, the live channel.

**Left open**
- **The order pad itself is not built.** The server half is done; the floor
  panel, local dish-building and Send are not. See "Where Stage C stands".
- ~~**One decision needed from the owner:** whether the pad shows a running
  total before the order is sent.~~ **DECIDED 8 Sep:** the pad shows it, and
  it is the pad's own arithmetic — menu prices summed in the browser. The
  owner's reasoning: the waiter needs to answer "how much is that?" at the
  table, and the sum is simple. It is labelled as the dishes' cost, not the
  bill; tax and rounding still come only from the server.
  **This puts a pricing rule in two places, which is this codebase's most
  common defect shape.** The plan carries a guard for it — a test asserting
  the pad's sum equals the server's line total for the same input, proved by
  breaking the pad's arithmetic on purpose. Do not build the pad without it.
- **The `api` domain still has a stray AAAA record** pointing at a web host
  that is not the server. The certificate was issued anyway (Let's Encrypt
  fell back to IPv4), but renewal in December runs the same check.
- **Backups are on the same disk as the database.** The nightly dump works and
  is verified; it dies with the machine. Oracle Object Storage is free in the
  same account.
- **The server runs PostgreSQL 16; every test runs on 17.6.** All 78
  migrations applied cleanly on 16, which is real evidence, but it is not the
  same as having run the suite there.

**Commits:** `184769f … c84feb9` (23 commits)

---

## Before 2026-09-08

Not recorded here — this file did not exist. `git log` and `PROGRESS.md` are
the record for everything up to commit `6c8f7d3`, and `MEMORY.md` carries
defects 1–186.
