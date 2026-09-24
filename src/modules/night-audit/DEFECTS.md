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

### NA-4 · A web test cannot see a refusal's payload

**Found** — 17 September, building D17-12's record card. **Not this service's
to fix** — `src/test/setup.ts` is core; reported to the master.

The shared test setup replaces `ApiError` with `StubApiError`, whose
constructor takes `(status, message)` and drops the third argument. So in every
web test, `new ApiError(409, sentence, { reason, … })` arrives with **no
`body`**. The real class keeps it (`this.body=r` in the built bundle, checked).
Screens that read `error.body?.reason ?? error.message` still pass, because the
sentence is also the message — which is how nobody noticed. A screen that needs
more than the sentence (this one's record) cannot be tested through the stub
at all: its test goes green on the message and never
reaches the payload branch.

**Done here:** `nightAudit.test.tsx` attaches the body the way the real class
stores it (`refusalWith`). **For the master:** give `StubApiError` the third
parameter.

**The rule** — A stub of a class the screens branch on must keep every field
they read, or the branch it drops is untested everywhere at once.

---

## Fixed

### NA-5 · A walk-in staying two nights or more was charged twice from the second night

**Found** 24 September, opening the correction screen on a closed day in a
service copy: the Night Audit report for 26 August showed ₹14,063.04 of room
charges for two rooms whose nights came to ₹7,031.52.

A walk-in posts its whole stay on arrival, one line: "Room 201 · 2 nights"
(front desk, `operations.ts`; the owner's D17-33). The audit's "already
charged tonight?" asked only for a room line **dated tonight**, so on the second
night it found none and posted the night again. Every multi-night walk-in, every
night after the first. The reports spread the whole-stay line over its nights
(D17-71) and counted the audit's line as well, so they doubled too.

**Fixed** (the owner's D24-14): a room line counts for every night it pays for,
read with the reports' own `POSTING_NIGHTS`. Nothing else the audit posts
changed. Test: `nightAudit.test.ts`, "does not charge a night a walk-in's
whole-stay line already paid for" - with the old condition it failed
`expected '2' to be '1'`.

**Not done:** live bills were not looked at. Any double charge already there is
taken off on Closed days by the GM, with a reason (D24-14); one on a bill that
has a tax invoice needs a credit note.

**The rule** - a guard against charging twice must ask about every line that
could already have paid, not only the lines this code writes itself.

### NA-6 · The desk's Reverse on a line of a closed day said "Something went wrong"

**Found** 23 September by the plan (`docs/briefs/closed-day-correction-plan.md`,
finding 1), read in the code. A reversal is posted on its line's own date, the
database refuses a closed date (012), and the server answered 500.

**Fixed** (D24-9, D24-13), in finance's `postings.ts`, before any write: a room
or no-show charge "This day is closed - correct it on Closed days."; anything
else "This day is closed. Only its room and no-show charges can be corrected, on
Closed days." Seen on the screen 24 September. Tests in `corrections.test.ts`.

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

**Fixed 17 September — the owner's D17-13:** "a history of closed days on the
Night audit screen: who ran it, rooms posted, revenue, no-shows". `runs` is now
the screen's **Closed days** list, and lists completed days only. "Who ran it"
needed no migration — `night_audit_runs.run_by` has existed since 006 and the
run never wrote it; it does now, and the name is read through
`app.colleague_name` (096), never a join to `staff` (MEMORY 283). **Every day
closed before 17 September shows a dash under "Ran by"**: nobody was recorded,
and nothing is inferred. `can-run` still has no caller; the owner did not
decide it, and it writes nothing.

Guarded by the API test "the closed days" and the web tests "lists the closed
days, with a dash where the record holds nothing" and "says what belongs in the
list when no day has been closed" — each seen to fail against the code before.

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

**Fixed 16 September** (`91f7bb7`), on the owner's decision of the same day,
relayed by the master: **refuse a stale close.** The Run button sends the day
the heading names (`runNightAudit(hotelId, closing)`); `POST /run` asks, before
anything is written, whether that day already has a completed run, and if so
answers 409 — *"16 September was already closed. Reload to see today."* — and
changes nothing. A date that is not a date is a 400. A caller that sends no
date is answered as before (none does: the screen always sends one). What the
audit posts, marks and moves is unchanged.

Guarded by, each run against the code before the change and seen to fail:

```
api  "a stale screen › refuses to close a day that is already closed,
     and changes nothing"          old code: 200, closed 2026-09-22, 1 no-show
api  "… refuses a date that is not a date"          old code: not a 400
web  src/modules/night-audit/nightAudit.test.tsx    old page: "Run sent no date"
```

The existing test "answers a re-run of a day already closed with what that run
did" never sent a request — it read the run row — so the branch it named had
never been exercised. Renamed to what it checks.

**The rule** — An action that moves something forward must say which step it
expects to move from. A comment promising idempotence is a claim: find the
state in which its branch runs, or it is not there. **And a test's name is a
claim too: read what it sends.**

---

### NA-3 · Two presses at the same moment leave the day's record at zero

**Found** — 16 September, by reading the run while fixing NA-2. **Proved** the
same day with a throwaway API test on the harness's scratch database (deleted
after one run, not committed): two `POST /run` for the same day, fired
together.

```
press A           200 · ok · closed 2026-09-16 · roomsPosted 0 · revenue 0
press B           200 · ok · closed 2026-09-16 · roomsPosted 1 · revenue 2500
actually posted   1 room charge, ₹2,500 — the guest charged ONCE
business date     2026-09-17 — moved ONE day
night_audit_runs  completed · rooms_posted 0 · revenue_posted 0.00 · no_shows 0
```

**No money is wrong** — the charge is guarded per stay, the no-shows are
already marked, and the date moves once. **The day's record is wrong**, and one
of the two people is told "0 rooms posted". Why: neither transaction can see the
other's uncommitted run row, so both pass every check; the second waits on the
unique index, and when the first commits, `on conflict … do update set status =
'running'` takes the COMPLETED row back to running, finds nothing left to post,
and completes it again with its own zeros. `006_folio.sql` describes a
`pg_advisory_xact_lock('night_audit:' || hotel_id)` for exactly this; the route
never takes it.

NA-2's fix does not reach it: both presses send the same, not-yet-closed day.
The Run button is disabled while its own request runs, so it takes two devices
(or two tabs) in the same second.

**Fixed 17 September — the owner's D17-12:** "a day already closed is not run
again: a second press — at the same moment or later — changes nothing and shows
the record that was made. Any correction to a closed day's record needs the GM."

- **The lock.** `POST /run` takes `pg_advisory_xact_lock('night_audit:' ||
  hotel)` first, so a second press waits for the first to commit and then meets
  the check that follows.
- **The record.** A day already closed answers 409 with the sentence NA-2 gave
  it *and* `alreadyClosed: true, record: { ranBy, completedAt, roomsPosted,
  revenuePosted, noShows }`. The screen shows it in a plain card, not the red
  one: "Nothing was run again. The record that was made: …".
- **The day is required.** A press that names no day would be answered with
  whatever day the server is on — tomorrow, a moment after somebody else closed
  today — so it is a 400. A day the property is not on is refused too ("This
  property is on 17 September, not 18 September. Reload to see today."). No
  screen sends either: the Run button has sent its day since NA-2.
- **The GM.** Migration **099** refuses any change to a COMPLETED run from
  anyone who does not manage the property (`app.manages_hotel`: the property's
  owner or GM, or a group administrator). The audit completing its own run, a
  run still running, and filling a `run_by` nobody recorded are not
  corrections. There is no screen for correcting a record; this is the rule
  for whatever writes one.

Guarded by, each run against the code before the change and seen to fail:

```
api  "closes a day ONCE when two presses arrive together, and the second sees
     the record" — both presses held at a table lock until BOTH are seen
     waiting, then let go. Old code: both answered 200.
api  "refuses to close a day that is already closed…" — now also the record
api  "refuses a run that does not say which day…" — old code: 200, closed a day
api  "refuses to close a day the property is not on…" — old code: 200
db   db/tests/modules/night-audit.sql, "closed day record" — 11 assertions;
     without 099 a clerk's four corrections all went through
web  "sends the day it shows, and shows the record of a day already closed"
```

**The rule** — A uniqueness constraint stops a second row, not a second
writer. `on conflict do update` on a row somebody else just finished is an
overwrite, not a retry. **And a race test that relies on two requests
happening to overlap proves nothing: make them meet.**

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
