# Online check-in

Guests give their details and ID before they arrive, so the desk only hands over the key.

**BEING BUILT since 19 September** (the owner's D18-9 to D18-13;
`docs/briefs/guest-page.md`). What exists now is the guest's own page up to
the six-digit code: `/g/:token` opens the booking, asks for the number the
booking carries, and answers the code. **Everything behind the code — the
bill, the check-in details and the ID photo, a spa or laundry request — is
not built yet**, and waits on two things the master owns (see "Waiting on
the master" below).

The staff-facing Coming soon page is still here and still in the Coming soon
menu section: nothing a clerk sees has changed yet.

**Folder name:** `online-checkin` — the word the other two places will use when it is
built:

```
src/modules/online-checkin/        the Coming soon page, its menu entry and its address
api/src/modules/online-checkin/    does not exist
db/tests/modules/online-checkin.sql does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

Web check-in, a digital registration card with a signature, and ID
scanning (`PROGRESS.md`, items 6 and 7). ID capture at the desk exists
(`026_identity_capture.sql`), and so does Form C (the guests service).

---

## Where it stands, and where that comes from

- **What comparable systems ship as standard** — `PROGRESS.md`, "What a
  market-leading HMS has that this does not", item 6 and 7. Domain
  knowledge about the category, not a decision by the owner.
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** ID is recorded at the desk at check-in. Nothing reaches the guest before they arrive.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Online check-in | `/coming-soon/online-checkin` | `pages/OnlineCheckin.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |
| — (no menu entry, ever) | `/g/:token` | `pages/GuestPage.tsx` | **the guest**, and nobody else |

⚠ **`/g/:token` is exported separately, as `publicRoutes`.** The routes above
sit inside `RequireSession` in `App.tsx`; this one must not, because the
person opening it has no sign-in and never will. It carries no sidebar, no
property picker and no menu. The token in the address is the whole
credential (migration 114) — there is no session, no account and no guest
role — and everything behind the six digits is refused **by the server**
(`api/src/routes/guestDoor.ts`), never by this screen.

**What the page calls** (`data/guestPage.ts`): `GET /api/guest/:token`,
`POST /api/guest/:token/code`, `POST /api/guest/:token/verify`. Nothing else.
A test asserts exactly that list, so a screen cannot quietly fetch the bill
and hide it.

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "web check-in", "registration card", "pre check-in", "id scan", "e-signature". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. Guest messages, to send the link.
2. Your rule for ID photos: whether they are kept and for how long. They are personal data.
3. The registration card wording each hotel uses.

---

## What it would lean on

- **front-desk** — arrivals and check-in.
- **guests** — ID capture and Form C.
- **guest-messaging** — the link to the guest.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **ID documents are personal data.** They are not persisted in the browser (`App.tsx`, the `PERSISTED` list); how long a scan is kept is the owner's rule to set.
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/OnlineCheckin.tsx` with the real screens, at their real addresses.
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

## Waiting on the master — 19 September

**Answered 21 September, by the master:**
1. **Done** — mounted exactly as asked (`src/App.tsx`), and `src/App.test.tsx`
   now opens `/g/…` signed out and fails if the route goes (root MEMORY 310).
2. **At merge, not before** — a reserved number is a gap the migration-number
   test refuses (root MEMORY 302). Write it as the next free number in your
   copy; the master renumbers at merge if another lane took it first.
   **But first read `docs/architecture/online-checkin.md`** — the half behind
   the code waits on the owner's D21-6 to D21-11.
3. **Done** — `src/lib/api.ts` reads `error`, then `reason`, then `message`.
   Your own workaround can go.
4. Noted; not numbered in root MEMORY — it bites tests that build an
   `ApiError` by hand, and the rule is already OCI-1's: test through the
   browser's real object, not a constructed one.

Each of these is one line or one number in a file this lane may not change.
Nothing behind the code can be built until the first two are answered.

1. **Mount the guest's page outside the session gate.** In `src/App.tsx`,
   beside `/signin`:
   `import { routes as onlineCheckinRoutes, publicRoutes as guestPagePublicRoutes } from "@/modules/online-checkin/routes";`
   and `{guestPagePublicRoutes}` immediately after the `/signin` route. Proved
   locally with exactly that line and then reverted — `App.tsx` is the
   master's. Without it `/g/:token` falls through to the catch-all.
2. **A migration number**, for the definer functions the verified half needs
   (the bill as it stands, the check-in details and the ID photo, a request).
   None taken; 119 is the highest in the tree today.
3. **`src/lib/api.ts` loses a refusal's own sentence.** It lifts a body's
   `error` or `reason` into the `ApiError` message but not its `message`, and
   this door writes its "codes cannot be sent yet" sentence in `message`
   (OCI-1). One line — `body?.error ?? body?.reason ?? body?.message ?? …` —
   fixes it for every screen; this lane worked around it in its own file.
4. **`ApiError` is a different shape in the two environments.** In the dev
   server its `body` survives; under vitest the transform drops it
   (`Object.keys` → `["status","name"]` against `["status","body","name"]`).
   Any screen reading `error.body` is untestable here, and a test that builds
   one with `new ApiError(...)` tests the transform. Worth a root `MEMORY.md`
   number — the master's to write.

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
