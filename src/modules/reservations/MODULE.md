# Reservations

**Folder name:** `reservations` — the same word in all three places:

```
src/modules/reservations/          the screens, their data calls, their tests
api/src/modules/reservations/      the server's routes for this service
db/tests/modules/reservations.sql  its database checks (new ones only — suite.sql is history)
```

## What it is

New booking, All bookings, Groups and their rooming lists.

## Leans on

inventory (prices and what is free), guests (booking sources, companies), front desk (stays)

Through each service's front door (`index.ts`) only — the guard in
`src/test/boundaries.test.ts` refuses anything else.

## Status

Being moved into this folder (docs/SERVICE-FOLDERS-PLAN.md, 15 September).
Its menu entries (`nav.ts`) and screen addresses (`routes.tsx`) are already
here. The rest of this brief — its screens, endpoints and tables, the owner's
decisions, open items and requests — is written when the move is finished.

## Requests from other services

None yet. Another service that needs a change here writes it in this list;
it is not made from outside.
