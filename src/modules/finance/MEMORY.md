# Finance — memory

This service's defects and lessons. A new defect found in this service is
numbered here with the prefix **FIN-** — FIN-1, FIN-2, … — in the root
`MEMORY.md`'s shape: what happened, how it was found, whether it is fixed,
and the rule it teaches. A lesson that applies to the whole project still
goes in the root `MEMORY.md` with a plain number — 275 was the next free one
on 15 September; check the root file before taking one.

---

### FIN-1 · A file header that says two built things are not built

Found 15 September while writing this service's brief, reading
`api/src/modules/finance/billing.ts` at `c804aa2`. **A comment, not a screen;
not fixed.**

The file's header still says "NO INVOICE NUMBER IS ISSUED" — while
`invoices.ts`, beside it, issues them — and "THE NIGHT AUDIT DOES NOT RUN …
the business date is still a constant" — while the night audit runs and the
business date has moved on each completed run since 023. The server split
(`489271d`) put a correct note under it saying what the file keeps now, and
left the old header above it. Nobody at the hotel reads it; the next agent
does, and would believe two finished features are missing — the shape of
MEMORY 137, one layer down.

**The fix, not made here:** replace the header with what the file does now:
receipts and billable folios.

**The rule: when a file is split or moved, its header is part of the move.**

---

## Before the move — entries in the root MEMORY.md

Read the bodies there. Number · title:

- 6 · Three defects the ledger hid until new screens read it
- 15 · A permission refusal that was a design note
- 19 · The wall clock standing in for the business date, on four write paths
- 24 · A convenience UPDATE against an append-only ledger
- 30 · The same wrong question, asked in a second place
- 31 · An invoice that taxed the tax
- 33 · A partial index cannot see other rows
- 35 · A counter that was honest until it wasn't
- 36 · A list that invited a button it could only refuse
- 38 · A credit note whose lines did not sum to its own total
- 39 · The application shell would have printed with the invoice
- 55 · One posting cannot carry two tax rates
- 57 · Rupees on a document somebody pays from
- 78 · I wrote a folio posting from memory, again
- 82 · A field called `folioId` that held a stay id
- 83 · A picker keyed by a slug, into a column expecting a uuid
- 102 · A new column with a name the join already had
- 103 · The backfill only fixes rows that already exist
- 144 · A booking with nowhere to put money
- 256 · Every report printed one hotel's name, and the wrong person's
