# Defects — finance

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `FIN-1`, `FIN-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### FIN-1 · A stale comment at the top of billing.ts

**Found** — 15 September, writing the brief.

The header still says no invoice number is issued and the night audit does not run. Both stopped being true at stage 8.

**The fix, when it is done** — Rewrite the header to what the file does now.

**The rule** — A comment that is out of date is a lie with a good reputation.

### FIN-2 · `getFolioBalance` returns 0 for a stay with no bill

**Found** — 15 September, writing the brief. **Unverified** — read, not run.

Check-out and In house read it. A stay with no folio may therefore read as a zero balance rather than as nothing to settle.

**The fix, when it is done** — Confirm first: open a stay with no folio and look. If it does return 0, return null and print a dash.

**The rule** — Zero and 'nothing here' are different answers; a balance may not blur them.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **6** · Three defects the ledger hid until new screens read it — Rule: a fixture is only as honest as the screens that have read it. Expect each new screen to find something, and fix the seed rather than the screen.
- **15** · A permission refusal that was a design note — Rule: when a permission refuses something reasonable, ask what the permission knows that you do not. Widening a grant to make an error go away removes the only thing that was telling you.
- **19** · The wall clock standing in for the business date, on four write paths
- **24** · A convenience UPDATE against an append-only ledger
- **30** · The same wrong question, asked in a second place
- **31** · An invoice that taxed the tax
- **33** · A partial index cannot see other rows
- **35** · A counter that was honest until it wasn't
- **36** · A list that invited a button it could only refuse
- **38** · A credit note whose lines did not sum to its own total
- **39** · The application shell would have printed with the invoice
- **55** · One posting cannot carry two tax rates
- **57** · Rupees on a document somebody pays from
- **78** · I wrote a folio posting from memory, again
- **82** · A field called `folioId` that held a stay id
- **83** · A picker keyed by a slug, into a column expecting a uuid
- **102** · A new column with a name the join already had
- **103** · The backfill only fixes rows that already exist
- **144** · A booking with nowhere to put money
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
