# Defects — leads and WhatsApp

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `LEAD-1`, `LEAD-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None.

## Fixed or answered

### LEAD-1 · A background sync and a copy of every lead were built before the owner answered

**Found:** 29 September, by the owner's answer (D27-170). My plan asked the owner
whether to keep a copy in the PMS (for the read budget) or read live; while
waiting I built the copy, the sync and its erasure check "as needing no answer",
on my own recommendation. The owner chose read live, no copy. Two commits of
work (b8bc76c, parts of e912046) were removed in 6d3bfe4.

**Rule:** a question sent to the owner with a recommendation leaves everything
that depends on its answer unbuilt. Build only what is the same under every
answer (here: the reader and its count).

### LEAD-2 · An API test run died with the local Postgres and left its scratch database

**Found:** 29 September, 04:00: `npm test -- modules/leads` was mid-migration
when the machine's Postgres stopped (every session stopped then). The script's
trap never ran; `fidato_test_10231` stayed behind. Dropped on resume (my own).

**Rule:** after an interrupted API test run, look for `fidato_test_<pid>` and
drop only your own.

### LEAD-3 · `tsx watch` restarted after an `.env` change and never listened again

**Found:** 29 September, on this machine: touching a source file to make the API
re-read `api/.env` left a child holding port 8883 and answering nothing. Found
by the pid on the port (its parent was this copy's `tsx watch`); both stopped by
pid, one at a time, and the API started without watch.

**Rule:** after changing a copy's `api/.env`, stop and start the API; do not rely
on the watcher to pick it up.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
