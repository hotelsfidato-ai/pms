# Leads and WhatsApp

Every enquiry from a Meta ad or a WhatsApp message, answered on time and followed through to a booking.

**NOT BUILT. A Coming soon page only.** Asked for by the owner; the owner chose on
16 September to give every missing service a folder and a Coming soon page.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `leads` — the word the other two places will use when it is
built:

```
src/modules/leads/                 the Coming soon page, its menu entry and its address
api/src/modules/leads/             does not exist
db/tests/modules/leads.sql         does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

The WhatsApp lead inbox: Meta ads and WhatsApp messages become leads,
routed to a hotel, assigned, answered against a response clock, followed up
and marked booked or lost. It exists as a separate application,
`D:\fidato tools\new live invetory` (Firebase `live-inventory1`, no git),
with four n8n workflows A–D; its 13–14 September build is not deployed and
the workflows are not switched on (its own `PROGRESS.md`).

---

## Where it stands, and where that comes from

- **Asked for by the owner, 15 September**: the live inventory "is related to the marketing … when we launch a leads campaign in Meta we are pushing them to WhatsApp and all the leads are captured in this and we are able to maintain this as a CRM" (root `CHANGELOG.md`, 2026-09-15, "one system").
- `docs/HMS-INTEGRATION-PLAN.md` Phase 2, and the audit `docs/audits/2026-09-15-live-inventory-pms.md` (LD-1 … LD-9).
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** It is being built as a separate app, live-inventory1.web.app, for six hotels; its inbox waits on the WhatsApp workflows being switched on. Nothing passes between it and this system yet.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Leads and WhatsApp | `/coming-soon/leads` | `pages/Leads.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "enquiries", "whatsapp", "meta ads", "inbox", "follow-up", "sales". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. The WhatsApp workflows moved onto this system's server, and the Meta token renewed before about 27 September.
2. A booking here able to record the enquiry it came from.
3. Which rooms 5 Elements actually has, so the availability the team quotes matches this system.

---

## What it would lean on

- **reservations** — a lead marked booked becomes a booking here, carrying the lead's id (plan step 2.3).
- **guests** — the guest, and the booking source "WhatsApp lead".
- **inventory** — the availability the team quotes.
- **guest-messaging** — the same WhatsApp pipeline, reused for guest messages (LD-7).

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **The WhatsApp token and the Firestore service account live only in the n8n on the server**, never in a repository, a screen or a chat (`docs/HMS-INTEGRATION-PLAN.md` § 2).
- **Staff never type a booking reference by hand** (LD-1).
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Leads.tsx` with the real screens, at their real addresses.
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
