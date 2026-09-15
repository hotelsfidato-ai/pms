# Guests and companies — memory

This service's defects and lessons. A new defect found in this service is
numbered here with the prefix **GUE-** — GUE-1, GUE-2, … — in the root
`MEMORY.md`'s shape: what happened, how it was found, whether it is fixed,
and the rule it teaches. A lesson that applies to the whole project still
goes in the root `MEMORY.md` with a plain number — 275 was the next free one
on 15 September; check the root file before taking one.

---

### GUE-1 · "Companies and agents" opens a screen headed "Booking sources"

Found 15 September while writing this service's brief, reading
`pages/Guests.tsx`. **Seen in the code, not yet on screen; not fixed.**

The menu entry for `/companies` has read "Companies and agents" since MEMORY
228 renamed it (9 September): two entries called "Booking sources" were one
too many. The screen behind it was not renamed. `CompaniesPage` still
passes `title="Booking sources"` to `PageHeader`, which also sets the browser
tab (`useDocumentTitle`). So a person who taps "Companies and agents" lands
on a page — and a tab — called "Booking sources", the same words as the real
Booking sources screen under Configuration. The clarity plan's rule
(15 September): the menu label, the page heading and the browser tab say the
same words (`HANDOVER.md` § 6).

No guard could catch it: `navigation.test.ts` compares menu labels with each
other, not with the heading each one opens. The heading dates from
`d2633b5` (4 September).

**The fix, not made here:** the heading "Companies and agents". Worth
proposing to the core owner: a test that each menu label matches the heading
its screen draws.

**The rule: a rename covers every place a thing is named — menu, heading and
tab — in one change.** MEMORY 228 renamed one of three.

---

## Before the move — entries in the root MEMORY.md

Read the bodies there. Number · title:

- 32 · Reading a migration instead of the database, twice more
- 40 · A boolean where a document should have been
- 41 · The demo loader leaked its guests, 249 of them
- 83 · A picker keyed by a slug, into a column expecting a uuid
- 135 · Four reports built, listed, and unreachable
- 219 · Five copies of one label, and the fifth said "Walk-in" about Agoda
- 220 · A data-modifying CTE read back by its own statement — 202, twice, in one afternoon
- 228 · Two menu entries called "Booking sources", and I made the second
- 242 · "Required" went on one of the two doors a booking comes through
