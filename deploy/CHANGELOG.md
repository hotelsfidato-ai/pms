# deploy/ changelog

The server's own scripts and their documentation. Newest first; the same entry
shape as the root `CHANGELOG.md`, which is the master's.

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
