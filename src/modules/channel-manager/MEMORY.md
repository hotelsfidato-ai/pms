# Memory — channel manager

What this service learned the hard way. It is parked by the owner and has no
code beyond a status page, so there is little here yet.

**New defects for this service are numbered with its prefix: CM-1, CM-2,
and so on**, each with what broke, how it was found, whether it is fixed, and
the rule it teaches (`HANDOVER.md` § 5: every mistake is recorded, numbered).
Newest at the bottom of the numbered list.

Project-wide lessons — anything that would bite another service too — stay in
the root `MEMORY.md` with plain numbers. When this file was written
(15 September 2026) the next free root number was 273; 272 is already cited
in `src/data/repositories/repositories.test.ts`. Check the root file before
taking one.

---

## Defects found since the move

None yet.

---

## Before the move — entries in the root MEMORY.md

Two entries record decisions made so that a channel manager would fit
later — read them before building one:

- 81 · A feature that could never fire
- 96 · The fourth copy of a rule was the wrong one

81: cancellation terms attach to a booking by trigger, "however the booking
is made … and the channel manager later". 96: every price write goes through
`app.set_rate`, because "the channel manager will price dates too".
