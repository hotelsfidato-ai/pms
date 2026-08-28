# Parallel seam — the builder agent's version, quarantined

The agent began a second repository architecture at 21:33–21:34 on
2026-08-27 while the auditor session was mid-way through CP5, and
stopped after two of the eight modules its `index.ts` declared. That
left six unresolvable imports and a broken dev server.

These two files are kept here rather than deleted so nothing is lost.

## Why the other version was kept

|  | Kept (`src/data/repositories`) | Here |
|---|---|---|
| Shape | free functions — `listRooms(hotelId)` | objects — `roomRepo.list(hotelId)` |
| Data source | the mutable store | fixtures, read directly |
| Mutation | supported — check-in, charges, settle | none — data is frozen |
| Latency | resolves immediately | `setTimeout` delay |

Both honour `hotelId`-first, and neither is wrong in isolation. The
deciding factor is CP5: the five flows have to *change* something. A
check-in that does not visibly drop the arrivals count has not been
demonstrated, and repositories reading frozen fixtures cannot express
that.

The simulated latency here is a genuinely good idea and is worth
lifting into the kept version if loading states need exercising.
