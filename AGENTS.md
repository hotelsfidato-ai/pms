# Agents — how to divide this work without destroying it

Two agents wrote `src/data/` simultaneously for two hours on 27 August. It
destroyed a day's work and was unrecoverable. This file exists so it does not
happen twice.

**Start with the top section of `HANDOVER.md`** — it is the current brief:
where things stand, what to do next, the owner's decisions and rules. Then
`MEMORY.md`. Every line in it cost something.

---

## Before your first write — five minutes that save a day

**Read in this order.** All four are short except one, and that one is the
useful one.

| | |
|---|---|
| `HANDOVER.md` | **the top section only** — the current state, what is next, and the rules. Kept current; everything under "Archive" is history |
| `CONTEXT.md` | what this system is, and who it is for |
| `MEMORY.md` | **272 numbered defects** (and each service's own, since 15 September). Not history — the mistakes this codebase has already made. About a third were made *twice* before being written down. |
| `CHANGELOG.md` | what the last agent did, and what they left in flight |
| `START-HERE.md` | how to run it, and where everything lives |

**Then write your own `CHANGELOG.md` entry as you work**, not at the end from
memory. The next agent's first question is always *what was in flight?* and
only you can answer it.

### The four habits that catch the most here

1. **Open the screen before saying it works.** Most defects in `MEMORY.md`
   were found by using the system, not by a gate. The gates are necessary and
   they are not sufficient.
2. **A guard is not a guard until it has refused something.** Add the test,
   then break the code and watch it fail. Eleven guards in this project passed
   with the bug reintroduced.
3. **Ask how many copies there are, not whether two agree.** The commonest
   fault here is one rule written in two places. Twice this month, fixing two
   copies left a third.
4. **Run the numbers you quote.** "254 tests pass" is a claim until you have
   run them in the session you are claiming it.

### What the gates cannot see

Every gate in this repository runs on the machine the code was written on.
**Eight faults were found in one afternoon of deploying** — missing executable
bits, Windows-only paths, a disabled package repository, SELinux, a dump an
older PostgreSQL could not read — and 483 database assertions, 254 API tests
and three clean builds passed throughout. If you touch `deploy/`, `db/*.sh` or
anything a server runs, read defects 187–193 first.

---

## Before that: nothing is decided without the owner

16 September, in their words: *"if u have any dought u need to ask me and you
are not allowed to take decisions unless they are approved"*. If a choice
changes what gets built, what a person sees, what a figure means or what
ships, it is the owner's. Ask it as a question with your recommendation, and
wait for the answer. Do the parts that need no decision meanwhile. A plan you
wrote is not approval; neither is silence.

## The rule that matters most

**One agent owns one service at a time. Never two agents in one service, and
never two agents in one folder on disk.**

Since 15 September the code is sorted by service (`docs/SERVICE-FOLDERS-PLAN.md`):
front desk, reservations, housekeeping, inventory and rates, guests and
companies, finance, night audit, the restaurant (`pos`), banquet, store,
reports, administration — plus eighteen not built yet, each with a Coming
soon page since 16 September: the channel manager, `crs`, `payments`,
`booking-engine`, `guest-messaging`, `accounting`, and `leads`, `marketing`,
`crm`, `spa`, `online-checkin`, `laundry`, `contracts`, `revenue-management`,
`reputation`, `loyalty`, `guest-services`, `equipment`. A service is one word,
and it lives in three places:

```
src/modules/<service>/          its screens, menu entries, addresses, data, tests
api/src/modules/<service>/      its server routes, and its front door index.ts
db/tests/modules/<service>.sql  its database checks (suite.sql is frozen history)
```

**Read `src/modules/<service>/MODULE.md` before your first edit.** It is the
service's brief: its screens, endpoints and tables, the owner's decisions that
bind it, its open items, and requests from other services.

**Then read `src/modules/<service>/DEFECTS.md`** — every defect found in that
service, what was done about the fixed ones, and the fix waiting for the open
ones. It exists so a solved problem is not solved twice and a known trap is not
walked into again; `src/test/boundaries.test.ts` fails if a service loses it.
A new defect goes there, numbered with the service's prefix; a lesson that
would bite another service goes in the root `MEMORY.md` with a plain number.

**Building a service that is still Coming soon?** Only after the owner has
said which. Its `MODULE.md` has a "When it is built" list: replace
`pages/<Name>.tsx` with the real screens at their real addresses, move the
menu entry out of the Coming soon section into its working section (and
update the Coming soon list pinned in `navigation.test.ts`), and add a
module switch if not every hotel has it.

Claim the service in **`.claims/<service>.md`** before your first write, and
delete that file when you stop. One file per service, so two agents claiming
two services never write the same file — the register of who owns what used to
live in a table inside `HANDOVER.md`, which made it the very thing they
collided over. `.claims/README.md` has the two commands.

**Read the other claim files first.** If the service you want already has one,
**stop and say so** rather than writing into it. Waiting costs minutes;
colliding costs a day.

Before you commit, in your own copy:

```powershell
# the owner's PC, PowerShell, in YOUR working copy
npm run lane -- pos
```

It sorts everything this session has changed into **yours · nobody's · the
shared core · another service's**, and exits 2 if anything is outside your
lane. It refuses nothing and blocks nothing; what it gives you is the sentence
you owe the owner before a commit that reaches past your service.

### What "owning a service" lets you touch

- Everything inside your service's three places.
- A new migration — only after claiming its number in HANDOVER. The guard
  `src/test/migrationNumbers.test.ts` fails on a duplicate or a gap.
- **Nothing in another service.** You use another service only through its
  front door, `index.ts`; the guard `src/test/boundaries.test.ts` fails on any
  reach into its insides. If you need a change there, write it on that service's
  "Requests" list in its `MODULE.md` and tell the owner — its owner makes it.
- **Nothing in the shared core** (below) without saying so first.

### Your notes

Each service keeps its own `CHANGELOG.md` and `DEFECTS.md`. A defect in your
service is numbered with its prefix (FD-1, POS-1, FIN-1 …, listed in its
`MEMORY.md`). A lesson that applies to the whole project goes in the root
`MEMORY.md` with the next plain number. Work that is project-wide goes in the
root `CHANGELOG.md`.

---

## Before your first write — your own copy, database and ports

Several agents run at once, so each gets its own working copy. **Never work in
`D:\fidato pms` itself while another agent is running.**

```powershell
# the owner's PC, PowerShell, in D:\fidato pms — a copy on its own branch
git worktree add "..\fidato-pos" -b pos/<task>
```

```powershell
# the owner's PC, PowerShell — share the installed packages instead of installing
New-Item -ItemType Junction -Path "D:\fidato-pos\node_modules" -Target "D:\fidato pms\node_modules"
New-Item -ItemType Junction -Path "D:\fidato-pos\api\node_modules" -Target "D:\fidato pms\api\node_modules"
```

- **Your own database.** `DB=fidato_pos ./db/migrate.sh --with-dev-identities`
  (Git Bash, in your copy) creates and migrates `fidato_pos`; it starts with no
  demo data (`api/scripts/load-demo.ts` loads it — read its header). Never
  point two agents at one database.
- **Your own ports.** Run the API with `PORT` set to a free port and your
  database in `DATABASE_URL`; give the web app `VITE_API_URL` for that port and
  `VITE_ALLOW_DEV_AUTH=1` in your copy's `.env.local` (git ignores it). Vite
  finds a free port by itself.
- **Your copy's `api/.env`** holds only development settings — `NODE_ENV=development`
  and `ALLOW_DEV_AUTH=1`. **Never copy the main checkout's `api/.env`** — it
  carries the production Firebase key.
- **The website's tests need the root `.env`** (the website's own settings:
  its public Firebase web config and the local sign-in switch). Copy the main
  checkout's root `.env` into your copy — without it 31 web tests fail on the
  sign-in screen. It is gitignored; never commit it.
- **Type checks: use `npx tsc -b --force`.** The linked `node_modules` shares
  the type checker's cache between copies, so a plain `tsc -b` can report
  another copy's "clean".
- **Judge every gate by its exit code**, not its summary line (MEMORY 274).
- The API tests need no setup beyond that: `cd api && npm test` builds and drops
  its own scratch database every run.

Commit on your branch at every checkpoint. **You do not merge.** When you are
done, the agent that owns the core merges services into the main line one at a
time and runs every gate after each. Deploys stay the owner's.

**Start with three agents at once, not seven.** Every agent asks the owner
before any doubt, and three is what one person can keep up with.

---

## The lanes of CP6 — closed, for history

The four lanes that built the first screens (reports, admin, guests/companies,
the remaining property screens) closed during CP6. Their files have since moved
into the service folders; each service's `MODULE.md` says where everything is
now.

---

## Where the next work is

**`HANDOVER.md` § 3, in order.** Items marked "ask first" there need the
owner's answer before any code.

---

## Shared, and therefore frozen — the core

**Nobody edits these without saying so first**, because every service stands on
them. One agent owns the core at a time.

```
src/components/ui/          the design system · ported from the CRS
src/components/app/         the shell: sidebar, top bar, Find a screen, Start here,
                            and navigation.ts — the SECTION LAYOUT only; each
                            service declares its own entries in its nav.ts
src/App.tsx                 routes that belong to no service; services' come
                            from their own routes.tsx
src/data/repositories/      the core data: types, the business date, rooms,
                            properties, notifications, http.ts and result.ts helpers
src/data/store.ts, src/data/fixtures/, src/lib/
api/src/server.ts, mount.ts, auth.ts, db.ts, env.ts, identity.ts, realtime.ts,
storage.ts, businessDate.ts, and the core routers in api/src/routes/
db/migrations/              ONE ordered history for everybody — claim a number
```

A service adding a screen, a menu entry or a route **edits none of these**: its
`nav.ts`, `routes.tsx` and `api/src/modules/<service>/index.ts` are its own.

---

## Reusable pieces — check before you build

Someone already built these. Rebuilding one is drift.

Addresses re-checked 16 September: the service-folder move (15 September) took
every one of these out of `src/components/`, and this list still pointed at the
old places.

```
src/modules/front-desk/components/StayTable.tsx
                                     configurable stay list — columns, filter,
                                     search, row → panel. Five screens use it:
                                     arrivals, in-house, reservations, walk-ins,
                                     folios. It also has its OWN card view
                                     (StayCards) — a phone gets that, not the
                                     generic DataTable card. Read its header.
src/modules/front-desk/flows/CheckInFlow.tsx
                                     five-step check-in, gates on clean rooms
src/modules/finance/flows/FolioPanel.tsx
                                     ledger, charge, reverse, settle, check out
src/modules/front-desk/flows/WalkInFlow.tsx
                                     one-action walk-in with rate override
src/components/ui/                   17 files of primitives, one import surface
                                     (`@/components/ui`) — every one on
                                     /design-system
src/modules/reports/components/ReportShell.tsx
                                     report chrome, print styling, and Amount —
                                     which prints a dash for null, never a zero
```

**Reaching into another service to use one of these is what
`src/test/boundaries.test.ts` refuses.** Import it through that service's front
door, `src/modules/<service>/index.ts`; if what you need is not exported there,
that is a request for its owner, not an edit you make.

The seam already exposes ~68 functions. `listArrivals`, `listOpenFolios`,
`getPeriodStatistics`, `getFolioPostings` and the rest are written and tested.

---

## The ten rules, and which ones bite

Full list in `MASTER.md` §2. In practice these four cause the failures:

**Rule 2 — screens import only from `@/data/repositories`.** Enforced by a test
that walks `src/`. Do not work around it.

**Rule 5 — `hotelId` in every query key.** `queryKeys` in the seam index builds
them so a screen cannot forget. Use it.

**Rule 6 — a blocked action is shown disabled with its reason, never hidden.**
The rules return `{ allowed, reason }`. The same function that disables the
button refuses the write.

**Rule 8 — never claim unrun code works.** Three defects have passed `tsc`, the
tests and the build while the page was broken. See `MEMORY.md`.

---

## Definition of done, per screen

```
Screen           route and file
Reads            which repository functions — must be @/data/repositories
Rules            which src/lib/rules.ts functions gate which controls
What I saw       what you observed in the browser, not what the commands printed
States           empty · loading · error, all three, with different words
Library touched  MUST be "none"
```

**Open every screen you build.** Not the tests — the screen.

Gates, all three, pasted real:

```bash
npx tsc -b        # must produce no output at all
npx vitest run    # all passing
npm run build     # clean
```

---

## If you find a defect in a ported file

`src/components/ui/` runs in production in the CRS. A genuine failure there is a
**CRS bug too**.

**Report it, name the file and line, and stop.** Fixing it in one tree and not
the other is exactly the drift the port was meant to prevent — found later by a
stakeholder rather than by a test.

Two are already open and unfixed for this reason: `Checkbox`/`Switch` have no
accessible name, and nothing uses `focus-visible:`. Both are live in the CRS
today. See `MEMORY.md`.

---

## When something is unspecified

**An honest placeholder naming what a screen will carry is a correct answer. An
invented flow is not.**

The same goes for data. Six of the seven properties have no confirmed name or
room count — `Property Two · awaiting confirmation` is right; inventing
"Hotel Hill Top" is not. The one number that must never appear anywhere is the
unverified 175-room group total.

---

## Handover format

When you finish or stop, update `HANDOVER.md` with:

```
Lane            which one, which branch
Done            screens completed, verified in a browser
In progress     what is half-built, and where exactly you stopped
Blocked         what you could not do and why
Released        folders you are no longer holding
Gates           tsc / tests / build, pasted
```

Release your claim in the same edit. A folder still marked claimed by an agent
that has stopped is worse than one nobody claimed.
