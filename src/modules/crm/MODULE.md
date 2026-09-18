# Central CRM

One record for each guest, company and partner hotel, whichever system they came through.

**NOT BUILT. A Coming soon page only.** Asked for by the owner; the owner chose on
16 September to give every missing service a folder and a Coming soon page.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `crm` — the word the other two places will use when it is
built:

```
src/modules/crm/                   the Coming soon page, its menu entry and its address
api/src/modules/crm/               does not exist
db/tests/modules/crm.sql           does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

A group-wide record of the people and businesses Fidato deals with —
guests, companies, agents and partner hotels — whichever of the three
systems they came through: this one, the Fidato CRS (`D:\fidato crs`) or
the WhatsApp leads app (`D:\fidato tools\new live invetory`). Today each
keeps its own, and this one keeps a new guest row for every booking
(`api/src/modules/guests/directory.ts`: "a row per booking … the merge
rules are not decided").

---

## Where it stands, and where that comes from

- **Asked for by the owner, 15 September**: "a central CRM … all the data for the partners and the CRS and the inventory and the leads and also the PMS" (root `CHANGELOG.md`, 2026-09-15, "one system").
- `docs/HMS-INTEGRATION-PLAN.md` Phase 6, and the audit findings LD-6 (a guest is a phone number there and a name here) and CRS-4 (every CRS booking would create a new guest here).
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** Guests and companies here are shared across hotels, but a returning guest gets a new record with each booking, and the CRS and the leads app keep their own.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Central CRM | `/coming-soon/crm` | `pages/Crm.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "crm", "customer", "guest history", "partners", "relationship". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. A rule for recognising the same person in different systems, starting with the phone number stored the same way everywhere.
2. The CRS and the leads app connected to this system first.
3. Your decision on which record wins when two systems disagree.

---

## What it would lean on

- **guests** — guests and companies are group-level already (`004_guests.sql`); never deleted (`015`).
- **crs** and **leads** — the two other systems' records, once connected.
- **reservations** — what a person has booked.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Guests are never deleted** (`015`); a merge is a decision the owner has not made (`directory.ts`).
- **Personal data**: guest documents are not persisted in the browser (`App.tsx`, the `PERSISTED` list).
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Crm.tsx` with the real screens, at their real addresses.
- Move the menu entry out of the Coming soon section into the section it
  works in, with the working menus it belongs to (`navigation.test.ts` pins
  every role's list, and the Coming soon list).
- If not every hotel has it, a module switch per hotel: one migration on
  `hotel_modules_known` (`041`, `087`) and the two lists in
  `api/src/modules/admin/moduleSwitches.ts`.

---

## Gates

`npx tsc -b --force` and `npx vitest run`, judged by the exit code —
`src/test/boundaries.test.ts` fails if this folder loses its `index.ts` or
this `MODULE.md`; `src/components/app/navigation.test.ts` pins the Coming
soon section.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
