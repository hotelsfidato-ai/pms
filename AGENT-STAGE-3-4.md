# Stage 3 + 4 — the two halves meet

**Written 28 August 2026, after the CP6 audit.**
Read `CONTEXT.md`, `MEMORY.md` and `AGENTS.md` first. Then this.

---

## Where this starts

Two finished things exist and have never touched each other.

```
36 screens                      22 tables · 32 RLS policies · 51 assertions
79 tests · build clean          rebuilt from zero and re-verified 28 Aug
        │                                        │
        └────────────  nothing here  ────────────┘
```

Every screen reads an in-memory store that resets on reload. The database has
never served a request to anything. **The gap between them is this stage.**

`MASTER.md` §5 already decided what goes in the gap:

```
Staff browser ──sign in──> Firebase Auth ──ID token──> App API
                                                        │ verify token
                                                        │ SET LOCAL app.user_id
                                                        │ connects as pms_app
                                                        ▼
                                                   PostgreSQL (RLS)
```

**That App API does not exist.** No `api/`, no `server/`, no functions
directory. It is the single largest missing piece in the project, and Stage 3
and Stage 4 both sit on top of it.

---

## The one decision that needs a human

**Where does Postgres live in production?** Everything below runs against the
local cluster and does not wait on this — but it must be answered before
anything ships.

`MASTER.md` §6 already did the research and found the constraint: *the blocker
across free tiers is backups, not storage.* Seven hotels generate 150–200 MB a
year. Storage is never the problem; losing a folio is.

| Option | Cost | The catch |
|---|---|---|
| **DigitalOcean managed Postgres** | $15/mo | Free daily backups. Plain Postgres, so the schema is unchanged. |
| Supabase Pro | $25/mo | Duplicates the Auth we are not using — Firebase already won that. |
| Oracle Always Free | ₹0 | Halved without notice in June; instances under 20% CPU may be **reclaimed**. A quiet Postgres looks idle. |
| Neon / Prisma / Mongo free | ₹0 | No backups, or exhausted inside a fortnight by a 24/7 front desk. |

**Recommendation: DigitalOcean managed Postgres, $15/mo.** It is the cheapest
option with a real recovery path, and finding C3 in the database audit — *a
verified schema with no recovery path is a partial result* — is still open.
Oracle's free tier is fine for the API process; it is not fine for the only
copy of the money.

Proceed on the assumption of managed Postgres. Nothing below changes if the
answer is different — only the connection string does.

---

## The rule this stage exists to test

> Screens import from `@/data/repositories` and from nowhere else.

That rule has been enforced by a test since CP3 and has never been *proved*,
because there has only ever been one implementation behind it.

**The measure of this stage is a diff.** When the repositories move onto HTTP,
the number of lines that change under `src/pages/` and `src/components/`
should be **zero**. If screens change, the seam did not work and we find that
out now rather than at Stage 9.

Record the diff at CP9. It is the deliverable, not a side effect.

---

## CP7 — the API tier exists

**Goal:** one HTTP endpoint returns one row from Postgres, through RLS, as a
real staff member.

```
new     api/                    a sibling to src/, its own package.json
        api/src/server.ts       Hono or Fastify — small, no framework religion
        api/src/db.ts           pg Pool, connects as pms_app, NEVER pms_migrate
        api/src/auth.ts         firebase-admin verifyIdToken
        api/src/withUser.ts     the transaction wrapper — see below
```

**The whole security model lives in one function.** Get it right once:

```ts
/* Every request runs inside ONE transaction with the user set on it.
   SET LOCAL is scoped to the transaction — a pooled connection handed
   to the next request carries nothing. Using SET (not SET LOCAL) here
   would leak one clerk's identity into another clerk's query, which is
   a cross-tenant data breach, not a bug. */
export async function withUser<T>(
  staffId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [staffId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
```

**Done when:**
- `GET /api/hotels` returns Agra and Pune for `agra@fidato.in`.
- The same call with **no token** returns 401 and touches no connection.
- `pms_app` is the connecting role. Verify with `select current_user` — if it
  says `postgres`, RLS is bypassed and every test below is worthless.
- A test proves `set_config(..., true)` is used: run two requests as two
  different staff on the same pooled connection and assert the second sees only
  its own hotels.

**Trap:** `firebase-admin` needs a service account key. It is a real secret —
unlike the web config in `src/lib/firebase.ts`, which is not. It goes in the
API's environment and never in `src/`, never in git.

---

## CP8 — sign in works

**Goal:** a person signs in with an email and password and the interface knows
who they are from **Postgres**, not from a store.

```
new     src/pages/SignIn.tsx
new     src/lib/session.ts        replaces the role half of src/lib/ui.ts
change  src/lib/ui.ts            role and hotelId move out; the rest stays
change  src/components/app/RoleSwitcher.tsx   becomes a real property switcher
```

`src/lib/firebase.ts` already exposes `auth` and needs no change. Migration 017
already put `firebase_uid` on `staff` and taught `app.current_user_id()` to
accept a Firebase uid alongside a uuid.

**Roles never live in Firebase.** Firebase answers *who are you*. Postgres
answers *what may you do*, from `staff` and `staff_hotels` under RLS. Custom
claims may cache a role; they must never own it.

**Done when:**
- Signing in as the Agra clerk shows one property. Signing in as the owner
  shows all of them.
- `useUi(s => s.role)` no longer exists anywhere. `grep` proves it.
- Signing out clears the session and returns to `/signin`, and the back button
  does not restore a signed-in view.
- The permission matrix on `/admin/roles` is unchanged — it already reads
  `src/lib/permissions.ts`, which is still the source both the API and the
  interface gate on.

**Trap:** the role switcher is currently a *demo control*. Deleting it is
correct. Leaving it in beside a real session is how a clerk previews themselves
as an owner.

---

## CP9 — the seam swap

**This is the checkpoint the whole architecture was built for.**

**Goal:** `src/data/repositories/*` fetch over HTTP. Not one screen changes.

Work module by module, not all at once. Each module lands green:

```
1  properties.ts     3 functions   smallest, proves the pattern
2  rooms.ts          the room list and housekeeping state
3  stays.ts          the big one — see the mapping problem below
4  folios.ts + operations.ts       reads first, writes at CP10
5  statistics.ts + reportData.ts + managerReport.ts
6  directory.ts + billing.ts + admin.ts + notifications.ts
```

### The mapping problem — read this before writing `stays.ts`

The frontend `Stay` is **not** a `reservations` row. Three differences, and none
of them is a rename:

**A stay is a reservation joined to its assignment.** `reservations.room_id` is
null until check-in, because a booking is for a room *type* and a stay is in a
specific *room*. The flat `Stay.roomNumber` the screens read comes from
`room_assignments`, not from the reservation.

**`due-out` does not exist in the database, and should not.** The status
vocabularies look similar and are not:

```
frontend            database          how it maps
due-in          →   confirmed         AND check_in  = business date
in-house        →   checked_in        AND check_out > business date
due-out         →   checked_in        AND check_out = business date   ← derived
checked-out     →   checked_out
no-show         →   no_show
cancelled       →   cancelled
—               →   tentative         has no frontend state yet
```

`due-out` is a *view of today*, not a stored state. Deriving it in SQL is
correct. Adding a `due_out` status to the schema is not — it would need a
nightly job to keep true, and would be wrong between midnight and that job.

**`tentative` has nowhere to go.** Decide: either show it as a fourth filter on
`/h/:code/reservations`, or exclude it and say so in the repository comment.
Silently dropping rows is the one option that is not available.

**Done when:**
- `git diff --stat src/pages src/components` prints **nothing**. Paste it.
- All 79 tests still pass. They test the seam's contract, so they should not
  need editing — if one does, say which and why.
- The three verified figures in `HANDOVER.md` still reconcile against real data:
  PTD 132/431, guest ledger closing, city ledger summing to the same number.
- Every list still shows loading, empty **and error** — the error path stops
  being theatre at this checkpoint, because now it can actually fire.

---

## CP10 — the five flows write to Postgres

**Goal:** check-in, post a charge, reverse a posting, settle, check out — each
one lands in the database and survives a reload.

The five flows already exist as components and already work against the store.
This checkpoint changes what they call, not what they look like.

**The ledger rules are already enforced by the schema.** `006_folio.sql` makes
postings immutable — the suite proves *posting cannot be updated* and *posting
cannot be deleted*. The interface has been append-only since CP5 for exactly
this reason. It should fit without argument. If it does not, the interface is
wrong, not the schema.

**Done when:**
- Check a guest in, **reload the browser**, and they are still checked in.
- Two browser windows: check in from one, refresh the other, the arrivals count
  moves. (`MEMORY.md` defect 3 — *if an action does not move a number on screen,
  it is not finished* — now has to hold across two sessions.)
- A reversal creates a second row. `select count(*) from folio_postings` goes
  **up** when something is undone.
- The idempotency guard fires: submit the same payment twice and the second is
  refused. The suite already tests this at the database; prove the interface
  surfaces the refusal rather than showing a generic failure.
- Every `{ allowed, reason }` refusal still reads as a sentence a clerk
  understands. A Postgres constraint name is not that sentence — map it.

---

## CP11 — the business date comes from the database

**Goal:** delete the constant.

```ts
// src/data/fixtures/property.ts — today
export const BUSINESS_DATE = "2026-08-25";
```

Every screen, every report and every derived count reads that. It is correct
for a demo pinned to one day and wrong the moment two properties are in
different states, which is the normal condition of a seven-property group.

The table already exists: `night_audit_runs`. The business date is the day
after the last completed run, **per hotel**.

**Done when:**
- `grep -rn "BUSINESS_DATE" src/` returns only the repository that fetches it.
- Two properties can sit on two different business dates without either screen
  being wrong.
- The Night Audit screen's `canRun` stops being hard-coded `false` and starts
  reading whether a run is already in progress. The *run itself* is Stage 5;
  this is only the date it reads.

---

## CP12 — close the regression net

Three items the audit found open. None is optional before real money.

**Write `db/tests/rls.sql`.** `run.sh` already calls it behind `if [ -f ]`, so
it is skipped in silence today. The script's own comment says why that matters:
*a superuser bypasses RLS and would report success on a completely open
database.* All 51 assertions currently run as `postgres`. The suite proves
constraints and proves nothing about isolation.

It must connect as `pms_app` and assert, at minimum:

```
· an Agra clerk selecting reservations gets 0 rows from Pune
· an Agra clerk INSERTing a reservation with a Pune hotel_id is refused
· an Agra clerk UPDATEing a Pune folio changes 0 rows and does not error
  silently into success
· the owner, who is is_group_admin, sees both — through the policy, not
  around it
· hotels_read is deliberate: every active clerk can read every hotel row.
  Assert it, so the day someone tightens it the test says so.
```

**Concurrency.** All 51 assertions ran serially. Nothing has exercised two
clerks booking the same room in the same millisecond, which is what the two
`EXCLUDE USING` constraints exist for. Two concurrent transactions, same room,
overlapping dates — one commits, one is refused.

**Backups.** Finding C3, still open. Whatever the hosting answer is, prove a
restore. A backup that has never been restored is not a backup.

---

## Sequencing, and what can run in parallel

```
        ┌── CP7 API tier ──┬── CP8 sign in ──┐
        │                  │                 │
decision│                  └── CP9 seam swap ┴── CP10 flows ── CP11 date
 (human)│
        └── CP12 rls.sql ──────────────────────── (independent, start now)
```

**CP12's `rls.sql` does not depend on anything** and closes a live hole in the
regression net. If two agents are available, that is the second lane — and per
`AGENTS.md`, it owns `db/` outright while it runs.

Everything else is a chain. CP9 cannot start before CP7, because there is
nothing to fetch from.

---

## What does NOT happen in this stage

Naming these keeps the stage from sprawling. Each has a stage that owns it.

| Not now | Owned by |
|---|---|
| The night audit **run** — posting charges, rolling the date | Stage 5 |
| Issuing invoice numbers against the real GST series | Stage 8 |
| Editable rates, availability, STAAH | Stage 9 |
| Sattva POS — a migration off a live system, not a build | Stage 7 |
| The six unnamed properties | needs a human, not an agent |

The three refusals on screen today — invoice issuing, the audit run, rate
editing — **stay refused**, with their reasons intact. Rule 6 has not relaxed
because there is a database now.

---

## Definition of done for the stage

```
A clerk signs in with a real password.
They see one property. The owner sees seven.
They check a guest in. They reload. The guest is still checked in.
They post a charge, reverse it, settle the folio, check the guest out.
Every one of those is a row in Postgres, behind RLS, attributable to them.
git diff --stat src/pages src/components  →  0 files changed.
```

That last line is the one that says the architecture was right.
