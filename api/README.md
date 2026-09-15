# The App API

The middle of `MASTER.md` §5. It verifies a Firebase ID token, sets
`app.user_id`, and talks to Postgres as `pms_app`.

```
Staff browser ──sign in──> Firebase Auth ──ID token──> App API  ← this
                                                        │ verify token
                                                        │ SET LOCAL app.user_id
                                                        │ connects as pms_app
                                                        ▼
                                                   PostgreSQL (RLS)
```

**This process decides no permissions.** Every isolation guarantee is a policy in
the database. The API exists to put the right person's name on the transaction
and then get out of the way. If a `where hotel_id = …` ever appears in a route,
isolation has moved out of the schema and into application code, where it has to
be *remembered* on every query instead of *enforced* on every query.

---

## Running it

```bash
cp .env.example .env
npm install
npm run dev
```

The database must be up first. `db/tests/run.sh` in `D:\PMS FIDATO` rebuilds it
from zero, applies all 18 migrations and seeds it.

```bash
curl http://localhost:8787/health
```

`{"ok":true,"database":"reachable","role":"pms_app"}`

The role in that response is not decoration. Connecting as `postgres` or
`pms_migrate` bypasses RLS and makes every isolation guarantee in the schema
decorative, so the health check returns **503** when the role is wrong rather
than logging it and carrying on.

---

## `withUser` — the whole security model

Everything about tenant isolation comes down to one function in `src/db.ts`.

```ts
await client.query("select set_config('app.user_id', $1, true)", [staffId]);
// 

thisnaithan
↑
//            

is_local
```

`true` scopes the setting to **this transaction**. When the client returns to the
pool it carries nothing.

`false` scopes it to the **session**. The pooled connection keeps the setting,
hands it to the next request, and that request runs as the previous clerk. That
is a cross-tenant data breach, not a bug — and it would pass every test that
only ever makes one request at a time.

`test/isolation.test.ts` asserts it directly, and the assertion was proved by
flipping the flag and watching it fail before this was written down.

Nothing else opens a connection. Every query goes through `withUser`, so there
is exactly one place to be wrong.

---

## Authentication

`app.current_user_id()` already accepts **either** a staff uuid **or** a
28-character Firebase uid, resolving the latter through `staff.firebase_uid` —
migration 017 did that work. So the uid goes straight into `withUser` and the
session profile is read from `staff` *inside* the transaction, where the
`staff_self` policy returns exactly the caller's own row.

There is deliberately no "resolve this uid to a staff row" helper. That means no
code path reads a staff row outside RLS.

### `ALLOW_DEV_AUTH`

Local development has no Firebase service account, so `x-dev-staff-id` names the
caller directly.

**It is a hole and it is treated as one.** `src/env.ts` *throws at startup* if it
is set with `NODE_ENV=production` — it does not warn, and it does not quietly
disable itself. A dev bypass that survives a deploy is how a stranger signs in as
the owner.

The service account JSON is a real secret, unlike the web config in
`src/lib/firebase.ts`. It goes in the environment, never in `src/`, never in git.

---

## Tests

```bash
npm test
```

Ten assertions, against the **live** local Postgres as `pms_app` with RLS in
force. They are not unit tests with a mocked pool: a mock would pass while the
real thing leaked, which is the failure worth catching.

`beforeAll` asserts that reading `staff` with no session set returns **zero
rows**. If it returns any, RLS is not in force and every test below would pass
for the wrong reason.

One test is worth reading before writing another. The first version of *refuses a
cross-tenant write* selected its source rows from the other property; RLS hid
them, so the `INSERT` inserted nothing and succeeded. A vacuous pass — the exact
trap `MEMORY.md` already records. It now asserts the source row count first,
because **a test that inserts nothing can never fail.**

---

## What CP7 added to the database

`018_api_access.sql`, one policy.

`staff_hotels` had `force row level security` and **zero policies** — deny-all for
`pms_app`. Isolation still worked, because `app.auth_hotel_ids()` is
`SECURITY DEFINER` and reads the table as owner, so nothing looked broken. The
API asked *which properties may I work in, and as what role* and got an empty
list back, which reads as "none" and is not the same fact as "denied".

A deny-all table nobody queries is a defensible default. A deny-all table the
application must query is a silent empty list: no error to notice, and no data to
act on.

The policy is `select` only. Granting a hotel to a person is an administrative
act and belongs to `pms_admin` — a clerk who could insert there could grant
themselves the property next door.

---

## Open question for a person

`GET /api/hotels` returns **both** properties to the Agra clerk, because the
`hotels_read` policy is `app.is_active_staff()`. That is almost certainly
deliberate — the property switcher needs the list — but it means any active clerk
can enumerate every property in the group.

The response separates the two facts so the interface cannot confuse them:

```
hotels        every property this person may READ
scope.hotels  the ones they may WORK IN, with their role in each
```

Confirm the read grant is intended rather than discovering it later.


ok this ahitskal o kjt asjime diwmeap[ntnas ADioaiodj P]