# Guests and companies — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/guests/          your screens, their data, their tests
api/src/modules/guests/      your routes on the server
db/tests/modules/guests.sql  new database checks (create it if absent)
```

Your screens: **Guests** (`/guests`), **Companies and agents** (`/companies`),
**Booking sources** (`/h/:code/booking-sources`) and **Form C**
(`/h/:code/form-c`). Read `src/modules/guests/MODULE.md`, then its
`DEFECTS.md`.

**You hold people's identities.** Form C is a legal register of foreign guests,
and identity capture (migration 026) exists for the law. **Nothing about a
guest's identity documents goes anywhere it does not already go.**

---

## What the defect log says

### GUE-1 · Companies and agents opens a screen headed "Booking sources" — start here

Two different screens with each other's name. A clerk who opens "Companies and
agents" and reads "Booking sources" reasonably concludes they are in the wrong
place. Small, self-contained, provable.

### From the critique

- **Guests on a phone was fixed on 16 September** — the card heading was a
  `<p>` holding the avatar's `<div>`, invalid HTML React reported on every
  render (root `MEMORY.md` 278). Read that entry before touching the guest list's
  first column: a shared component cannot know what a screen puts in it.
- Guests spans **three menu sections** — Bookings, Configuration, Finance. That
  placement is the navigation's, which is the master's.

---

## What other services will read from you

This is why your front door (`src/modules/guests/index.ts`) matters more than
most:

- **Booking sources and their commission** (migration **082**) are what a
  channel manager and the CRS will attach to every booking they send. Changing
  what a source means changes what those bookings cost.
- **Guests and companies** are what a central CRM would one day hold
  (`docs/briefs/crm.md`). The matching question — which record wins when three
  systems spell one guest three ways — is the owner's, and it is not yours to
  answer early.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders.

**No — and these will break other chats:**

- `src/components/ui/DataTable.tsx` — your guest list is built on it, and so is
  every other list in the product.
- `src/modules/reservations/` and `src/modules/front-desk/` — a booking is
  theirs; the guest on it is yours. Read through their front doors.
- `db/migrations/` — ask the master. **026** (identity capture), **025**
  (invoices and Form C) and **082** (booking sources) are load-bearing under
  your service.
- `src/lib/documentIdentity.ts` — shared.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. `.claims/guests.md`.
3. Read `MODULE.md`, `DEFECTS.md`, and root `MEMORY.md` 278.
4. **GUE-1** — the heading.
5. Then read what the channel manager and CRS briefs say they will need from
   booking sources, and write down in your `MODULE.md` whether the source table
   can already carry it.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
