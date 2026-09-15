# Memory — inventory and rates

What this service learned the hard way. Read it before your first edit here.

**New defects for this service are numbered with its prefix: INV-1, INV-2,
and so on**, each with what broke, how it was found, whether it is fixed, and
the rule it teaches (`HANDOVER.md` § 5: every mistake is recorded, numbered).
Newest at the bottom of the numbered list.

Project-wide lessons — anything that would bite another service too — stay in
the root `MEMORY.md` with plain numbers. When this file was written
(15 September 2026) the root file's numbers ran to 274. Check the root file
before taking one.

---

## Defects found since the move

### INV-1 · `GET /api/hotels/rate-plans` can never run

Found 15 September 2026 while writing this service's brief. **Not fixed.**

`api/src/routes/directory.ts` registers `GET /rate-plans` under
`/api/hotels`. `api/src/routes/property.ts` registers `GET /:code` under the
same prefix and is mounted before it — by the core in `api/src/server.ts`
today, and before the move as well (at tag `pre-service-folders` property is
mounted ahead of directory). Hono answers with the first registration that
matches, so `/api/hotels/rate-plans` is answered by `property.ts` as a
property whose code is "RATE-PLANS": 404, "No such property."

Checked with a minimal reproduction against the installed Hono (4.13.5): two
routers mounted in that order, and the request came back 404 from the
`/:code` handler. Not run against the API itself.

Harmless today: its only caller, `listRatePlans`, sits behind
`RatePlansPage`, which no address reaches (PENDING § 5a), and `fetchOr` turns
the 404 into an empty list. If that screen is ever routed, it will show no
plans and say nothing.

**Rule:** before adding a route, grep every router on the same prefix — the
core's too — for a parameter route mounted earlier. A `/:code` swallows every
literal path after it (root MEMORY 70, 118).

### INV-2 · Two screens are headed differently from their menu entries

Found 15 September 2026, reading the code. **Not fixed.**

```
menu entry        page heading and browser tab    file
Room types        The house                        pages/RoomSetup.tsx
Rate calendar     Inventory and rates              pages/Grids.tsx
```

`PageHeader` sets the tab from its title. `HANDOVER.md` § 6: the menu label,
the page heading and the browser tab say the same words. Which words stay is
a naming decision for the owner.

**Rule:** a screen is checked against its menu entry — the heading is the tab.

---

## Before the move — entries in the root MEMORY.md

- 63 · The system shipped prices nobody at the hotel had chosen
- 64 · Rewriting a function from memory to remove one line from it
- 65 · The invented prices had a second home in the frontend
- 69 · A screen that looked deliberately empty and was simply broken
- 70 · Two different questions arriving at one path
- 81 · A feature that could never fire
- 96 · The fourth copy of a rule was the wrong one
- 97 · A test helper that quietly performed the wrong verb
- 107 · Picking a fixture by sort order instead of by what it needs
- 117 · Two migrations of mine were not re-runnable
- 246 · "Rack rate ₹0" for a room type nobody had priced
