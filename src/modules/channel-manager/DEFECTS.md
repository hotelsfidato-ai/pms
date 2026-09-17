# Defects — the channel manager

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `CM-1`, `CM-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### CM-1 · The demo loader, run from this copy, aimed at the main development database

**Found** — 17 September, setting up `D:\fidato-channel-manager` to open the
status page. I ran `npm run load-demo` in the copy's `api/`, expecting it to use
the copy's `api/.env` (`fidato_channel_manager`). It does not read `DATABASE_URL`:
it connects to `SUPER_DATABASE_URL`, or to `fidato` when that is unset. So it
connected to the **master's development database** as the superuser and began
its teardown of 5EL there, triggers lifted.

**What stopped it** — the teardown runs in one transaction, and the cascade from
the hotel reached `stock_movements`, which is append-only and refused ("Post a
reversing entry instead of DELETE"). The error rolled the whole transaction back,
the trigger changes with it (Postgres DDL is transactional).

**Checked afterwards, in `fidato`** — the five lifted triggers are enabled again
(`hotels_no_delete`, `folio_postings_append_only`, `invoices_immutable`,
`pos_order_lines_frozen`, `guests_no_delete`, all `O`); 5EL is there with its 86
reservations, 32 guests and 1 stock movement. Nothing was committed.

**What was done** — the demo went into this copy's own database the way the test
harness does it (`db/tests/harness.sql` and `suite.sql`, the dev identities,
then `load-demo` with `SUPER_DATABASE_URL` naming `fidato_channel_manager`). The
script itself is not this service's: asked of the master (MODULE.md, Requests 1).
Lesson sent for the root `MEMORY.md`.

**The rule** — Before running a script from a copy, read its connection line. A
script that falls back to a default database reaches the master's data from any
copy, and "it uses my settings file" is a guess until the line says so.

---

## Fixed — the solution is here; do not work it out again

### CM-3 · Part 1 shipped code the production server cannot load — FIXED 17 September

**Found** — 17 September, by the master, after part 1 was merged into cp6:
`cd api && npm run strip-check` went red, and it had been red since that merge.

`su/token.ts` and `su/client.ts` declared their fields as constructor parameter
properties (`constructor(private readonly settings: SuSettings, …)`). The server
runs Node with type stripping, which removes the types and emits nothing else, so
a parameter property is never assigned: the process cannot load the file. The next
deploy would have failed to start, and nothing I ran would have said so. `tsc`
accepts them, the tests pass (vitest compiles properly), and the gates I quoted
were `tsc`, vitest, the database suite and the build. `strip-check` is in
`api/package.json` and I never ran it.

**What was done** — both classes declare their fields and assign them in the
constructor; no other change. `npm run strip-check`: 97 files load. It is now in
this service's gate list (MODULE.md). The master fixed the same two constructors
on cp6 the same evening, so when cp6 is merged here, theirs wins: the two are the
same shape.

**The rule** — Run every gate the service's own `package.json` defines, not the
ones you remember. A gate you have never run is a gate you do not have.

### CM-2 · `su/runtime.ts` was committed with two NUL bytes in it — FIXED 17 September

**Found** — 17 September, reading the stat of part 1's commit (`101e6c2`): git
listed `api/src/modules/channel-manager/su/runtime.ts` as `Bin`. The cache key
was written as a template string with `NUL` separators, and the file was saved
with the actual NUL character rather than the escape written for it. Typescript,
tsx and the tests were all content with it, so no gate saw it; git treats the file
as binary, so its diffs and merges would show nothing readable.

**What was done** — the key is `JSON.stringify([environment, clientId, secret])`,
plain text. Every file in the three channel-manager folders scanned for a NUL
byte: none. `tsc` clean and the 18 tests pass after the change.

**The rule** — Read the commit's stat, not only its message. A source file git
calls binary has a byte in it nobody meant to type. (Writing this entry put a
third one into this file the same way: the editor turns the escape into the
character. Name it in words, never as the escape.)

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **81** · A feature that could never fire
- **96** · The fourth copy of a rule was the wrong one

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
