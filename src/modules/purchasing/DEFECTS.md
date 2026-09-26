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

### PUR-2 · There is no approvals screen, and the brief said there was one

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

**Still open, 25 September, because no test opens it:** the engine is tested
(`api/test/approvals.test.ts`), but nothing in the web suite renders the
Approvals screen or finds its menu entry, so it could lose its route with every
gate green - the way the brief's claim went wrong the first time. One web test
(the screen lists a waiting purchase request and decides it through the core
endpoint) would close it.

**The rule:** "the screen that exists" is checked by opening it, not by reading
that a brief says so.

---

## Fixed — the solution is here; do not work it out again

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
