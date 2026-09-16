# Defects — the night audit

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `NA-1`, `NA-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### NA-1 · Two night-audit routes have no caller

**Found** — 15 September by the brief; confirmed 16 September by the route audit.

`GET /:code/night-audit/can-run` and `GET /:code/night-audit/runs` answer, and no screen asks. The screen shows blockers and the run; the history has no page.

**Investigated 16 September — read-only, nothing changed.** Neither route writes
anything: both are a `withSession` with `select`s only. The one that writes to
folios, `POST /run`, has a caller (the Run button). All three were born in one
commit, `2a8076e` (29 August, "Stage 5"), and **no screen has ever called either
GET** — in that same commit the screen was wired to the checklist
(`GET /:code/night-audit`, then in `billing.ts`), which was given its own
`canRun` from `blockersFor`.

- **`can-run` — superseded at birth, with one difference that matters.** Its
  blockers reach the screen already, through the checklist. But it answers for
  the **server's** business date, and the checklist answers for the `asOn` the
  browser sends. That difference is NA-2. Its "already closed" branch can never
  fire: `app.business_date()` is the day after the last completed run, so the
  server's date never has one. Callers: five assertions in
  `api/test/modules/night-audit/nightAudit.test.ts`.
- **`runs` — a missing screen.** `PROGRESS.md`, Stage 5, unit 9, *"history —
  what has been closed · /night-audit/runs ✓"*, was scored built on the endpoint
  alone; unit 10, the screen, is "blockers, run, result" and has no history. The
  page shows only "Last run: <date>". Caller: `api/scripts/capture-demo.ts`,
  into `src/data/demo-snapshot.json`, which no screen reads either.

Nothing ever writes `status = 'failed'` or `error_message` (grep, `api/src`): the
run is one transaction, so a failure rolls its `running` row back with it. A
history screen today would list completed days only.

**The fix, when it is done** — the owner decides (`HANDOVER.md` § 3.0g lists
NA-1 under OWNER DECIDES). Recommended: keep `runs` and give the Night audit
screen a history of closed days; keep `can-run` until NA-2 is decided, because
it is the one route that already knows the server's date.

**The rule** — A route with no caller is either a missing screen or dead weight.
**A checklist unit ticked on an endpoint alone is a missing screen, not a built
feature.**

---

### NA-2 · A Night audit screen that is out of date closes the NEXT day

**Found** — 16 September, reading `can-run` for NA-1. **Proved** the same day
with a throwaway API test on the harness's scratch database (deleted after one
run, not committed).

The browser learns the business date at sign-in and on a property switch
(`src/lib/session.ts`), and only this screen's own success refreshes it. The
checklist is asked for that date (`?asOn=`), and never says whether the date is
already closed. `POST /run` takes no date: it closes whatever day the server is
on. So a screen left open while the day was closed somewhere else — another
device, another tab, or a first press whose answer never came back on a bad line
— still says "closing D, opening D+1" with Run enabled, and **Run closes D+1**.

Measured at Pune on the scratch database:

```
screen loaded       closing 2026-09-16 · opening 2026-09-17 · Run allowed
somebody else       closed 2026-09-16
stale screen        closing 2026-09-16 · opening 2026-09-17 · Run allowed
                    · "Last run: 16 Sep 2026"   ← the only sign, in small print
can-run (no caller) businessDate 2026-09-17
Run pressed         ok · duplicate: false · CLOSED 2026-09-17 · 1 no-show
tomorrow's arrival  status no_show · room released (073)
server date after   2026-09-18
```

It posts the next night's room charge for every stay in house, marks the next
day's confirmed arrivals as no-shows (with retention where their terms say so),
and releases their rooms. **It needs nobody to be due out on D+1** — otherwise
`blockersFor` refuses, with a reason about departures that does not say the day
is already closed. The run's own comment says a retried request gets the first
run's answer ("Answer with what that run did, rather than an error"); that
branch cannot be reached, for the reason given under NA-1.

**Production, read-only, 16 September:** 5 Elements closed **9 September and
10 September in the same minute** (both started and completed 10 Sep 16:01 IST,
0 rooms posted, 0 no-shows). Whether that was a deliberate catch-up or this
defect, only the owner knows. The property has closed nothing since: its
business date is **11 September**, and the 17 postings dated 11 September were
made between 10 and 16 September.

**Not fixed.** Any fix changes a condition of what the audit posts, marks or
moves, which needs the owner's explicit yes. Recommended: the screen sends the
date it is showing, and the server refuses a run for any other date — "11 Sep
is already closed; this property is on 12 Sep. Reload before running again."

**The rule** — An action that moves something forward must say which step it
expects to move from. A comment promising idempotence is a claim: find the
state in which its branch runs, or it is not there.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **19** · The wall clock standing in for the business date, on four write paths
- **26** · The date moved and the interface never found out
- **27** · Fixtures that test the audit, and the audit that ate the fixture
- **78** · I wrote a folio posting from memory, again
- **81** · A feature that could never fire
- **102** · A new column with a name the join already had
- **103** · The backfill only fixes rows that already exist
- **114** · The leak was load-bearing
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **171** · A moved guest was charged for the night TWICE
- **176** · Every no-show took a room out of sale, silently
- **177** · The fix moved the fault instead of removing it

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
