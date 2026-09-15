# Guests and companies

**Folder name:** `guests` — the same word in all three places:

```
src/modules/guests/          the screens, their data calls, their tests
api/src/modules/guests/      the server's routes for this service
db/tests/modules/guests.sql  its database checks (new ones only — suite.sql is history)
```

## What it is

The guest directory, companies and agents, booking sources, ID capture, Form C.

## Leans on

reservations (read only)

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
