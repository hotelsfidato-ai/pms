# deploy/ changelog

The server's own scripts and their documentation. Newest first; the same entry
shape as the root `CHANGELOG.md`, which is the master's.

---

## 2026-10-29 · The one-hotel restore brings a guest's ID documents back (release 15, D27-376)

**Asked for:** the owner, D27-376: "a brought-back guest's ID documents come
back with the guest".

**Why they did not:** what a guest's ID says lives in `guest_documents`, one row
per guest, a shared ("group") table. The tool read a shared table only when
something points at it, and nothing points at `guest_documents`, so it was never
compared and never written. The ID photo's row (`guest_id_photos`) is the
hotel's own and already came back with its stay; the photo itself is encrypted
in Google Drive (D27-209), never on the server, and nothing in the PMS deletes
it when a guest's rows go.

**Shipped**
- `deploy/restore-hotel.sql`: `guest_documents` is read, and a missing one comes
  back exactly when its guest does, right after the guest; never for a guest
  still in live. The rules are unchanged: insert only, missing only, parents
  first, one transaction, triggers on; append-only, "never", people and
  properties listed, not written.
- The look lists the **ID photos coming back**, by booking reference (never a
  guest's name: the output may be sent on), and says the photo is in Google
  Drive, out of the tool's reach: the owner, an administrator or the GM opens
  each once in the PMS. The tool never reaches Google.
- `db/tests/restore-hotel.sh`: the guest also loses what their ID says and their
  ID photo's row, and a guest with no 5EL booking loses what their ID says
  alone. Both of the guest's rows come back identical, after the guest; the
  other guest's does not; the look lists the photo by its booking.
- `deploy/README.md`, "Bringing back one hotel": what comes back now, the ID
  photos list, and opening each photo once in step 4.

---

## 2026-10-29 · A4, the one-hotel restore tool (release 15, D27-373)

**Asked for:** plan A's A4 (`docs/plans/resilience-a.md`): when one hotel's data
is damaged, bring back what was deleted from a backup, the other six hotels
untouched.

**Shipped**
- `deploy/restore-hotel.sh <HOTEL> <backup file | database> [--bring-back]` and
  `deploy/restore-hotel.sql`. The backup (`db/backup.sh`'s .dump, or its
  --portable .sql) goes into a scratch database, dropped at the end; or a
  database already holding a copy (A3's `fidato_pitr`) is read and kept. One
  hotel's rows from every table `app.test_hotel_classes()` names are compared
  with live (live opened READ ONLY): missing, changed since, new since. With
  `--bring-back` and the code typed again, the missing rows go back, parents
  first, with the shared rows they need (guest, company), in one transaction.
  Never: a changed or new row, an append-only record (and what needs one), the
  "never" class (series, access, devices, outside systems, what was sent), a
  person, a property. It refuses a hotel whose own `hotels` row is gone and
  prints how to bring that row back first.
- `db/tests/restore-hotel.sh`: the proof on scratch databases (migrations, the
  suite's AGR and PUN, the demo 5EL; a booking, its bill and its guest deleted
  by mistake at 5EL).
- `deploy/README.md`, "Bringing back one hotel": the owner's steps, each
  labelled where it runs.

**Not wired** into `scripts/gates.sh` (the master's file): run it by hand.
