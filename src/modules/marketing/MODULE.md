# Marketing

Which campaign brought which guest, what it cost and what it earned.

**NOT BUILT. A Coming soon page only.** Asked for by the owner; the owner chose on
16 September to give every missing service a folder and a Coming soon page.
The page says what the service will do, what it needs before it can be built
and what exists today. There is no working feature, no server code and no
database table.

**Folder name:** `marketing` — the word the other two places will use when it is
built:

```
src/modules/marketing/             the Coming soon page, its menu entry and its address
api/src/modules/marketing/         does not exist
db/tests/modules/marketing.sql     does not exist
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 16 September 2026.

---

## What it would be

Campaigns, what they cost, and what their guests paid — "revenue to
market". The leads app already captures the ad a WhatsApp enquiry came from
(`source`, `campaignId`, `ctwaClid`, first and latest touch); ad spend is
recorded nowhere, and its own plan says marketing attribution needs Meta Ads
and Google Ads access (its `EXECUTION-PLAN.md`).

---

## Where it stands, and where that comes from

- **Asked for by the owner, 15 September**: "the revenue to market system" and the Meta leads campaigns (root `CHANGELOG.md`, 2026-09-15, "one system").
- **Its Coming soon page — the owner's decision, 16 September:** a folder and a
  Coming soon page for every service the system does not have, in one
  "Coming soon" section at the foot of the menu, for the owner, admins and
  general managers (root `CHANGELOG.md`, 2026-09-16).
- **Today:** The leads app records which ad each WhatsApp enquiry came from and adds up booking values staff type in. What a campaign cost is not recorded anywhere.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Marketing | `/coming-soon/marketing` | `pages/Marketing.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "campaigns", "ads", "meta", "attribution", "return on ad spend". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. Access to Meta Ads, and Google Ads if you use it, for what each campaign cost.
2. Leads and WhatsApp connected to this system first.
3. Booking figures confirmed by this system rather than typed by staff.

---

## What it would lean on

- **leads** — the enquiry and its ad.
- **reservations** — the booking the enquiry became, and its figures.
- **reports** — revenue by source.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Revenue shown here is the booking's, confirmed by this system** — never a figure a person typed (LD-2, LD-3). A missing figure is a dash.
- **Never invent a figure; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **Credentials live in the server's environment** (`api/.env`) or the n8n on
  the server — never in the repo, a screen or a chat (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## When it is built

- Replace `pages/Marketing.tsx` with the real screens, at their real addresses.
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
