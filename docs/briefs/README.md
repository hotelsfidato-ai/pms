# Service briefs — one chat per service

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


**The owner runs several chats at once, one per service. This folder is what
each of them starts from.** Every brief is written so a chat that has never
seen this project can read its own file, claim its service, and work without
ever opening a file another chat is in.

**This chat — the one in `D:\fidato pms` — is the MASTER.** It owns the shared
core, the root papers, the database migrations, and anything that crosses two
services. The lanes report to it; it merges.

---

## The codes — what to paste into each new chat

One line each. The brief carries the rest.

| Chat | Paste this |
|---|---|
| **Front desk** | `You are the front-desk agent for Fidato PMS. Read docs/briefs/front-desk.md and follow it exactly. Claim the service before your first write.` |
| **Reservations** | `You are the reservations agent for Fidato PMS. Read docs/briefs/reservations.md and follow it exactly. Claim the service before your first write.` |
| **Inventory** | `You are the inventory agent for Fidato PMS. Read docs/briefs/inventory.md and follow it exactly. Claim the service before your first write.` |
| **POS** | `You are the pos agent for Fidato PMS. Read docs/briefs/pos.md and follow it exactly. Claim the service before your first write.` |
| **Housekeeping** | `You are the housekeeping agent for Fidato PMS. Read docs/briefs/housekeeping.md and follow it exactly. Claim the service before your first write.` |
| **Finance** | `You are the finance agent for Fidato PMS. Read docs/briefs/finance.md and follow it exactly. Claim the service before your first write.` |
| **Reports** | `You are the reports agent for Fidato PMS. Read docs/briefs/reports.md and follow it exactly. Claim the service before your first write.` |
| **Night audit** | `You are the night-audit agent for Fidato PMS. Read docs/briefs/night-audit.md and follow it exactly. Claim the service before your first write.` |
| **Guests** | `You are the guests agent for Fidato PMS. Read docs/briefs/guests.md and follow it exactly. Claim the service before your first write.` |
| **Banquet** | `You are the banquet agent for Fidato PMS. Read docs/briefs/banquet.md and follow it exactly. Claim the service before your first write.` |
| **Store** | `You are the stores agent for Fidato PMS. Read docs/briefs/stores.md and follow it exactly. Claim the service before your first write.` |
| **Equipment** | `You are the equipment agent for Fidato PMS. Read docs/briefs/equipment.md and follow it exactly. Claim the service before your first write.` |
| **Administration** | `You are the admin agent for Fidato PMS. Read docs/briefs/admin.md and follow it exactly. Claim the service before your first write.` |

**Start three, not twelve.** Every agent asks the owner before any doubt, and
three is what one person can answer for. The order that wastes least: **front
desk → inventory → pos**, because those three hold the most open work.

**Two to be careful with:** **night audit** posts real charges and moves the
business date, so its brief starts read-only; **admin** decides who may sign in
and what they may do, so every change to a role waits on the owner. **Store** and
**Equipment** are phases 1A and 1B of `docs/STOCK-AND-EQUIPMENT-PLAN.md`, run
together; the Store's first task is STO-1, still open. The role that runs both
is the **Inventory Manager** (the `stores` key, renamed 16 September).

### Services that are still Coming soon

**These chats do not build anything.** Each is blocked on a fact only the owner
holds, and the most useful thing an agent can produce is the short list of
decisions that would unblock it, each with a recommendation. The briefs say so
in their first paragraph, and `coming-soon.md` explains why.

| Chat | Paste this |
|---|---|
| **Channel manager** | `You are the channel-manager agent for Fidato PMS. Read docs/briefs/channel-manager.md and follow it exactly. This service is not built: do not build it.` |
| **CRS connection** | `You are the crs agent for Fidato PMS. Read docs/briefs/crs.md and follow it exactly. This service is not built: do not build it.` |
| **Leads and WhatsApp** | `You are the leads agent for Fidato PMS. Read docs/briefs/leads.md and follow it exactly. This service is not built: do not build it.` |
| **Central CRM** | `You are the crm agent for Fidato PMS. Read docs/briefs/crm.md and follow it exactly. This service is not built: do not build it.` |
| **Any of the other fifteen** | `You are the <service> agent for Fidato PMS. Read docs/briefs/coming-soon.md and src/modules/<service>/MODULE.md, and follow them exactly. This service is not built: do not build it. Produce the decisions the owner must make, each with a recommendation, and stop there.` |

The fifteen: `payments` `booking-engine` `online-checkin` `revenue-management`
`accounting` `contracts` `guest-messaging` `guest-services` `laundry` `spa`
`purchasing` `room-systems` `loyalty` `marketing` `reputation`. (`equipment` left
this list on 16 September: it is phase 1B, with its own brief. `purchasing` is
phase 2C, and `room-systems` holds the door locks and phones.) **`coming-soon.md` has a table
of what blocks each one** — read it before choosing which to staff; three of
them are not worth an agent until the owner says they are wanted at all.

---

## The long dash — every chat, from 17 September (D17-48, D17-59, D17-60)

**No long dash "—" in anything a person reads.** Inside a sentence use a spaced
hyphen " - "; a figure nobody has set shows "-" (never a zero). **Clean your own
folder as part of your next job** — screens, dialogs, toasts, error sentences, and
the tests that assert them. Code comments may keep theirs; a date range's short
"–" stays. The master does the shared core and every service no chat is working on.

---

## Nothing new is hard-wired to Fidato — every chat, from 21 September (D21-27)

The owner will sell the whole system, **one separate copy per buying group**
(D21-1, D21-12). So nothing you add may name Fidato in code: not the group's
name, a logo, `fidatohotels.com`, a WhatsApp number or account, a GSTIN. Read it
from the property's or the group's settings, or from the server's environment.
What is already hard-wired is being listed by the master and is not yours to
clean; just add nothing to it. Tests and demo data may say Fidato.

---

## Every screen follows `DESIGN.md` — every chat, from 23 September (D22-12)

Before you change anything a person sees, read `DESIGN.md` at the root: the
colours are tokens in `src/styles/theme.css` (never a hex in a class), small
text takes a colour's readable step, and its Named Rules (Level, Figure, No
Dead Space, Data, Breathing Room, Rhythm, Type Ladder) are the owner's. Reuse
`src/components/ui/`; a new look for a whole screen is the owner's call, not
yours.

---

## The five rules every lane obeys

These are not this folder's rules. They are the project's, from `HANDOVER.md`
§ 5, and a lane that breaks one has done damage no gate catches.

1. **No decision without the owner's approval.** Their words, 16 September:
   *"if u have any dought u need to ask me and you are not allowed to take
   decisions unless they are approved"*. Ask with a recommendation, and wait.
   Silence is not approval; a plan you wrote is not approval.
   - **Ask the OWNER** when the answer changes what a person sees, what a
     figure means, what staff may do, or what ships.
   - **Ask the MASTER chat** when the answer is technical and shared — a change
     to the design system, a migration number, a repository signature.
2. **No default prices.** A figure nobody has set is a **dash**, never a zero.
   Never invent a number, and never show one the database has not agreed to.
3. **Open the screen before saying it works.** Run the gates you quote, and
   judge them by their exit code.
4. **Every mistake goes in writing** — in your service's `DEFECTS.md`, numbered
   with its prefix. A lesson for the whole project goes to the master chat for
   the root `MEMORY.md`.
5. **Never commit, print or echo `api/.env`.** It carries the production
   Firebase key. Never copy the main checkout's copy into a worktree.

---

## Before your first write — your own copy

**Two agents editing `D:\fidato pms` at the same time will overwrite each
other.** Every lane gets its own working copy — **inside the project, in
`.claude\worktrees\`** (D22-1, 22 September: nothing about the PMS lives
outside `D:\fidato pms`). The owner gives orders in one main chat; lanes are
helper agents it sends, and they report back to it.

```powershell
# the owner's PC, PowerShell, in D:\fidato pms — a copy on its own branch
git worktree add ".claude\worktrees\pos" -b pos/<task>
```

```powershell
# the owner's PC, PowerShell — share the packages instead of installing again
New-Item -ItemType Junction -Path "D:\fidato pms\.claude\worktrees\pos\node_modules" -Target "D:\fidato pms\node_modules"
New-Item -ItemType Junction -Path "D:\fidato pms\.claude\worktrees\pos\api\node_modules" -Target "D:\fidato pms\api\node_modules"
```

A helper started by the app with its own worktree gets a copy in
`.claude\worktrees\` already; it still needs the two junctions, its own
database and its own ports. **When its branch is merged, the copy goes** —
junctions first, then the Recycle Bin, then `git worktree prune`.

The gates: `bash scripts/gates.sh <label>` in the copy being checked (Git
Bash). Its logs go to that copy's `.local\gates\`.

- **Your own database:** `DB=fidato_pos ./db/migrate.sh --with-dev-identities`
  (Git Bash, in your copy). Never point two chats at one database.

  ⚠ **A fresh one comes up with no people in it, and the next two things fail
  without naming the cause.** `--with-dev-identities` says *"expected 3 staff
  with dev uids, found 0. Has 008_seed.sql changed the demo emails?"* — it has
  not: `008` seeds only the placeholder administrator, and the three demo staff
  come from `db/tests/suite.sql`, which a real database never runs. Then
  `npm run demo` dies on *"Cannot read properties of undefined (reading 'id')"*,
  because `load-demo.ts` looks up `owner@fidato.in` for the POS outlet and finds
  nobody — and it rolls back, so `hotels` is still 0 and it reads as if nothing
  ran at all. Put the three in first:

  ```sql
  insert into staff (email, full_name, is_group_admin) values
    ('owner@fidato.in','Group Owner', true),
    ('agra@fidato.in','Agra Clerk',  false),
    ('pune@fidato.in','Pune Clerk',  false)
  on conflict (email) do nothing;
  ```

  then `cd api && npm run demo`, then `psql … -f db/dev/dev-identities.sql` and
  `-f db/dev/dev-testers.sql` — the second adds a sign-in per role at 5EL, which
  the sign-in screen's development buttons use.
- **Your own ports:** `PORT` for the API, `VITE_API_URL` and
  `VITE_ALLOW_DEV_AUTH=1` in your copy's `.env.local`. Vite finds its own port.
  ⚠ **Pick the API port from `npm run claims`, not from memory** (21
  September: the POS and CRM chats both ran on 8797, root MEMORY 314). Every
  claim names its port; take one no live claim names, and write it in yours.
  The master's copy is **8787**. Taken today: **8793** online check-in, **8797**
  CRM. A new chat starts at **8800** and counts up.
- **Copy the ROOT `.env`** from the main checkout (the website's public
  settings) or 31 web tests fail on the sign-in screen. **Never the
  `api/.env`.**
- **Type checks:** `npx tsc -b --force` — the shared `node_modules` caches
  another copy's "clean" otherwise.

---

## Claim it, and say so

```powershell
# in YOUR copy's folder, before your first write
npm run claim -- pos "Fixing the two raw dates and POS-4"
```

**Claims live in the git folder every copy shares**, so every chat and the master
see the same list — `npm run claims` prints it. If your service is already held
by another branch, `claim` refuses and names who holds it: **stop and tell the
owner.** Release it when you finish: `npm run release -- pos`.

(Until 16 September this said to write `.claims\pos.md`. A file written inside
your copy is visible only in your copy, so no other chat could ever see it. If
your copy is older than that and has no `npm run claim`, run the same thing as
`node "D:\fidato pms\scripts\claim.mjs" claim pos "what you are doing"`.)

Before every commit:

```powershell
npm run lane -- pos
```

It sorts what you changed into **yours · nobody's · the shared core · somebody
else's**, exits 2 if you have strayed, and lists who else holds a claim. It
blocks nothing — it gives you the sentence you owe the owner.

---

## What NOBODY but the master may change

Every service stands on these. A lane that edits one breaks the other five, and
the break usually shows up in somebody else's chat as a mystery.

```
src/components/ui/           the design system — Button, Input, Card, DataTable,
                             StatusPill, States, Menu, Overlays, PageHeader…
src/styles/theme.css         the colour tokens and the type scale
src/components/app/          the shell: sidebar, top bar, Find a screen, and
                             navigation.ts (the SECTION LAYOUT — your own menu
                             entries go in YOUR nav.ts)
src/App.tsx, src/main.tsx    routes that belong to no service
src/lib/                     format.ts, permissions.ts, offline.ts, session.ts,
                             ui.ts, rules.ts, api.ts
src/data/repositories/       the core seam: types, the business date, rooms,
                             properties, notifications, http.ts, result.ts
src/test/                    the guards: boundaries, navigation, migrations
api/src/server.ts · mount.ts · auth.ts · db.ts · env.ts · identity.ts ·
  realtime.ts · storage.ts · businessDate.ts · routes/
db/migrations/               ONE sequence for everybody, replayed from 001 on
                             every deploy
HANDOVER.md · CHANGELOG.md · MEMORY.md · PENDING.md · AGENTS.md · CLAUDE.md
```

**Three traps in particular**, because they look like they belong to one
service and do not:

- **`src/components/ui/StatusPill.tsx`** — the tones every service colours its
  states with. Front desk and reservations already disagree through it
  (`checked_in` blue, `in-house` green). Changing a tone changes five screens.
- **`src/lib/format.ts`** — `money`, `dateShort`, `dateLong`, `percent`. Five
  services print dates five ways *because* they went around this file. Use it;
  do not add a sixth local formatter.
- **`db/migrations/`** — `src/test/migrationNumbers.test.ts` refuses a
  duplicate **and a gap**, so numbers cannot be reserved in blocks and two
  lanes cannot both take "the next one" and merge cleanly. **Take the next
  number after cp6's highest when you write the file, refer to it by what it
  does rather than its number, and tell the master** — if two lanes took the
  same one, the master renumbers the second at merge (16 September).

**If you need a change in one of these:** write it as a request in your
service's `MODULE.md` under "Requests", and tell the owner. The master makes
it once, for everybody.

**If you need something from another service:** use its front door —
`src/modules/<service>/index.ts`. If what you need is not exported there, that
is a request for its owner, not an edit you make.
`src/test/boundaries.test.ts` fails on any reach past a front door.

---

## The gates, and what each one is

**Since 18 September every one of these also runs in GitHub, on Linux, on every
push** (`.github/workflows/ci.yml`) — against a real Postgres 17, with the
website suite, the API suite, the database suite, the replay, the type checks,
the stripping check and the build. A push that goes red is a push everybody can
see, and the first three runs found four faults that had been invisible here:
the API suite could not run at all without a private `api/.env`, fifty website
tests needed one developer's Firebase values, the migration replay failed on a
fresh cluster, and a banquet time was being stored in the server's time zone
rather than the property's (root `MEMORY.md` 293, 297).

So what a chat runs locally has changed shape: run them to find out quickly,
not to prove it. **The proof is the Action.**

**And a push now refuses by itself** if it touches another service's folder
(`.githooks/pre-push`, installed by `npm install`). `git push --no-verify` is
the way past it when the owner has said so — tell them when you use it.

Run these in your own copy before you say anything works.

```powershell
npx tsc -b --force              # types, the whole project
npx vitest run                  # the web suite — 212 today
cd api; npm test                # the API suite, its own scratch database
bash db/tests/run.sh            # the database suite — 622 assertions today
npm run build                   # and it must say "no test sign-in in dist"
```

**`npm test` in `api/`, never `npx vitest run` there** — that points 359 tests
at the development database and writes into it (root `MEMORY.md` 277).

---

## When you finish

1. Your service's `CHANGELOG.md` — what you did, what you measured, what you
   found. **Not the root one; that is the master's.**
2. Your service's `DEFECTS.md` — anything you found and did not fix, and
   anything you fixed, so nobody works it out twice.
3. Your `MODULE.md` — if a screen, a route or a menu entry changed.
4. `npm run release -- <service>`. **Never commit a claim** — two did on 16 September and had to be taken out of the merge.
5. `npm run lane -- <service>` one last time, and tell the owner what it said.
   The pre-push hook runs it for you and refuses a push outside your lane, but
   reading it yourself is how you find out BEFORE you have written ten files.
6. **You do not merge, and you do not deploy.** Commit on your branch and hand
   back. The master merges one service at a time and runs every gate after
   each.
