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

**21 September** — the root fix landed in `src/lib/api.ts` (the master: it
reads `error`, then `reason`, then `message`), and this workaround is gone.

### OCI-2 · Every six-digit code would have been sent to "…0011" — nobody

**Found** — 21 September, reading the send call while making room cards work,
not by a test.

`guest_code_issue` (114) returned the code and `sent_to` — the MASKED number,
"…0011", kept for the record. The door passed `sent_to` to `send()` as the
recipient. So the day WhatsApp was connected, every guest's code would have
gone to "…0011", which is nobody, and the whole half of the page behind the
code would have been unreachable with no error anywhere. The test that covered
sending used a stand-in receiver that answered "ok" and never looked at what
it was sent.

**What was done** — migration 121's `guest_code_make` also returns the
booking's whole number, which the door hands to `send()` and to nothing else.
`guestDoorBehindTheCode.test.ts` keeps what the stand-in receives and checks
`to.phone` is the whole number; with the masked one put back, it failed. Seen
live the same day: the stand-in on this laptop received the code addressed to
the booking's own number.

**The rule** — A stand-in that does not read what it is sent proves only that
something was sent.

### OCI-3 · A line that was down told the guest their link was dead

**Found** — 21 September, by opening a booking's link while this copy's API
was still starting.

Every failure read "This link is not usable. Ask the desk for a new one." —
including a request that never reached the server. A guest on hotel wifi with
a perfectly good link would have been sent to the desk for a new one.

**What was done** — a request that never arrived (`ApiError` status 0) reads
"We could not reach the hotel", with Try again. Nothing reached the door, so
this tells a stranger nothing about the link. Refusals still read the one
sentence. Guarded in `onlineCheckin.test.tsx`; seen to fail with the fault put
back.

**The rule** — "Refused" and "not reached" are different answers; only the
first must be kept uniform.

### OCI-4 · The unlock was blocked by the browser the moment the code was right

**Found** — 21 September, by answering a real code on the page in a browser.
Every test passed.

The unlock travelled in its own header, `x-guest-unlock`. The API's CORS list
(`api/src/server.ts`, the master's) does not name it, so the browser's
preflight refused it and the first call behind the code never left the phone —
"We could not reach the hotel", straight after "Verified". The server tests
call the app in-process and never meet a preflight; the screen tests stub
`api()`. `server.ts` has a comment warning of exactly this trap, from two
earlier headers.

**What was done** — the unlock travels as `Authorization: Guest <unlock>`,
which the list already allows, access logs do not record, and the staff gate
ignores on `/api/guest`. A clerk's `Bearer` token on the same browser is not a
`Guest` one and unlocks nothing. A test asks the preflight the question a
browser asks.

**The rule** — A new request header is a question for the CORS list, and only
a browser asks it. Open the screen.

### OCI-5 · A database function behind the code could forget the unlock, and every test would pass

**Found** — 21 September, proving the guest's bill guard: `app.guest_bill` was
broken on purpose to take the link's hash alone (`app.guest_link_stay`
instead of `app.guest_unlocked`) — and all 34 door tests passed.

The door asks for the unlock (`openedHere`) BEFORE it calls any function
behind the code, so every test that goes through the door is refused at the
door and never reaches the function. That is defence in depth working — and
it means the database function, which the brief names as THE guard ("asked
ON THE SERVER, in the database function, every time"), had no test of its
own. The same was true of `guest_details_submit`, `guest_details_state`,
`guest_request_make` and `guest_requests_mine`. No function was actually
wrong; nothing would have said so if one had become wrong.

**What was done** — `guestDoorBehindTheCode.test.ts` calls every function
behind the code directly, with the link's hash and no unlock, and with an
unlock nobody was given, after the code HAS been answered on that link: each
must answer nothing. Seen to fail twice — with `guest_bill` taking the link
alone, and separately with `guest_details_submit` doing the same.

**The rule** — Two guards in a row test as one unless each is asked on its
own. Break the inner one with the outer one standing.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
