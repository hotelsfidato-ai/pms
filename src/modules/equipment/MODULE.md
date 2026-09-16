# Equipment

The register of everything durable in the hotel, the restaurant and the rooms
— **redefined 16 September (S2); being built as phase 1B.** Brief:
`docs/briefs/equipment.md`. The notes below about door locks and phones are the
old meaning (now `room-systems`), kept until 1B rewrites this file.

**NOT BUILT YET. A Coming soon page only.** On the list of what every comparable system has; the owner chose on
16 September to give every missing service a folder and a Coming soon page. Its page is marked **When a hotel asks**.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `equipment` — the word the other two places will use when it is
built:

```
src/modules/equipment/             the Coming soon page, its menu entry and its address
api/src/modules/equipment/         index.ts only, empty, mounted by the master for 1B
db/tests/modules/equipment.sql     does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be — REDEFINED 16 September

**The register of everything durable in the hotel, the restaurant and the
rooms**, with its repairs and the buying of new things. The owner gave this
service that meaning (decision S2); it is built in **phase 1B** of
**`docs/STOCK-AND-EQUIPMENT-PLAN.md`** — read that first.

- Costly items one by one with a tag; cheap items by count per room (S7).
- Where each thing is: a room (`rooms`) or a place (`locations`, 094).
- Who it came from (`suppliers`, 094), its warranty and service-contract dates.
- Status: in use, under repair, retired — never deleted.
- Repairs: a work order (058) pointing at the item, built by housekeeping in 2B.

**What this folder used to describe** — door locks, room phones, minibar and
TV — moved to `src/modules/room-systems/`, unchanged. The notes below this
section were written for that meaning and are kept as history until phase 1B
rewrites this brief.

---

## Where it stands, and where that comes from

- **What comparable systems ship as standard** — `PROGRESS.md`, "What a
  market-leading HMS has that this does not", item 20–23. Domain
  knowledge about the category, not a decision by the owner.
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** Nothing is connected. The desk's Post a charge list has no telephone or minibar line.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Hotel equipment | `/coming-soon/equipment` | `pages/Equipment.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "door lock", "key card", "pabx", "telephone", "minibar", "iptv", "energy". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. Which hotel wants which, and the brands installed. Onity, Salto and Hafele are common locks.
2. The makers' connection documents.
3. Possibly a small computer at the hotel, when a maker's system cannot be reached over the internet.

---

## What it would lean on

- **front-desk** — the room assigned at check-in, and check-out.
- **finance** — calls and minibar posted to the folio.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Only when a hotel asks** (`PROGRESS.md`: "when asked"). Its page says so.
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Equipment.tsx` with the real screens, at their real addresses.
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
