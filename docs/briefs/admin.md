# Administration — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/admin/          your screens, their data, their tests
api/src/modules/admin/      your routes on the server
db/tests/modules/admin.sql  new database checks (create it if absent)
```

Your screens: **Properties**, **People**, and **Administration** — Users, Roles
and permissions, Integrations, Audit log, Settings, and the Console
(development builds only). Read `src/modules/admin/MODULE.md`, then its
`DEFECTS.md`.

**This is the most dangerous service to get wrong.** It decides who can sign
in, what they may do and which properties exist. A mistake here does not show
up as a wrong screen — it shows up as somebody doing something they should not.

---

## What the critique and the defect log say

**Strong:** *"One person can sign in and see nothing — Pune Clerk"*, and the
provisioning warning — *"Creating a property manufactures a whole tenant."*
Both tell an administrator the consequence before they act.

### ADM-1 · The Audit log names "admin" as the person behind every entry — start here

An audit log that cannot say who did something is not an audit log. It is the
one screen an owner opens after something has gone wrong, and today it would
tell them nothing. Self-contained, provable, and the most useful fix in your
service that changes nobody's permissions.

### API-2 · A clerk can read the audit log and the property settings through the API — ASK FIRST

Found by the route audit of 16 September. The screens hide these from a clerk;
the server does not refuse them.

**Closing it changes what a role may do, which is the owner's decision.** Bring
it with a recommendation. And the role map itself lives in
`src/lib/permissions.ts`, which is the **master's** file — your part is the
route's refusal, after the owner has said yes.

### ADM-3 · Every deploy re-creates the placeholder administrator once it is deleted

Migration 008 re-creates `REPLACE — your name` whenever the row is missing, and
it holds **access to every property**. Root `MEMORY.md` 271: it must be
**deactivated, never deleted**, or the next deploy brings it back. The
critique found it active in the development database.

**The fix lives in `db/migrations/`, which is the master's.** Your part is to
say so, with evidence of what production holds — **a read-only check only;
writes on the server need the owner's explicit yes.**

### ADM-2 · Settings and the Properties cards show a tax the database no longer uses

Migration 067 moved tax into rules. Two cards still print the old figure.

### From the critique

- Three words for one state: pill `Switched off`, button `Deactivate`, button
  `Bring them back`. Pick one verb pair and use it everywhere.
- Four inline actions on every row of People, where every other service uses a
  single "More options" menu.
- "7 active" over 14 interleaved rows — the count and the list disagree about
  what is shown.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders.

**No — and these will break other chats:**

- **`src/lib/permissions.ts`** — the role map. Every service's menu and every
  route guard reads it. Your screens *display* roles; the master *changes* them.
- `src/components/app/RequireAccess.tsx` and `navigation.ts` — the guard every
  service stands on.
- `api/src/auth.ts`, `identity.ts` — who a request is. Shared by every route.
- `db/migrations/` — including 008 (the placeholder), 010/078 (roles), 029
  (the provisioning key), 084 (property admin). Read them; ask the master.
- **Firebase, and `api/.env` above all.** People sign in through Firebase, and
  the production key is in that file. **Never commit, print, echo or copy it.**

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. `.claims/admin.md`.
3. Read `MODULE.md` and `DEFECTS.md`, and root `MEMORY.md` 263 and 271 — the
   account-takeover hole that migration 088 closed, and the placeholder.
4. **ADM-1** — make the audit log say who.
5. Then bring the owner **API-2** and **ADM-3** as questions, with evidence and
   a recommendation each. Do not change who may do what without their yes.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
