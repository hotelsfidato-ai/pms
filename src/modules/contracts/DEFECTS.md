# Defects — contracts

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `CON-1`, `CON-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### CON-3 · The booking sites are company records, and C-9 would refuse their Bill to company (numbered for now)

**Found** 30 September, reading the demo loader while writing the credit
refusal. `api/scripts/load-demo.ts` files Agoda, Booking.com, Expedia,
go-MMT and Fidato Hotels as COMPANIES and puts them on their stays; live may
hold the same rows. A booking site pays later, so its stays are settled Bill
to company, which C-9 now refuses for a company not allowed credit, and
migration 177 allows credit only for companies already billed on credit.
**What was done:** the question is with the owner through the master
(recommendation: the migration also allows credit for companies named like
an `ota` booking source). `reports.test.ts`'s city ledger test sends a demo
stay's bill to its company and waits on the same answer. **The rule:** before
a new refusal on a payment, find every kind of row that pays that way today.

## Fixed

### CON-1 · An administrator could not change a company (numbered for now)

**Found** 30 September, reading 013 before writing Edit company. The matrix
gives the administrator `company: edit`, but 013's `companies_update` policy
let only the owner and the GM (`app.is_manager`), so an administrator's edit
would have changed nothing and said nothing. **Fixed** in the contracts
migration: `app.keeps_companies()` (owner, administrator, GM, group
administrator) for companies, contracts and contract rates;
`db/tests/modules/contracts.sql` checks that an administrator's change lands.
**The rule:** a new write route checks the row policy under it, not only the
matrix.

### CON-2 · A credit limit nobody set read as 0 (numbered for now)

**Found** 30 September. 004 gave `companies.credit_limit` and `credit_days` a
default of 0, written and read by nothing: a zero where nothing was agreed.
**Fixed** in the contracts migration: both nullable with no default, the
zeros made NULL once, and 0 refused from then on (a dash on screen). **The
rule:** no default prices, credit included.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
