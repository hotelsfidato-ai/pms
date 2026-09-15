# Memory — reports

What this service learned the hard way. Read it before your first edit here.

**New defects for this service are numbered with its prefix: REP-1, REP-2,
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

### REP-1 · Monthly occupancy and Monthly statistics always show August 2026

Found 15 September 2026 while writing this service's brief, by reading the
code. **Not fixed.** The screens were not opened.

`pages/Statistics.tsx` asks for
`getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31")` on both monthly
pages and prints "August 2026" as the period. Yearly statistics asks for
`2026` and prints "2026". Nothing on any of the three lets a person choose
another month or year. The properties now run on their real dates
(`PROGRESS.md`, "What the owner has decided"), so on the day this was written
both monthly reports show last month, and the yearly one will stop at 2026.

The same shape as root MEMORY 147 and 253: a date typed once is right once.

**Rule:** a report's period is derived from the business date or chosen by a
person — never typed. When a period is fixed, grep the folder for literal
dates (`2026-`).

### REP-2 · The year to date always starts on 1 April 2026

Found 15 September 2026, reading the code. **Not fixed** — correct until
31 March 2027.

`api/src/routes/manager.ts` line 27, `const FY_START = "2026-04-01"`, is the
start of every year-to-date window (line 167) and is printed as "YTD from"
(line 303). The Manager report and the Dashboard both read it. From 1 April
2027 the YTD column will run across two financial years. `FY_START` in
`data/managerReport.ts` is the same literal, and nothing in the web app
imports it. The glossary's YTD line ("from 1 April") is true only while this
holds.

Root MEMORY 253 fixed the same thing for the month so far.

**Rule:** a financial year's start is derived from the as-on date, the way
the month's start already is.

### REP-3 · All reports is headed "Reports"

Found 15 September 2026, reading the code. **Not fixed.**

The menu entry is "All reports" (`nav.ts`). `pages/Index.tsx` draws
`PageHeader title="Reports"`, and `PageHeader` sets the browser tab from it.
`HANDOVER.md` § 6: the menu label, the page heading and the browser tab say
the same words. Which one stays is a naming decision for the owner.

**Rule:** a screen is checked against its menu entry — the heading is the tab.

---

## Before the move — entries in the root MEMORY.md

- 6 · Three defects the ledger hid until new screens read it
- 40 · A boolean where a document should have been
- 43 · A revenue total that ignored every discount
- 44 · A GST register dated by the wall clock
- 135 · Four reports built, listed, and unreachable
- 147 · A date typed once, on the screen an owner opens first
- 169 · The dashboard said 5 arrivals due; the night audit said 2
- 219 · Five copies of one label, and the fifth said "Walk-in" about Agoda
- 253 · The Manager Report's period started on 1 August, whatever the month
- 256 · Every report printed one hotel's name, and the wrong person's
- 266 · The City ledger invented a contact person for every account — since 28 August
- Open · two "in house" numbers for the same moment (unnumbered, at the end of the root file)

Also in the root file, and binding here: "Numbers that are real, and one
that is not" and "Money".
