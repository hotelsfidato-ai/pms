# Spa — the brief

**Read `docs/briefs/README.md` first**, then this, then
`src/modules/spa/MODULE.md`. Your decisions are **D18-6, D18-7, D18-8** in
`docs/briefs/decisions-2026-09-18.md` and **D17-54** before it. The whole plan is
`docs/BUILD-PLAN-2026-09-18.md` § 2; how the chats run together is
`docs/PARALLEL-PLAN-2026-09-18.md`.

**You own** `src/modules/spa/`, `api/src/modules/spa/` (front door made and
mounted, empty — add your routers to it; **never touch `server.ts`**), and
`db/tests/modules/spa.sql`.

---

## What this service is

**Treatments, a day diary, and a bill that is settled at the spa or put on the
room** — behind a **per-hotel switch** (D17-54). Run by **reception** (D18-8);
no therapist logins, no new roles.

## The first version, and nothing more

1. **The switch is made** - the master wrote it (migration 115), so that you
   and the chat beside you never rewrite the same constraint. `spa` is a
   module name; ask `app.module_enabled(hotel, 'spa')` before every route
   answers, and hide the screens where it is off. It is on the Settings
   screen already. **Do not touch `hotel_modules_known`.**
2. **A price list of treatments** per property: name, how long, the price.
   **No default prices**: unpriced shows **"-"** and cannot be booked for money.
3. **A day diary** — who, which treatment, which therapist (a name, not an
   account), what time. One therapist is not in two places at once; the diary
   refuses the overlap and says which booking is in the way. The banquet diary
   (`src/modules/banquet/`) is the nearest thing here — read it, do not import
   it.
   - **A TIME BELONGS TO THE PROPERTY.** Write through `app.hotel_moment` and
     read through `app.hotel_clock` (migration 113). The hotel's server runs in
     GMT; a bare timestamp is BQ-8 again. The API suite runs in UTC precisely so
     this fails on your machine rather than in Akkalkot.
4. **Booked by the desk**, from a telephone call. (The guest booking it from
   their own page is D18-6's other half, and it arrives with the guest's page —
   the master will tell you when its door can carry a request.)
5. **Closing a treatment: settled at the spa, or charged to the room** (D18-6) —
   chosen when it is closed.
   - **To the room:** its own line on the bill (D18-7), through the front door
     for posting a charge — never by writing `folio_postings` yourself, never
     through the restaurant till. The Extra Charges report already has a "Spa"
     row; your charges must land in it.
   - **At the spa:** cash, card or UPI taken there. Ask the master which
     existing door records that money before you invent one — a second way of
     taking a payment is how two screens end up disagreeing about the day's
     cash.

## Not in the first version

Therapist rosters and commissions, packages and memberships, products sold at
the spa, walk-ins who are not staying (a bill with no stay behind it — ask
before building that).

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
`src/components/app/navigation.ts`, `src/components/ui/` — **the master's**.
`src/modules/laundry/` is another chat's, running beside you.

## The gates

They run **in GitHub on every push**, and a push outside your lane is refused
by the hook. Locally, to find out fast:

```powershell
npx tsc -b --force
npx vitest run src/modules/spa src/test
cd api; npm test -- modules/spa
bash db/tests/run.sh
```

**One full suite at a time on this machine** — four chats share it. **A guard
is not a guard until it has refused something.**

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- spa`;
`npm run release -- spa`. **You do not merge and you do not deploy.** Commit,
push, and send the master the head commit with your gate numbers and the guards
you saw fail.
