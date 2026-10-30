# Defects — guests

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `GUE-1`, `GUE-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

Nothing.

---

## Fixed

### GUE-6 · A companion in the room is never on the register - FIXED 30 October (D27-382)

**Found** - 27 September (D27-25). A booking knows its lead guest only; Rule
17 counts every foreigner. The owner chose a warning on the register and a
portal number per person, not each companion's own details - so their
particulars are typed on the portal from their passports and are not kept
here.

**What was done** - the owner's D27-382: every adult is recorded, entered at
check-in or later, and check-in is never blocked. A companion IS a guest:
`guests`, `guest_documents`, their own `form_iii_stays` row (`guest_id` set; null
is the lead), tied to the stay by `stay_companions` (migration "every adult in a
room"). `app.form_iii_people` gives each foreigner a row with their own numbers;
`app.stay_recorded` counts the lead and each companion with a number on record.
Routes in `companions.ts`, on their own call: `POST /check-in` knows nothing of
them, so none can stop it. `StayCompanions` on the check-in window, the stay
panel and a walk-in's card. The full reset's `owner_reset.orphans` would have
taken every companion in the group (no booking of their own, so "no stay
elsewhere"): it now asks. `companions.test.ts`, `companions.test.tsx`,
`db/tests/modules/guests.sql`, `db/tests/modules/admin.sql`,
`db/tests/restore-hotel.sh`.

**The rule** - before a person can exist with no booking, every query that
reads "has a booking" as "is real" is a bug waiting: the document policies and
the reset's orphans both read it so, and neither had a test that could see it.

---

### GUE-5 · A passport skipped at check-in has nowhere to be recorded later - FIXED 30 October (D27-382)

**Found** - 27 September, building Form III (D27-25). Check-in lets the ID be
skipped for a reason ("scanner offline"), and nothing afterwards records the
document number: "Complete details" on the Form III register records every
other field, not the document's type and number. The register shows "not on
record" for as long as it lasts.

**What was done** - the owner's answer, D27-382: `Document` and `Number` on
Complete details (`pages/FormC.tsx`), sent only when changed, so a number on
file is not asked of today's rules because a clerk filled in another box. The
same check as check-in, on the screen (`idNumberProblem`) and on the server
(`identityProblem`, `PUT .../details`, which already took them). The row then
shows the number. `formIII.test.tsx`, `api/test/modules/guests/formIII.test.ts`.

**The rule** - a field the server takes and no screen sends is half a feature:
a defect log's "it is just the two fields" is the fix, waiting.

---

### GUE-7 · No screen could correct a guest, and the ID rules let nonsense through - FIXED 28 September (QA GU-1..GU-4, GP-1)

GU-1: GET/PATCH /guests/:id and Edit guest (stay panel, Guest 360). GU-2, GP-1:
identityProblem in formIII.ts for check-in, walk-in and the register, and the
guest page's door - Aadhaar with its check digit, passport 6-15, no impossible
date, a real country and phone; an expired passport or visa is warned, not
refused (the owner). GU-3: a portal number is 6-30 characters with a digit.
GU-4: the card's stay line no longer reads as a second arrival date.
Tests: editGuest.test.ts, formIII.test.ts, guestDoorBehindTheCode.test.ts,
editGuest.test.tsx, formIII.test.tsx.

### GUE-4 · A foreign walk-in never reached the register

**Found** - 27 September (D27-25). The walk-in form had no nationality, and
a guest's nationality defaults to IN, so every foreign walk-in was invisible
to Form C / Form III.

**What was done** - the walk-in asks nationality and, for a foreigner, the
document (or a reason to skip it) and Form III's fields; the server applies
the same rule as check-in before its first write, and a returning guest
typed "IN" keeps the nationality on file.
`api/test/modules/guests/formIII.test.ts` ("a foreign walk-in"), seen
failing with the rule broken.

**The rule** - every door that puts a guest in a room asks the same
questions; a default that removes someone from a legal register is a bug,
not a convenience.

---

### GUE-3 · A foreign guest checked in with the ID skipped stayed Indian

**Found** - 27 September (D27-25). The check-in dialog started at "IN"
whatever the booking said, and sent the nationality only together with a
document - so a foreign guest whose ID was skipped for a reason was never
marked foreign, and a guest booked as foreign and checked in with the
default could be sent back as Indian. The Form C deadline also ran from the
check-in DATE, not the moment.

**What was done** - the dialog starts from the nationality on file and
always sends it; the server falls back to the recorded nationality when none
arrives; both Form III deadlines run 24 hours from the audit log's check-in
and check-out instants (migration 147). `front-desk/formIIICheckIn.test.tsx`,
`api/test/modules/guests/formIII.test.ts`, `db/tests/modules/guests.sql`,
each seen failing with its rule broken.

**The rule** - a legal clock runs from what happened, and the system already
records what happened (the audit log); a date is a fallback, never the rule.

---

### GUE-2 · The Form C register prints a long dash for a stay with no room

**Found** - 26 September, in the compliance lane's screenshot of Form C: a
foreign guest's earlier stays read "GB · room" and a long dash. It comes from
the database (`app.form_c_due`, migration 025, its `coalesce` for the room),
not from the screen, so the fix is a migration replacing that function with a
plain "-" (D17-48). Not fixed here: outside the compliance brief.

**What was done** - 27 September, the owner's D27-1 (branch
`fixes/five-bugs-27sep`). Migration 144 replaces `app.form_c_due` with the
same signature and return type (MEMORY 317), `coalesce(rm.number, '-')`.
`db/tests/modules/guests.sql` builds a GB stay with no room and reads the
register straight from the function: "got —" on 025's, "got -" on 144's. On
screen, the register reads "GB · room -".

**The rule** - A placeholder a person reads is written where it is made. A
long dash in a database function reaches every screen and print that reads
it, and no screen test sees it.

---

### GUE-1 · Companies and agents opens a screen headed "Booking sources"

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

Worse than the other heading mismatches: "Booking sources" is also the name of a different, real screen, so the same words name two places.

**What was done** — 17 September, the owner's answer D17-22 ("the heading is the menu name"; `docs/briefs/decisions-2026-09-17.md`). `CompaniesPage` in `pages/Guests.tsx` is headed "Companies and agents", and so is its browser tab. `guests.test.tsx` opens all four of this service's screens and compares each heading and tab with that screen's own entry in `nav.ts`; with the old heading put back, it failed. Branch `guests/brief`.

**The rule** — Two screens with one name is the fault the menu tests exist to catch — and they could not catch this one, because they read `nav.ts` and never a page. A heading is checked on the rendered screen, against the menu entry it sits under.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **32** · Reading a migration instead of the database, twice more
- **40** · A boolean where a document should have been
- **41** · The demo loader leaked its guests, 249 of them
- **83** · A picker keyed by a slug, into a column expecting a uuid
- **135** · Four reports built, listed, and unreachable
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **220** · A data-modifying CTE read back by its own statement — 202, twice, in one afternoon
- **228** · Two menu entries called "Booking sources", and I made the second
- **242** · "Required" went on one of the two doors a booking comes through — The rule, again: "required on every X" starts with finding every statement that makes an X

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
