# Changelog — Room systems

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

---

## 2026-09-30 to 10-02 · Key cards against a stand-in lock (D27-178, D27-182)

**Asked for:** key cards issued at check-in (how many, valid to the check-out
time), re-issued, cancelled at check-out or a room move, a lost-card cancel,
each recorded against the stay; room controls where a vendor supports them.
The vendor is unknown, so research first, then a vendor-neutral interface and
ONE stand-in. The owner (D27-182): not at the pilot, stand-in only and off;
whoever may check in, lost card too; 1 to 4 cards starting at the adults; no
room controls (card-slot savers); the menu keeps "Not built yet".

**Shipped**
- Migration 179 `key_cards` (append-only, row security, the person forced).
- `api/src/modules/room-systems`: `locks.ts` (the two FIAS acts, the stand-in,
  refused under NODE_ENV=production, two server settings), `keys.ts`
  (GET/POST `/:code/stays/:id/keys`, `cancelStaleKeys`).
- `KeyCards` in the stay drawer; the Coming soon page reworded.
- Outside the service, one line or call each (the master's T2): server.ts,
  roleGate.ts + pin, front desk's check-out, move, exchange, StayDrawer.
- 2 Oct: merged cp6 ffda580a (four conflicts, both sides kept; migration
  renumbered 175 -> 179); a day use is refused cards in words (RS-3).

**Found:** RS-1 (a vacuous "draws nothing" test), RS-2 (a bad stay id was a
500), RS-3 (a day use would have been refused "departure has passed").
Two for the master, both already fixed on cp6 by 2 Oct: the demo reload on a
database with KOT events, and front desk's inclusions 500 on a bad id.
MINE: on 2 Oct I sent a "wait for no psql" and my API test run together, so
the test build started while another lane's psql ran; nothing broke, and
every later run waited first.

**Proved** (2 Oct, on the merged tree, each run alone on the shared Postgres)
- API `keys.test.ts` 13/13 on a scratch database with 177 migrations; each
  front-desk call, the move-tomorrow rule, RS-2 and the day-use refusal seen
  failing when removed. `roleGate.test.ts` 67/67. Front desk's API tests and
  apiGate: 8 files, 91/91. (30 Sep: roleGate was flaky under load, 60/61 then
  61/61.)
- Database: harness + room-systems.sql on fidato_s43, 7/7; two rules broken in
  a rolled-back transaction and seen failing (30 Sep).
- Web: api tsc and web tsc -b --force clean. Front desk, room systems, App and
  the guards: 19 files, 113 tests, 112 passed, 1 failed - migrationNumbers on
  the 177-178 gap (contracts' and loyalty's numbers).
- Screens, the app's browser pane, 5EL as Reception, the stand-in on: the panel
  under the ID photo; a stay departed by the real clock refused in words, with
  nothing recorded; 2 cards cut ("until 5 Oct 2026, 11:00 AM"); Lost card's
  dialog (centred, measured) and its two rows; the warning after a one-night
  extension; Move to another room through the screen cancels and records
  "the guest changed rooms". Housekeeping and the revenue manager refused 403
  in the gate's words; the GM allowed.

**Left open:** Q1, which lock 5 Elements has (the owner's photos); then one
driver in `locks.ts`. A day use's end time, if the owner wants cards for day
use. The stand-in stays off on the live server.

**Commits:** `8bb547b` `8df97d5` `ee2d637` `d290b5a` `7ed0b51` `528aa18`
`16d42ae` `29a3731` merge `848b9ade` `541c35a4`, and this entry's.

## 2026-09-16 · Moved here from "Hotel equipment"

**Asked for:** the owner gave the word Equipment to the register of durable
things (S2). The door-lock, phone, minibar and TV content moved from the
`equipment` service's Coming soon page into this folder, unchanged.
