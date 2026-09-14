# Start here

**You are picking up a Property Management System for Fidato Hotels, an Indian
hotel group with seven owned properties.** This file assumes you know nothing
about it and are not the agent that wrote it. Read this one first; it tells you
where everything else is.

Last updated **8 September 2026**. The system is **deployed and serving a real
property.** That is new since this file was last written, and it changes what
"done" means for everything below.

```
LIVE   https://pms.fidatohotels.com     the screens          (Firebase Hosting)
LIVE   https://api.fidatohotels.com     the data             (Oracle Linux, Mumbai)
       5 Elements Akkalkot · 18 rooms · preflight: all twelve checks pass
```

⚠ **THERE ARE NOW TWO DATABASES AND THEY ARE NOT THE SAME.** A portable
Postgres 17 on the development machine, and PostgreSQL 16 on the server. A
dump only restores *forwards*, so moving data from here to there needs
`db/backup.sh --portable`. Read defect 190 before you touch a backup.

**Everything below that describes only a laptop is now half the picture.**
Eight faults were found in one afternoon of deploying, none of which any test
in this repository could catch, because every gate runs on the machine the
code was written on. They are recorded as defects 187–193 and they are the
most useful thing in `MEMORY.md` for anybody about to touch `deploy/`.

---

## 1 · Get it running in five minutes

Three processes. All three must be up, in this order.

### Postgres

A portable Postgres 17 lives at `D:\fidato-pg` — `pgsql\` is the program,
`data\` the cluster, and the port (55432) is written in the cluster's own
`postgresql.conf`, so a plain start comes up where every script expects it.

That file also says `synchronous_commit = off`. D: is a spinning disk, and
waiting for it on every commit made the database suite crawl — one table
every ten seconds. Off, a crash can lose the last moment of work and cannot
corrupt anything. **A setting for this test machine only; never on the server.**

```powershell
D:\fidato-pg\pgsql\bin\pg_ctl.exe -D D:\fidato-pg\data -l D:\fidato-pg\pg.log start
```

⚠ **NEVER PUT IT BACK UNDER `%TEMP%`.** It lived in a Claude scratchpad under
`AppData\Local\Temp` until 14 September 2026, and Windows Storage Sense
("delete temporary files that my apps aren't using") was deleting it file by
file — oldest first, so `template0`, `template1`, `pg_dumpall.exe` and
`postgres.bki` went before anything anybody used daily. Defect 119's missing
`global/2964` was this too, blamed at the time on a bad migration run.
Everything needed to rebuild it is in `db/`: migrations and a test suite.

### Schema, tests and demo data

```bash
cd "D:\fidato pms"
export PGBIN="<...>/pgsql/bin"
bash db/tests/run.sh          # drops, migrates, tests, seeds. Must exit 0.
```

You should see:

```
✓ 21 migrations applied
✓ rls.sql — isolation proven as pms_app, not as a superuser
✓ dev identities: dev-owner, dev-agra, dev-pune
all 51 assertions passed
```

Then load the demo property:

```bash
cd "D:\fidato pms\api"
npm install        # first time only
npm run load-demo  # must print "matches the fixtures ... ✓"
```

### API and interface

```bash
cd "D:\fidato pms\api" && npm run serve   # http://localhost:8787
cd "D:\fidato pms"     && npm run dev     # http://localhost:5173 (or next free)
```

Open the interface, click **Owner** under "Development only", and you are in.

---

## 2 · What this is

```
D:\fidato pms          the React interface, the API, and the repository seam
D:\fidato pms\db       21 migrations · 51 assertions · 7 isolation checks
D:\PMS FIDATO          the ORIGINAL working directory. Now a duplicate — see below.
```

```
Staff browser ──sign in──> Firebase Auth ──ID token──> App API (api/)
                                                        │ verify token
                                                        │ SET LOCAL app.user_id
                                                        │ connects as pms_app
                                                        ▼
                                                   PostgreSQL, RLS in force
```

⚠ **`db/` came into the repository on 28 August.** It had been living outside
version control, where a machine wipe would have taken 21 migrations and three
test suites with it. **The copy inside the repo is canonical.** The one still in
`D:\PMS FIDATO\db` is stale the moment anyone edits either — delete it, or treat
it as read-only history.

**React 19 · Vite 6 · TypeScript strict · Tailwind v4 · TanStack Query · Zustand
· Hono · node-postgres · Postgres 17.**

---

## 2b · Before you write anything, and before you finish

**Read, in this order:** `CONTEXT.md`, `MEMORY.md`, `AGENTS.md`, then this.
They are short and every line in them cost somebody something.

**`MEMORY.md` is 194 numbered defects.** It is not history — it is the list of
mistakes this codebase has already made, and about a third of them were made
twice before being written down. Skimming it is the single highest-value
twenty minutes available to a new agent.

**`CHANGELOG.md` is what you must write.** Every agent records what they
changed, why, and what they proved — one entry per working session, newest
first. It exists because a commit message explains a commit and nobody reads
178 of them. Do not skip it, and do not write it at the end from memory:
write the entry as you go.

---

## 3 · The six rules that are not negotiable

Break any of these and something breaks quietly, days later.

**1 · Screens import from `@/data/repositories` and nowhere else.** Never
`@/data/fixtures`, never `@/data/store`. A test walks `src/` and fails if you
do. This rule is why five flows moved from an in-memory store onto a real
database without one screen changing.

**2 · Every repository function takes `hotelId` first.** There is one property
today. The signatures assume seven, because RLS already does.

**3 · `hotelId` goes in every TanStack Query key.** `queryKeys` in
`src/data/repositories/index.ts` builds them so a screen cannot forget. Miss it
and switching property serves the previous hotel's cache — arrivals for the
wrong city.

**4 · A blocked action is shown disabled WITH ITS REASON, never hidden.** Rules
return `{ allowed, reason }`. The same function that disables the button refuses
the write — and the server refuses it again, because a rule enforced only in
the browser is a suggestion.

**5 · The ledger is append-only.** A wrong posting is REVERSED with its own
row. Nothing is edited, nothing is deleted, and `count(*)` goes UP when
something is undone. A trigger enforces it; `pms_app` has no UPDATE or DELETE
on `folio_postings`.

**6 · Never invent a number.** Eight figures on the Manager Report print as an
em-dash because they are not derivable yet. An invented zero on a report an
accountant reads is worse than a visible gap. Six of the seven properties are
still unnamed for the same reason.

---

## 4 · How to verify anything

**Open the screen.** Fifteen defects in this project passed `tsc`, the tests and
a clean production build while the page was broken. The list is in `MEMORY.md`
and it is worth twenty minutes.

```bash
cd "D:\fidato pms"  && npx tsc -b && npx vitest run && npm run build
cd "D:\fidato pms\api" && npx tsc --noEmit && npx vitest run
cd "D:\fidato pms"  && bash db/tests/run.sh
```

All five must pass. Current state:

```
FRONTEND   tsc 0 errors · 81 tests · build clean
API        tsc 0 errors · 10 tests   (live Postgres, as pms_app)
DATABASE   21 migrations · 51 assertions · 7 isolation checks · exit 0
```

Two traps that have cost real time:

- **A stale API answers for the new one.** `tsx` without `watch` does not
  reload, and a restart that hits `EADDRINUSE` fails into the log while the OLD
  process keeps serving. `curl localhost:8787/health` reports `startedAt` —
  check it moved. `npm run serve` frees the port first.
- **A test that inserts nothing can never fail.** Assert the row count BEFORE
  asserting a refusal. This has been written twice in this codebase, by two
  different authors, in two different languages.

---

## 5 · Where things are

```
src/pages/                 36 screens
src/components/ui/         32 primitives, ported byte-for-byte from a live
                           product. DO NOT EDIT — see §7.
src/components/flows/      check-in, folio panel, walk-in
src/data/repositories/     THE SEAM. Screens talk only to this.
src/lib/rules.ts           every business rule, one home
src/lib/permissions.ts     the role matrix the nav and every button read
api/src/routes/            the HTTP surface
api/src/db.ts              withUser() — the whole tenant-isolation model
api/scripts/load-demo.ts   fixtures → Postgres, with a calibration check
```

```
docs/MASTER-ARCHITECTURE.md   architecture, hosting research, ten rules
D:\fidato pms\CONTEXT.md   the business, the property, what is NOT known
D:\fidato pms\MEMORY.md    fifteen defects that cost something. Read it.
D:\fidato pms\HANDOVER.md  detailed state, checkpoint by checkpoint
D:\fidato pms\AGENTS.md    how to divide work without two agents colliding
D:\fidato pms\AGENT-STAGE-3-4.md   the current plan, CP7–CP12
```

---

## 6 · Where the work stands

**Stage 1 (the interface) is done. Stage 4 (front desk and folio) is where you
are.**

```
1  Frontend shell and screens        ████████████  36 screens, 2 placeholders
2  Repository layer behind the seam  ██████████░░  7 of 12 modules on HTTP
3  Auth bridge — Firebase            ███████████░  works; needs a service account
4  Front desk + folio, end to end    ████████░░░░  all six flows write
5  Night audit                       ░░░░░░░░░░░░
6  Housekeeping, mobile, offline     ██████░░░░░░  board built and writing
7  POS bridge (a MIGRATION)          ░░░░░░░░░░░░
8  Billing, GST, Form C              ░░░░░░░░░░░░
9  Rates, availability, STAAH        ░░░░░░░░░░░░
10 Group dashboard and reports       ██████░░░░░░  7 of 11 reports built
11 CRS bridge                        ░░░░░░░░░░░░
12 Hardening and go-live             ░░░░░░░░░░░░
```

**Roughly 45%.** The two hardest foundations are finished and have not needed
revisiting: a verified multi-tenant schema, and a design system shared with a
product already in production.

### On Postgres

`properties · rooms · stays · folios · stayview` and **all six flows** —
check-in, walk-in, post a charge, reverse, settle, check out.

### Still on the in-memory store

`statistics · reportData · managerReport · directory · billing · admin ·
notifications`. They read the same data as Postgres — `load-demo.ts` exists to
guarantee that — so the half-swapped state is coherent, not merely tolerated.

---

## 7 · Do not do these

**Do not edit `src/components/ui/`.** Those 32 files are ported byte-for-byte
from a CRS that runs 32 properties in production. A defect there is a defect in
that product too: report it, name the file and line, and stop. Two are already
open and unfixed for exactly this reason.

**Do not commit or deploy.** The owner asked for this explicitly. Work in the
tree.

**Do not put a rule in a component.** `src/lib/rules.ts` is the one home, and
the server enforces the same rule again.

**Do not widen a Postgres grant to make an error go away.** When a permission
refuses something reasonable, it usually knows something you do not. `FOR
UPDATE` on `folio_postings` was refused because the ledger is append-only — the
answer was a unique index, not a bigger grant.

**Do not delete `isDemoProperty()` yet.** It is a transitional bridge in
`src/data/fixtures/property.ts` that lets swapped and unswapped modules agree on
which property is which. Its removal condition is written on it: delete when the
last module is on HTTP.

---

## 8 · What to do next

In order. Each is a self-contained piece.

**1 · The reports onto SQL.** `statistics`, `reportData`, `managerReport`. These
aggregate, and Postgres does that better than JavaScript. **The check is built
in:** PTD 132 of 431 room-nights, ADR ₹3,178.63, RevPAR ₹973.50, guest ledger
closing ₹59,883. If any of those move, the query is wrong, not the number.

**2 · The last four modules.** `directory`, `billing`, `admin`, `notifications`.
Then delete `isDemoProperty()` — that is its removal condition.

**3 · The business date from the database.** `BUSINESS_DATE` is a constant
(`2026-08-25`). It should be the day after the last completed run in
`night_audit_runs`, **per hotel** — two properties can legitimately sit on
different dates. `grep -rn BUSINESS_DATE src/` should end up returning only the
repository that fetches it.

**4 · Concurrency.** All 51 database assertions run serially. Nothing has
exercised two clerks booking the same room in the same millisecond, which is
what the two `EXCLUDE` constraints exist for.

**5 · Backups.** Prove a restore. A backup that has never been restored is not a
backup.

---

## 9 · Five things only a human can answer

Ask; do not guess.

1. **Where Postgres lives in production.** The recommendation on file is
   DigitalOcean managed Postgres, $15/mo — the constraint across every free tier
   is backups, not storage. Nothing ships until this is answered.
2. **A Firebase service account key.** Until one exists, nobody can sign in with
   a password. The real code path is written; only the token check is stubbed by
   `ALLOW_DEV_AUTH`, which the API refuses to start with in production.
3. **Names and room counts for six of the seven properties.**
4. **Should every clerk be able to enumerate all seven properties?**
   `hotels_read` currently says yes.
5. **The commercial question.** Under about ₹4 lakh a year for the group, buying
   eZee wins and this stops. It has not been revisited since the numbers changed.

---

## 10 · Sign in, locally

No Firebase service account is needed for development. `db/dev/dev-identities.sql`
gives the seeded staff a `firebase_uid`, and the sign-in page offers them:

```
Agra clerk    one property · front desk
Pune clerk    one property · front desk
Owner         every property · group admin
```

These use the **real** `firebase_uid` resolution path — only the token check is
skipped. `api/src/env.ts` throws at startup if `ALLOW_DEV_AUTH` is set with
`NODE_ENV=production`. A dev bypass that survives a deploy is how a stranger
signs in as the owner.

The demo property is **5 Elements Akkalkot**, code `5EL`, and the URL carries the
code: `/h/5EL/stay`.
