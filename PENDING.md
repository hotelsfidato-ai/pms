# What is left

Written 9 September 2026, at the end of phase 2; brought up to date by
the audit of 14 September. This file is the answer
to "what is pending" — it replaces asking, and it is meant to be edited
rather than appended to.

Anything **decided against** is here too, with the reason. A gap nobody
recorded a decision about is a gap somebody rediscovers and re-argues.

---

## 1 · What is live — measured on the box, 14 September 2026

Phase 2 is deployed. The server runs `1f77239`; the frontend is current.

```
fidato-api, nginx, postgresql       active
n8n                                 active, 127.0.0.1:5678 only (local mode)
certbot-renew.timer                 active — dry run passed 14 Sep;
                                    api cert expires 7 Dec 2026
PMS backups                         nightly, 10–14 Sep present
n8n backups                         nightly 03:30, data + key
disk / memory                       17 GB free / 8.7 GB available
n8n.fidatohotels.com                does not resolve yet
```

Transactions were reset on 9 September. Since then: 4 bookings, 4 guests,
5 till orders.

---

## 1a · SECURITY — found 15 September, fixed, NOT DEPLOYED — do this first

**Any hotel manager could take over the owner's login** (MEMORY 263).
"Add somebody" set the password of an account that already existed before
checking whose it was. Live in production since 9 September. Fixed in 088
(`app.require_claimable_address`, asked before Firebase is touched); proved
by API and database tests. **It is live until the owner deploys.**

Interim, needs the owner's yes: `demo@fidatohotels.com` holds the owner
role at 5EL and its password has been shared — any holder of that password
could use the hole. Deactivate it, or change its password, until the deploy.

**Checked 15 September, read-only: it was not used.** The takeover needs a
password change, and a password change resets an account's tokens. Of the
project's real accounts, the owner's last reset on 8 September — before the
hole existed — and `demo@fidatohotels.com` and `rozariojaison7@gmail.com`
only at their creation on 9 September. Nothing else was touched but the
two strays below.

---

### Two stray accounts on the live sign-in service — mine, 15 September

`owner@fidato.in` and `pune@fidato.in`, display name "Anybody", created
10:38 GMT by a test run of mine that reached production Firebase (MEMORY
264). Never signed in, linked to no staff row, so they reach nothing — but
they carry a known password. **Remove them in the Firebase console**
(Authentication → Users), or say so and they are disabled from here. The
test suite can no longer reach Firebase at all.

---

## 2 · Found in the 14 September audit

### The walk-in desk did not record a channel — defect 242, FIXED, NOT DEPLOYED

Fixed on the owner's yes, 14 September: migration 085 and the walk-in
route. The deploy back-fills FH-2609-5001 by itself — proved on the local
database, 18 demo walk-ins without a channel to 0, no commission invented,
nothing else touched. A walk-in taken on screen afterwards saved "Walk-in".

### A refusal after a write keeps the write — defect 243, one route fixed

`withSession` commits a refusal like any other return. Fixed in the walk-in
route, where a refused walk-in left a guest that can never be deleted.
**The other routes have not been checked for the same shape.**

### Every backup is on the same disk as the thing it backs up — P0

PMS dumps, n8n data and the n8n encryption key all sit on the boot volume.
One failed disk loses the hotel, the automations and every copy of both.
Off-box storage (OCI Object Storage, or copies pulled to the office) is a
decision for the owner.

### The configuration is still the demo's

```
room rates     Deluxe 3,699 · Superior 4,099     from load-demo.ts, not the hotel
menu           17 items, 20 tables               demo
companies      Agoda, Booking.com, Expedia, ...  channels filed as companies
```

Real bookings are already being taken against those rates. Either they
are the hotel's rates too, or they need replacing — only the owner knows.

### `demo@fidatohotels.com` holds the owner role at 5EL

Re-added after the reset, active, can sign in. The owner role does
everything at that property. Fine for a demo in the owner's hands; not
for a password that has been shared.

### Owner-side, not code

- Rotate the Firebase Admin key — it passed through a chat.
- Put the n8n encryption key in a password manager, off the box.
- `owner@fidato.in` is inactive but still linked to a development login.
- n8n reaches the PMS through the API as its own account — that account
  (`n8n@fidatohotels.com`, Viewer) does not exist yet. The path is proved:
  from inside the n8n container the API answers, refuses without a token,
  and Firebase accepts the web key.
- n8n.fidatohotels.com needs its DNS record. `deploy/n8n.sh` now publishes
  it with the screen locked to the owner's address and the webhook paths
  open (owner's choice, 14 September), and `allow` swaps the address when
  the broadband changes it. Proved in a throwaway nginx on the box; the
  domain path itself has never run there.

---

## 3 · Deferred by the owner, on the record

### Housekeeping never refreshes itself — defect 218

The board shows the morning as it was when the page loaded. A housekeeper
marks 204 clean on a stairwell landing and the supervisor's screen does
not change until somebody reloads.

Measured: five requests, no duplicates, all under 15 ms. **It is not
slow. It has no refresh of any kind.**

The fix is known and small: extend the Postgres `NOTIFY` trigger from
075 to housekeeping changes, and add `useLiveOrders`-style invalidation
to that screen. The live channel already reaches Floor, Kitchen and Till.

> Deferred on 8 September at the owner's instruction — *"leave this for
> now and keep this in the upcoming files."*

### Attachments — parked, needs architecture

All four uses are in scope eventually. 077 built the table. Nothing
reaches it. **Parked deliberately**, not forgotten: the storage question
(where the bytes live, who may read them, what happens to them when a
guest checks out) has not been decided, and building the screen first
would decide it by accident.

### Channel manager — excluded for now

The **foundation for it is built**: `booking_sources.channel_code` is
what a channel manager will send, unique across the group, and the
source-mix report already counts by source. Connecting one is out of
scope until the owner asks.

### Payment gateway — excluded for now

Said plainly by the owner on 8 September.

---

## 4 · Built and still unreachable

The project's signature defect. Each of these is real work nobody can
use. **They are listed rather than quietly counted as done.**

### The approvals engine — defect 222

```
076_approvals.sql        approvals, approval_rules,
                         app.request_approval(), app.decide_approval()
api/routes/approvals.ts  the queue, the decide endpoint, the rules
─────────────────────────────────────────────────────────────────────
callers of request_approval   NONE
screens showing the queue     NONE
```

`approvals.ts` opens by saying it exists *because* the engine would
otherwise be unreachable. The routes were added; the callers never were,
so the fault moved up a level instead of closing.

Phase 2 was going to wire discounts into it. **The owner replaced that
design with promotions** — a free hand up to 10%, named promotions
beyond it — which is better and is built. So the engine is still
unreachable, and its remaining kinds (`purchase`, `cash_expense`,
`stock_adjustment`) have no path either.

**Decision needed before this is worth building:** does the owner want
purchase and expense approvals at all? If not, the engine should be
deleted rather than left looking finished.

### Twelve seam functions with no caller

Listed in `KNOWN_UNREACHABLE` in
`src/data/repositories/repositories.test.ts`. All are helpers overtaken
by later screens — no capability among them since `setOutletClosed` came
off. The list can only shrink: the gate fails if an entry gains a caller
and stays.

---

## 5 · Gates that do not exist yet

### No reachability gate for API routes — the gap defect 224 names

`repositories.test.ts` fails when a function on the frontend seam has no
importer. It cannot see an **API route with no caller**, which is exactly
how four admin endpoints sat unreachable for months and how the whole
approvals engine still does.

Not built because the route table is not a static list the way
`export function` is — Hono registers them at runtime, so this needs
real work rather than a regex.

### `mayReach` fails open, and only a test stops it now

`RequireAccess` asks the navigation whether a role may reach a path.
`mayReach` returns **true** for a path the navigation does not contain,
so a guarded route whose menu entry is deleted or never written is open
to every signed-in role while still looking guarded. Defect 227.

A test in `App.test.tsx` now asserts that every `RequireAccess` path is
one the navigation knows, and it was proved to fail. **The function
itself still fails open.** Making it fail closed would break any route
whose menu entry is conditional, which is a change to make deliberately
rather than during an audit.

### No gate for a refusal written after a write — defect 243

The walk-in route refused below an insert, and the insert committed. A
static check would have to know which statements write and which `return`
is a refusal inside a `withSession` callback — real work, not a regex, the
same reason the route gate above is not built.

### No gate for `app.*` SQL functions with no caller

Same shape, one layer further down. `app.request_approval` is the live
example.

---

## 5a · The clarity plan — steps 2 to 4 (critique of 15 September)

Scored 22/40 against "a new receptionist manages their first shift without
asking". Steps 1 (one vocabulary), 2 (one primary action) and 3 (a menu per person) are done. The owner chose, 15 September:
Bill at the desk and Folio in Finance; a shorter menu still reaches
everything by search; report names stay, in sentence case.

- **Step 2 · one primary action per screen — done 15 September.** Guarded by
  `primaryAction.test.ts` (a button beside a Cancel must declare a variant)
  and the stay-panel test in `App.test.tsx`. Not covered: the full-screen POS
  terminal (`Terminal.tsx`), which draws its own touch buttons rather than
  `<Button>` — its send action is not yet marked.
- **Step 3 · the menu by person — done 15 September.** Per-role working menus
  (`HANDOVER.md` § 3.2) and "Find a screen" (Ctrl K). **Not built:** searching
  guests and bookings from the palette — it finds screens only, and says so.
  **Worth asking the owner:** the kitchen manager's list has no Store and the
  housekeeping list no Rooms — both approved as listed, both one search away.
- **Step 4 · help where the question is.** No first-run guidance and no
  glossary anywhere. A "Start here" card for a person's first sign-ins,
  one-line explanations on RevPAR, ADR, city ledger, Form C, and an empty
  state on every list.
- **Still named, not fixed:** the same chart icon on six menu entries;
  `FolioPanel.tsx` and `CheckInFlow.tsx` still hold `const USER = "front
  desk"` (MEMORY 256).

---

## 6 · Known rough edges, small

- **Two "in house" numbers.** The property page says In house now 11 /
  Vacant 9 where the Dashboard and Rooms say 10 / 7, same moment (14
  September). Two definitions, neither labelled. Needs one, named.
- **The till's reads turn every error into an empty list.** `PosGate`
  (Phase 1) catches the refusal case; a server fault still reads as
  "nothing here" (MEMORY 251).
- **The Manager Report's City Ledger section is all dashes** — it exists,
  but fills only when OTA balances are kept here. The plan's "9 of 14"
  counted it as present; it is present and empty.
- **"Which room was this stay in" is still written out by hand in seven
  queries** — billing (2), directory, reports (2), stays, pos. All seven
  have the RIGHT rule today; 086 made it `app.stay_room()` and moved the
  three that had the wrong one. Moving the seven onto the function is
  tidying, not a fix — but it is how the next wrong copy is prevented.
- **Three tables are owned by `postgres`, the other 63 by `pms_migrate`.**
  `booking_sources`, `booking_source_rates` and `pos_promotions` were
  created by the phase 2 deploy, which ran as the superuser. Harmless while
  migrations run as `postgres`; a migration run as `pms_migrate` that
  alters them will fail with "must be owner".

- **`pos_promotions` has no validity dates.** A promotion runs until
  somebody switches it off. Deliberate — dates were not asked for and
  inventing scope is how a feature stops matching what was wanted — but
  a seasonal offer will want them.
- **The source-mix report does not show commission totals yet.** The data
  is there (`reservations.commission_pct`, stamped at booking). Nothing
  sums it.
- **`hotels.address_line` duplicates city and state** in the demo data —
  the Akkalkot card reads "Akkalkot, Solapur District, Maharashtra
  413216, Akkalkot, MH". Data, not code, and now editable on
  `/properties`.
- **`api/.env` now matters more than it did.** Adding somebody creates a
  real Firebase account, so a deployment without `FIREBASE_SERVICE_ACCOUNT`
  will refuse to add staff rather than silently creating people who cannot
  sign in. The Oracle box already has the key; a new environment needs it
  before People or the property screen will work.
- **Nothing is emailed, anywhere.** There is no SMTP in this deployment,
  so a password is typed by a manager and told to the person.
  `identity.ts` keeps `passwordSetLink` for the day email invitations are
  asked for; the route that called it was removed rather than shipped
  with no caller.
- **`companies` contains channels.** "Walk-in", "Fidato Hotels" and
  "Walk-In" are rows in the corporate-accounts table, left over from
  when the booking form put the companies list in the channel box. They
  are harmless and still offered as Business source. Cleaning them up
  means checking nothing points at them first.
