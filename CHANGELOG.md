# Changelog

**Every agent writes here. One entry per working session, newest first.**

This exists because a commit message explains a commit, and nobody reads 165
of them to find out what happened last week. `MEMORY.md` records *mistakes*;
this records *work*.

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
- **One decision needed from the owner:** whether the pad shows a running
  total before the order is sent. It would be the pad's own arithmetic, not
  the server's — which this system does not otherwise do.
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
