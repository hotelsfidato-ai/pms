# Defects — guest services

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `GS-1`, `GS-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None.

## Fixed

### GS-2 · A room with a letter, typed in small letters, found nobody on the guest's room-and-phone page or in Lost property - FIXED 15 October (the owner's D27-335)

**Found** 15 October, sweeping for D27-335 (room numbers with letters).
`app.guest_room_phone_link` (181) matched `rm.number = btrim(p_room)`, so a
guest in 111A who typed 111a was never found - and, by design, was told the
same words as a match, so nobody would ever have known. The page's box was a
number keypad (`inputMode="numeric"`), which has no letters at all. Lost
property's Room box was the same keypad, and its lookup (`wakeAndLost.ts`)
the same exact match: "There is no room 111a here."
**Fixed** - migration 226 ("room numbers in capitals") re-creates the function
with `upper(rm.number) = upper(btrim(p_room))`, everything else 181's; Lost
property's lookup is `upper(number) = upper($2)`; both boxes are a text
keyboard that starts in capitals (`autoCapitalize="characters"`). Rooms are
now saved in capitals (inventory, D27-335). `guestDoorByRoom.ts` still answers
the same words matched or not.
**Proved** - `db/tests/modules/guest-services.sql` "a room with a letter, typed
in small letters, finds the guest (D27-335)": passing with 226, failing with
181's exact match put back on the same scratch database.

### GS-1 · A working-menu entry above the kitchen's moved where the chef and waiter land

**Found** 30 September, by `navigation.test.ts` while building Guest requests.
A role with a working menu lands on the first entry of it (`workingHomeFor`).
Guest requests sits in the Front desk section, which comes before the
restaurant's, so putting it in the chef's and waiter's working menus would have
sent them to Guest requests after sign-in instead of the Kitchen and Tables.

**What was done:** the chef and the waiter (`pos`) named in `WORKING_HOME`
(`src/components/app/navigation.ts`), as D22-19 did for housekeeping and the
kitchen manager; the waiter's landing screen is now pinned too. Numbered for
now (root MEMORY 350).

**The rule:** adding an entry to a working menu can change where that role
lands. Run `navigation.test.ts` and read "lands them on their own work".

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
