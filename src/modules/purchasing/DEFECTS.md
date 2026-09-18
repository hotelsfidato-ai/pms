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

### PUR-1 · Housekeeping can be switched on as a requester and still be refused the screen

D18-2 says the owner may switch department heads - the kitchen and
**housekeeping** - on as people who may raise a purchase request, at any time,
without a deploy. The setting does exactly that: the switch is on the screen and
`app.may_raise_purchase` answers for housekeeping the moment it is flipped.

But `src/lib/permissions.ts` gives `housekeeping` **no `purchasing` grant at
all**, so the menu entry, the route guard and the server's `VIEW_ROLES` all
refuse them. The owner would switch the switch on and nothing would happen.

The kitchen manager does not have this problem - the matrix already grants them
`purchasing: view, create` - so only one of the two department heads D18-2 names
actually works today.

**Not fixed here:** `src/lib/permissions.ts` is the master's, and widening who
sees a screen is the owner's decision, not a chat's. The change is one line -
`purchasing: ["view", "create"]` for `housekeeping` - plus `"housekeeping"` in
`api/src/modules/purchasing/purchasingGrants.ts`'s `VIEW_ROLES`, in the same
commit, or the parity test fails (which is what it is for).

**The rule:** a SETTING that widens who may do something can only widen as far
as the permission matrix already reaches. Check both before promising the owner
a switch.

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

**The rule:** "the screen that exists" is checked by opening it, not by reading
that a brief says so.

---

## Fixed — the solution is here; do not work it out again

None yet.
