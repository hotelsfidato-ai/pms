# Defects — purchasing

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `PUR-1`, `PUR-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — check that file
for the next free one before taking a number. Fixed entries stay here: they are
the reason the fault does not come back.

---

## Open — not fixed

### PUR-3 · The Approvals screen linked a purchase request to an address that does not exist — FIXED 26 September

**Found** — 26 September, writing PUR-2's test (the five-tests session, D25-27).
On the Approvals screen a purchase request's "Purchase request" link goes to
`/h/<code>/purchasing/requests/<id>` (`src/data/repositories/approvals.ts:54`,
`KINDS.purchase.where`). Purchasing's screen for one request is mounted at
`/h/:code/purchasing/:id` (`routes.tsx`), which is where its own list goes
(`Purchasing.tsx:198`). Nothing matches the longer address, so `App.tsx`'s
catch-all sends the person to `/` with no word about why - ADM-4's fault again.
Read from the code; not yet opened in a browser.

**Fixed** — 26 September, by the master with the owner's yes: the link is
`/h/${code}/purchasing/${a.subject.id}` (`src/data/repositories/approvals.ts`).
`purchasing.test.tsx` PUR-2's test now also checks the link's address; with
the old path put back it fails "expected '/h/PUA/purchasing/requests/waiting'
to be '/h/PUA/purchasing/waiting'".

**The rule** — ADM-4's: a link is a claim about an address. Open it.

---

## Fixed — the solution is here; do not work it out again

### PUR-2 · There is no approvals screen, and the brief said there was one - BUILT 19 September, held by a test 26 September

`docs/briefs/purchasing.md` says the GM approves "in the approvals inbox that
exists". The ENGINE exists (076, `api/src/routes/approvals.ts`) and so do its
routes - but **nothing in `src/` draws a shared inbox**. Equipment decides its
own requests on the equipment screen (`src/modules/equipment/flows/Decide.tsx`),
which is where that assumption quietly went.

Found by opening `/h/5EL/approvals` while walking the flow: it redirects to the
Dashboard.

**What was done:** purchasing decides its purchase on the order itself, the same
shape equipment uses, reading `mayDecide` and `blockedBecause` from the CORE
queue rather than keeping a copy of its rule - so the button and the server
cannot disagree. Two services now carry the same small component's worth of
buttons.

**Left open for the owner and the master:** whether a shared approvals screen is
wanted. If it is built, both services drop their buttons and point at it.

**Answered and built** — the owner's D18-19 (18 September): "Build one
Approvals screen. One inbox, everything waiting on you, decided in place. The
service screens keep their own buttons." Built by the master on 19 September
(commit `0b3757f`): `src/pages/Approvals.tsx` at `/h/:code/approvals`, in the
menu as "Approvals", posting to the same core endpoint as the purchase order
and the equipment register - a second view, not a second engine. So purchasing
KEEPS its buttons.

**Held by a test, 26 September (D25-27)** — the engine was already tested
(`api/test/approvals.test.ts`); the screen now is too. `purchasing.test.tsx`,
"lists a waiting purchase on the Approvals screen and decides it through the
core (PUR-2)": the GM's menu has `/h/:code/approvals`, the address opens the
screen headed "Approvals", the waiting purchase is listed, and Approve posts to
`/api/hotels/<code>/approvals/<id>/approved`. Seen failing with the route taken
out of `App.tsx`: `Unable to find role="heading" and name "Approvals"`. Writing
it found PUR-3.

**The rule:** "the screen that exists" is checked by opening it, not by reading
that a brief says so.

### PUR-1 · Housekeeping can be switched on as a requester and still be refused the screen

D18-2 says the owner may switch department heads - the kitchen and
**housekeeping** - on as people who may raise a purchase request, at any time,
without a deploy. The setting does exactly that: the switch is on the screen and
`app.may_raise_purchase` answers for housekeeping the moment it is flipped.

But `src/lib/permissions.ts` gave `housekeeping` **no `purchasing` grant at
all**, so the menu entry, the route guard and the server's `VIEW_ROLES` all
refused them. The owner would switch the switch on and nothing would happen.

**Fixed** 23 September - the owner's D22-11, "housekeeping may view and raise
purchase requests" (branch `admin/hotel-admin-menus`): `purchasing: ["view",
"create"]` for `housekeeping` in `api/src/permissions.ts`, and `"housekeeping"`
in `VIEW_ROLES` and in the refusal's list of who can see it. Raising still needs
the property's setting to name housekeeping (D18-2, off by default); with
`purchasing create` housekeeping may also attach a bill photo
(`POST /attachments`, api/src/roleGate.ts), as the kitchen manager already could.
**Proved:** `src/lib/permissions.test.ts` (the owner's table) and
`purchasingGrants.test.ts` ("lets housekeeping raise one once the setting names
them": the screen answers 200) - both failed with the grant taken back.

**The rule:** a SETTING that widens who may do something can only widen as far
as the permission matrix already reaches. Check both before promising the owner
a switch.
