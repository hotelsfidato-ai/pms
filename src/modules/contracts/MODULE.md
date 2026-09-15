# Contracts — negotiated rates and allotments

Negotiated rates for companies and agents, and rooms held for them until a release date.

**NOT BUILT. A Coming soon page only.** On the list of what every comparable system has; the owner chose on
16 September to give every missing service a folder and a Coming soon page.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `contracts` — the word the other two places will use when it is
built:

```
src/modules/contracts/             the Coming soon page, its menu entry and its address
api/src/modules/contracts/         does not exist
db/tests/modules/contracts.sql     does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

The rate a company or travel agent has negotiated, applied at booking,
and allotments — rooms held for an account until a release date. The
companies and the city ledger exist; what is missing is "a contracted rate
per account and an allotment" (`PROGRESS.md`, item 11).

---

## Where it stands, and where that comes from

- **What comparable systems ship as standard** — `PROGRESS.md`, "What a
  market-leading HMS has that this does not", item 11. Domain
  knowledge about the category, not a decision by the owner.
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** Companies and their bills are recorded. A company's agreed rate is typed on each booking, and nothing holds rooms for an account.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Contracts | `/coming-soon/contracts` | `pages/Contracts.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "corporate rate", "negotiated rate", "allotment", "agent contract", "release". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. The contracts you have today, and their rates.
2. The release rules agreed with each account.
3. Who may change a contracted rate.

---

## What it would lean on

- **guests** — companies and agents (`companies`, `booking_sources`).
- **inventory** — rates and availability; an allotment reduces what is sellable.
- **reservations** — the booking that uses the contracted rate.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **A rate is stamped onto the booking, never looked up later** — the pattern of `082` (commission) and `067` (tax): a report about March must not change because of something agreed in April.
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Contracts.tsx` with the real screens, at their real addresses.
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
