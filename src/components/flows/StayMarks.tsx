import { Users } from "lucide-react";
import { StatusPill } from "@/components/ui";
import { GROUP_ROOMS_ID } from "@/components/flows/GroupRoomsPanel";
import type { Stay } from "@/data/repositories";

/* The group's rooms are a column of the stay panel now, not a dialog
   over it — so the pill brings them into view, and moves focus there so
   a screen reader follows the eye. `scrollIntoView` is optional-called:
   jsdom does not implement it, and a pill that threw in a test would
   throw nowhere else. */
function showGroupRooms() {
  const el = document.getElementById(GROUP_ROOMS_ID);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/* ══════════════════════════════════════════════════════════════════
   THE MARKS ON A STAY, IN ONE PLACE

   ⚠ THIS EXISTED TWICE. `StayDetail` in the tape chart and
   `StaySummary` in the list drawer both drew the same row of badges,
   independently — and they had already drifted:

     · the group pill said "Group" in one and named the group in the
       other, because only one of them was updated
     · VIP and the single-lady mark appeared on the tape chart's panel
       and NOT on the list's, which is worse than it sounds: those are
       the two marks a clerk acts on BEFORE the guest reaches the desk,
       and the arrivals list is exactly where they would look

   Defect 143 was the same shape — "the same panel" turning out to be a
   second copy — and this is it recurring on the row inside the panel.

   THE STATUS PILL IS NOT HERE, deliberately. The chart shows a
   DERIVED tone (due-out is not a status; it is a status plus a date)
   while the list shows the status itself. They differ because they
   mean different things, and folding them together would be a merge
   for the sake of one.
   ══════════════════════════════════════════════════════════════════ */

export function StayMarks({ stay }: { stay: Stay }) {
  return (
    <>
      {stay.isComplimentary && (
        <StatusPill tone="accent">Complimentary</StatusPill>
      )}
      {stay.isDayUse && <StatusPill tone="neutral">Day use</StatusPill>}

      {/* NAMED, and it shows the group's rooms beside this one rather
          than navigating away. A clerk holding a phone wants to know
          WHICH group and how many rooms are in it, and then to look at
          the rest of them without losing this one. */}
      {stay.group ? (
        <button
          type="button"
          onClick={showGroupRooms}
          className="rounded-md cursor-pointer focus-visible:outline-2
                     focus-visible:outline-brand-orange"
        >
          <StatusPill tone="accent">
            <Users className="size-3" />
            {stay.group.rooms === 1
              ? stay.group.name
              : `${stay.group.name} · one of ${stay.group.rooms} rooms`}
          </StatusPill>
        </button>
      ) : stay.groupId ? (
        /* The group id without the group. Only reachable from a stay
           read by something that has not been taught to carry it — said
           plainly rather than hidden, so the gap is visible. */
        <StatusPill tone="accent">Group</StatusPill>
      ) : null}

      {/* The two marks a clerk acts on BEFORE the guest reaches the
          desk: the room is checked ahead of a VIP, and a woman
          travelling alone is placed away from stairwells and service
          corridors. Neither is read out at the counter. */}
      {stay.isVip && <StatusPill tone="accent">VIP</StatusPill>}
      {stay.isSingleLady && (
        <StatusPill tone="info">Single lady — placement</StatusPill>
      )}
    </>
  );
}
