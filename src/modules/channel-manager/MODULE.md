# Channel manager

**Folder name:** `channel-manager` — the same word in all three places:

```
src/modules/channel-manager/          the screens, their data calls, their tests
api/src/modules/channel-manager/      the server's routes for this service
db/tests/modules/channel-manager.sql  its database checks (new ones only — suite.sql is history)
```

## What it is

Rates and rooms to the booking sites. PARKED by the owner: only its "not connected" status page exists. Nothing is built here until the owner asks.

## Leans on

guests (the companies list on its status page)

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
