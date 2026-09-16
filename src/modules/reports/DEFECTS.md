# Defects — reports

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `REP-1`, `REP-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### REP-6 · "Owed by guests" on the Dashboard is a net figure under a gross label

**Found** — 16 September 2026, design critique; measured on screen the same day in the reports lane's own database.

The Dashboard's tile reads the Manager report's Guest ledger closing balance. Folios shows the same figure as **Net position**, "Owed to the property, less refunds": on the lane's demo data Outstanding ₹63,440 − Overpaid ₹784 = ₹62,656, and the tile says "Owed by guests ₹62,656 — Every guest bill still open". Guests owe ₹63,440; ₹784 is owed back to one of them. The label is a money claim.

**Not changed — the wording is the owner's.** Brought to them 16 September with a recommendation (CHANGELOG, 16 September). Whichever wording they choose, the `guestLedger` line in `src/lib/glossary.ts` ("the charges posted, less what they have paid") has to say the same, and that file is the master's.

**The rule** — A label on a figure is a claim about what the figure counts. Read the query before the word.

---

## Fixed

### REP-1 · Monthly occupancy and Monthly statistics always showed August 2026

**Found** — 15 September, writing the service's brief, by reading. **Fixed** — 16 September, branch `reports/typed-dates`.

`pages/Statistics.tsx` asked for `getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31")` on both monthly pages and printed "August 2026"; Yearly statistics asked for 2026. Deeper than first written: `data/reportData.ts` defaulted `getMonthlyStatistics` to the same August, `getYearlyStatistics` to 2026, and No show, City ledger and Lodging tax to a `from` of "2026-08-01"; and the server's yearly endpoint answered `?? 2026` when no year was sent.

**What was done** — `monthOf(date)` in `data/statistics.ts` gives the month's first and last day and its name; the three pages call it with the business date, and put the month in the query key so a property switch refetches. The monthly and yearly data calls take their range with no default; the three ledger defaults are `PTD_FROM`. The server's yearly endpoint takes the property's business date when no year is sent. The owner was not asked about a month chooser, so none was added: the pages show the business date's month, as the server already did when asked for no range.

**Proved** — `data/statistics.test.ts` (February in a leap year and not, December, January) failed with August put back in `monthOf`. `api/test/modules/reports/reports.test.ts` moves 5EL's business date to 10 May 2027 and reads the yearly grid as 2027; it failed with `?? 2026` put back. On screen at business dates 10 May 2027 and 10 February 2027: "May 2027", "February 2027" (1–28 Feb), "Year 2027".

**The rule** — A date typed into a screen is a date that stops being true.

### REP-2 · The Manager report's year started on 1 April 2026, typed in

**Found** — 15 September, writing the brief, by reading `manager.ts`. **Fixed** — 16 September, branch `reports/typed-dates`.

`const FY_START = "2026-04-01"` in `api/src/modules/reports/manager.ts` fed every YTD column. Correct until 31 March 2027, wrong from April 2027 — quietly. A second copy, `export const FY_START` in `data/managerReport.ts`, was read by nothing.

**What was done** — `financialYearStart(asOn)` on the server: 1 April of the report's own year from April, of the year before in January to March — the April rule of `app.current_fin_year()` (017), which could not be reused because it reads the wall clock. The web copy was removed, not corrected: the web has always taken `ytdFrom` from the server.

**Proved** — the API test asks for reports as on 25 Aug 2026, 10 Feb 2027, 31 Mar 2027, 1 Apr 2027, 10 May 2027 and 15 Jan 2028, and checks the YTD room-nights against the database's own sum over the window the label names — as on 10 May 2027 that is 680; with the literal put back it was 6,891 and the test failed. On screen as on 10 February 2027 the YTD column carried August 2026's ₹4,19,579 of room charges under "YTD from 1 Apr 2026".

**The rule** — A literal date is a bomb with a date on it.

### REP-3 · All reports opened a screen headed "Reports"

**Found** — 15 September, writing the brief; confirmed on screen 16 September in the route audit. **Fixed** — 16 September.

**What was done** — `pages/Index.tsx` is headed "All reports"; the browser tab follows (`PageHeader` sets it). Seen on screen: menu entry, heading and tab all read "All reports".

**The rule** — A screen's heading is the menu entry that opened it, or somebody has to check.

### REP-4 · A Manager report as on an earlier month ran its PTD from the business date's month

**Found** — 16 September, writing REP-2's test, by reading. **Fixed** the same day.

The server defaulted `ptdFrom` to `monthStart(businessDate)` rather than the report's own `asOn`. Asked for a report as on 10 February 2027 with no period, it ran PTD from 1 August 2026. Nobody saw it because the web always sends `ptdFrom`. Now `monthStart(asOn)` — identical whenever `asOn` is not sent. The API test failed with the old line put back ("period start for 2027-02-10: expected '2026-08-01'").

**The rule** — A default derived from one date belongs to the date the caller asked about, not the one the server happens to know.

### REP-5 · The STATISTICS block printed `3952.80` beside the Dashboard's `₹3,953`

**Found** — 16 September, design critique. **Fixed** the same day.

Every row of the Manager report's Statistics block went through one local count formatter — no ₹, no grouping, two decimals.

**What was done** — the server marks each Statistics row with its `unit` (`money` or `percent`); the page prints them through `money()` and `percent(n, 2)` from `src/lib/format.ts`. On screen as on 25 Aug 2026 the block reads what the Dashboard tiles read: 29.41% · 30.63% · 5.27%, ₹5,505 · ₹3,179 · ₹3,179, ₹1,619 · ₹974 · ₹168. The API test that pins the units failed with them removed. The report's footer stamp is labelled "Printed" in the same change.

**The rule** — A figure is formatted by what it is, and the row that knows what it is says so.

### REP-7 · MINE: a deliberate break that never applied, in a run that looked complete

**Found** — 16 September, proving REP-1's server guard.

Four breaks ran in one script. The third was a Python replacement that asserted its old text was present; the file has CRLF endings and the text did not match, so the assertion stopped that step and the script went on to the fourth. Its summary showed three failing runs and no line for the third at all. Caught by counting the "BREAK" headings, re-run with line endings normalised, and seen to fail.

**The rule** — A proof that disables a guard reports that the break applied, not only what the tests said. Count the breaks that ran.

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **6** · Three defects the ledger hid until new screens read it — Rule: a fixture is only as honest as the screens that have read it. Expect each new screen to find something, and fix the seed rather than the screen.
- **40** · A boolean where a document should have been
- **43** · A revenue total that ignored every discount
- **44** · A GST register dated by the wall clock
- **135** · Four reports built, listed, and unreachable
- **147** · A date typed once, on the screen an owner opens first
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **253** · The Manager Report's period started on 1 August, whatever the month
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.
- **266** · The City ledger invented a contact person for every account — since 28 August — The rule: "never invent" covers words as well as numbers. A placeholder that looks like data is data to whoever reads it.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
