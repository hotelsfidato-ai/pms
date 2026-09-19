# Defects — online check-in

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `OCI-1`, `OCI-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None.

---

## Fixed

### OCI-1 · The guest was shown "Request failed (503)." where the door had written them a sentence

**Found** — 19 September, by opening `/g/:token` on a phone-sized window
against this copy's own API and pressing "Send me the code". Not by a test:
the test stubbed the answer, and the shape it stubbed was the 200.

The door refuses to send while n8n is not connected, and says so usefully:
*"Codes cannot be sent yet - WhatsApp is not connected to this server. Ask the
desk to send you the link instead."* It puts that in the body's `message`
field, with a 503. `src/lib/api.ts` lifts a refusal's `error` or `reason` into
the `ApiError`, **not** its `message` — so the sentence never reached the
screen, and the guest read a status code instead of what to do next. Today
that is *every* guest who tries, because n8n is not connected anywhere yet.

**What was done** — `messageFrom` in `pages/GuestPage.tsx` reads the body's
`message` first, then the `ApiError`'s own. The door was NOT changed: both
halves of its send answer — the right number and a wrong one — carry the same
field, and that sameness is what stops a stranger finding the guest's number
by trying.

**The rule** — A screen that prints "the server's own words" has to be opened
against the server that says them. A stub proves the shape you thought of.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
