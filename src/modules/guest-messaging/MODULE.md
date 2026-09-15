# Guest messages

Messages this system sends to guests: the booking confirmation, a note before
arrival, the bill, a thank-you — by WhatsApp, SMS or email.

**NOT BUILT. A Coming soon page only.** The owner chose on
16 September to give every service the system does not have a Coming soon
page, in one section at the foot of the menu for the owner, admins and
general managers. This folder holds this brief, an empty front door
(`index.ts`), its own `CHANGELOG.md` and `MEMORY.md`, and the page with
its menu entry and address — no working feature, no server code.

**Folder name:** `guest-messaging` — the word the other two places will use
if it is ever built:

```
src/modules/guest-messaging/          this brief, and the Coming soon page (menu entry, address)
api/src/modules/guest-messaging/      does not exist
db/tests/modules/guest-messaging.sql  does not exist
```

---

## What it would be

Nothing is ever sent to a guest today — no confirmation, no pre-arrival
message, no bill by email, no feedback request (`PROGRESS.md`, "What a
market-leading HMS has that this does not", item 4, which says WhatsApp, not
email, is the channel in this market). There is no email in the deployment at
all: a new staff member's password is typed by a manager and told to them
(`PENDING.md` § 6). The project's documents name WhatsApp and email; SMS is
not mentioned in them.

---

## Status, and where it comes from

- **Not built.** `docs/SERVICE-FOLDERS-PLAN.md`: "Guest messages |
  `guest-messaging` | not built".
- **Already decided** (`HANDOVER.md` § 3.5, staff-first phase 3, ASK FIRST):
  documents get WhatsApp and email send options.
- **Needed from the owner**: how WhatsApp and email should send — through
  the n8n on the server or a direct service — and which number, which address
  (`HANDOVER.md` § 3.5; `PROGRESS.md` "Still needing a person", item 8).
- Context: n8n runs on the server, local only (`PENDING.md` § 1); the owner's
  decision of 14 September is its screen locked to the owner's address and its
  webhook paths open (`HANDOVER.md` § 4). n8n reaches the PMS as its own
  account, `n8n@fidatohotels.com` (Viewer), which does not exist yet, and
  `n8n.fidatohotels.com` has no DNS record yet (`PENDING.md` § 2).

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Guest messages | `/coming-soon/guest-messaging` | `pages/GuestMessaging.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "whatsapp", "email", "confirmation", "pre-arrival", "sms". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. How messages go out: through the WhatsApp system the leads app already has, or a separate service.
2. The WhatsApp number and the email address each hotel sends from.
3. The message templates, approved by WhatsApp before they can be used.

---

## What it would lean on

- **reservations** — the confirmation of a booking.
- **front desk** — who arrives when, for a pre-arrival note.
- **finance** — the bill or invoice to send.
- **guests** — the guest's phone and email.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **The n8n encryption key is a master password** — never paste it anywhere
  (`HANDOVER.md` § 5). Account keys live in the server's environment
  (`api/.env`), never in the repo, a screen or a chat.
- **Facts on a document come from the session and the database, never a
  literal** — the property's name, the person (`HANDOVER.md` § 6; root
  MEMORY 256).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b` and `npx vitest run` — `src/test/boundaries.test.ts` fails if
this folder loses its `index.ts` or this `MODULE.md`.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
