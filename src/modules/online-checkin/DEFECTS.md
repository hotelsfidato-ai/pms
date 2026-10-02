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

(none)

---

## Fixed

### OCI-10 · Continue with Google ran Google's script on the guest's page

30 September (D27-207; numbered for now). Accepted for the launch by the
master, and written down so it is a choice and not an oversight. Google
Identity Services is a script from accounts.google.com, and a script on a
page can read that page: the link in the address and, on a phone that has
already been verified, the unlock kept for the day. **What limits it now:**
the script is not in the bundle and not fetched on opening - only when the
guest presses "Continue with Google" (`googleSignIn.ts`, pinned by a test);
a guest who uses a code never runs it; and it comes from Google's own
address only. **The way with no script:** a full-page redirect to Google
(OpenID Connect, `response_type=id_token`, a `state` kept in the tab and a
registered return address). The door's check would not change - it already
takes Google's signed answer. About two hours, and one more owner step (the
return address in the Google client). **The rule:** anything loaded from
outside onto `/g/:token` is loaded on the guest's own press, never on
opening.
**Fixed 2 October (D27-239, 8.4), the way with no script:** "Continue
with Google" sends the whole tab to Google's own sign-in (OpenID Connect,
`response_type=id_token`, a nonce and a state); Google answers at
`/g-return` in the address's fragment, which never reaches a server; the
guest's link, the state and the nonce wait in this tab's sessionStorage and
never go to Google. `GoogleReturn.tsx` checks the state, takes the answer out
of the address, and posts it with the nonce; the door checks Google's answer
as before and the nonce too. `googleSignIn.ts` is gone, and a test fails if
any file of this module adds a script or names Google's. One owner step: the
return address in the Google client (OWNER-STEPS, 2b step 9). **The rule
now:** nothing from outside is loaded onto the guest's page at all.

### OCI-12 · The database guard test asked about an empty stay, so a function that skipped the unlock still passed

1 October, found while proving the desk's replies (D27-224; numbered for
now). **What happened:** OCI-5's test calls every function behind the code
with the link's hash and no unlock, and expects nothing back. Broken on
purpose to take the link alone, `app.guest_desk_thread` still answered
nothing and the test passed: at that point in the file the stay had no
messages, so there was nothing for it to leak. `guest_requests_mine` and
`guest_details_state` were asked the same way, so their checks were weaker
than they read.
**Fixed:** the test first gives the stay a message to the desk and a reply,
then asks. With the thread broken again, it failed.
**The rule:** a "nothing comes back" test needs something there that could
come back. Fill the room before you prove the door is shut.

### OCI-11 · A guest's second upload deleted the photo the desk had kept

1 October, found by the master's read-only pre-launch review, before any guest
used it (numbered for now). **What happened:** `app.guest_id_photo_stored`
(167) marked EVERY stored photo of the stay and guest as replaced, and the
door then deleted each from Drive. A guest whose details the desk had
confirmed could send their details again - a new waiting submission - and any
JPEG with them: the kept copy was deleted. If the desk then removed the new
one as "not an ID", no copy was left. The desk's own "add a photo at
check-in" did the same to a kept photo. That broke D27-210 (only the owner,
an administrator or the GM delete a kept photo, with a reason) and this
file's own comment that the guest "adds nothing more" once confirmed.
**Also found, the same fault's other face:** the desk's list picked the
stay's latest stored photo for a waiting submission, so new details with no
photo showed reception the KEPT one - which reception may not open.
**Why the tests did not catch it:** every photo test began from one waiting
submission; none sent details twice, and the desk-add test asserted the
replacement as correct.
**Fixed:** a replace only replaces the guest's own photo of the SAME waiting
submission (`link_id is not null and submission_id = …`). A photo added at
the desk replaces nothing: beside a kept one it is a second kept one ("Add
another photo", not "Replace"). The list shows a waiting submission's own
photo (`x.submission_id = d.id`). Three tests, each seen failing on the old
code; the waiting-photo replace kept its test, seen failing when nothing is
ever replaced.
**The rule:** a delete reached by a side road (a "replace", a "tidy") must
be scoped as narrowly as the front door's own delete. When a table has a
state that only some people may end, every statement that ends it names
that state.

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

### OCI-6 · The card sheet printed two cards on its first page and a blank last page

**Found** — 25 September, by printing the sheet to an A4 PDF in headless Edge
and counting the rooms on each page. Every test passed; on screen it looked
right.

Each card is 130 mm tall on paper, two rows to the page's 265 mm. The
screen's own padding (`Page`'s `py-6`) printed too, so the first page had
8 mm less and its second row went over: 2, 4, 4, 4, 4 and an empty sixth
page. The cards also printed on the app's grey.

**What was done** — the sheet drops its padding and grey on paper
(`print:p-0 print:bg-white`) and the cards are white. 18 rooms now print on
five pages, four to each, the last holding two.

**The rule** — A printed layout is proved on paper, not on the screen: print
it to PDF and count what each page holds.

### OCI-7 · A test that said "not this booking" could not fail

**Found** — 25 September, breaking the check-in's line to show on ANY waiting
details: the test stayed green.

It rendered the line for a booking whose details did not wait, waited until
the call was MADE, and then asserted no link. The answer had not been drawn
yet, so "no link" was true whatever the code did.

**What was done** — two bookings on one screen from one answer: the link
appears for the one that waits (proving the answer was drawn) and exactly one
link exists. Seen to fail with the fault put back.

**The rule** — A "nothing is shown" assertion needs something in the same
render that proves the answer arrived.

### OCI-8 · A code that never went was counted as sent

**Found** — 29 September, by reopening a guest's page in the browser within
ten minutes. Every test passed.

The page notes the moment it asks for a code, so reopening the link from
WhatsApp does not send a second one (each new code kills the last, and a link
gets five an hour). It noted it BEFORE asking and kept the note whatever came
back - so a send the door refused, or one that never reached it, left the
guest reading "A code was sent a few minutes ago. Use it" for a code that
never existed.

**What was done** — `sendCode` forgets the note when the answer is not
`sent`, or the call fails; the next open asks again. Noting before the call
stays, so a second mount while it is in flight still sends nothing. Guarded
by "asks again on the next open when the last ask sent nothing"; seen to fail
with the forgetting taken out.

**The rule** — A record that something happened is written when it happened,
or taken back when it did not.

### OCI-9 · No number on the booking, and still a box for the code

**Found** — the same evening, on the same screen: the door's "Ask the desk"
sat above an empty code box and "Send a new code", under a line promising six
digits "to the number on the booking".

**What was done** — a booking's link whose booking has no number (the hint
the link already shows) draws only "Ask the desk", asks the door nothing, and
drops the promise. A room card never shows its number, so it still asks and
reads the door's own words. The sentence is written twice - the page's and
the door's - and each names the other. Guarded; seen to fail.

**The rule** — A screen that says "you cannot" does not also offer the thing.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
