# Memory — the store

What this service learned the hard way. Read it before your first edit here.

**New defects for this service are numbered with its prefix: STO-1, STO-2,
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

- 161 · A single-column foreign key is not tenancy integrity
- 162 · A constraint that is dropped and re-added is not re-runnable
- 184 · Three roles the screen offered and the database refused
- 222 · The approvals engine has never had a caller, and still does not

184 is here because a store keeper signed in as a viewer until 078; 222
because its `stock_adjustment` and `purchase` kinds are the store's, and
nothing can raise one.
