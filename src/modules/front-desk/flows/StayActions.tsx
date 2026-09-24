import { useState } from "react";
import { CalendarRange, ArrowLeftRight, Ban, Repeat, Gift } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import { AmendStayFlow } from "@/modules/front-desk/flows/AmendStayFlow";
import { MoveRoomFlow } from "@/modules/front-desk/flows/MoveRoomFlow";
import { VoidFlow } from "@/modules/front-desk/flows/VoidFlow";
import { ExchangeRoomFlow } from "@/modules/front-desk/flows/ExchangeRoomFlow";
import { InclusionsFlow } from "@/modules/front-desk/flows/InclusionsFlow";
import type { Stay } from "@/data/repositories";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   EVERYTHING THAT IS NOT THE OBVIOUS ACT

   Grouped, and each one says why it cannot be picked rather than
   greying out in silence. The rules are the same ones the server
   enforces — this is what a clerk sees, never what decides.

   ORDER IS BY WHEN IT HAPPENS, not alphabetically: a stay is amended,
   then the guest moves rooms, and only at the end is it cancelled.
   Destructive things sit last, behind a separator, in red.
   ══════════════════════════════════════════════════════════════════ */
export function StayActions({ hotelId, stay, businessDate }: {
  hotelId: string; stay: Stay; businessDate: string;
}) {
  const [amend, setAmend] = useState(false);
  const [move, setMove] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [swap, setSwap] = useState(false);
  const [inclusions, setInclusions] = useState(false);

  const arrived = stay.status === "in-house" || stay.status === "due-out";
  /* The statuses this type actually has. `void` is a BAR TONE on the
     chart, not a stay status — the stay type carries due-in, in-house,
     due-out and no-show, and a comparison against a value outside that
     union is a condition that can never be true. */
  const over = stay.status === "no-show";

  /* D24-27: the server's own questions (roleGate). Dates, moves, the swap
     and the inclusions are all `reservation: edit`; the void is `cancel`.
     Nobody refused them is offered the menu. */
  const role = useRole();
  if (!can(role, "edit", "reservation")) return null;
  const mayVoid = can(role, "cancel", "reservation");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Menu>
          <MenuLabel>The booking</MenuLabel>
          <MenuItem
            icon={CalendarRange}
            onSelect={() => setAmend(true)}
            disabled={over}
            reason="This stay is over."
          >
            Change dates or guests
          </MenuItem>

          <MenuLabel>The room</MenuLabel>
          <MenuItem
            icon={ArrowLeftRight}
            onSelect={() => setMove(true)}
            disabled={!arrived}
            reason={
              /* A move needs somebody to BE in a room. Before arrival
                 the room is changed by assigning a different one,
                 which is a different act with its own control on the
                 chart. */
              over ? "This stay is over."
                   : "They have not arrived yet - assign a room instead."
            }
          >
            Move to another room
          </MenuItem>
          <MenuItem
            icon={Repeat}
            onSelect={() => setSwap(true)}
            disabled={!arrived}
            reason={
              /* An exchange swaps two OCCUPIED rooms. Before arrival
                 there is nothing to swap, and the other half of the
                 pair has to be in the house too — which the flow
                 itself says when nobody is. */
              over ? "This stay is over."
                   : "They have not arrived yet."
            }
          >
            Exchange with another guest
          </MenuItem>

          <MenuLabel>The rate</MenuLabel>
          <MenuItem icon={Gift} onSelect={() => setInclusions(true)}>
            What this booking includes
          </MenuItem>

          {mayVoid && <>
            <MenuSeparator />
            <MenuItem
              icon={Ban}
              danger
              onSelect={() => setVoiding(true)}
              disabled={stay.status !== "due-in"}
              reason={
                arrived ? "They have arrived. Check them out instead."
                        : "Only a booking that has not arrived can be voided."
              }
            >
              Void this booking
            </MenuItem>
          </>}
        </Menu>
      </div>

      <AmendStayFlow
        hotelId={hotelId} stay={stay}
        open={amend} onOpenChange={setAmend}
      />
      <VoidFlow
        hotelId={hotelId} stay={stay}
        open={voiding} onOpenChange={setVoiding}
      />
      {arrived && (
        <ExchangeRoomFlow
          hotelId={hotelId} stay={stay} businessDate={businessDate}
          open={swap} onOpenChange={setSwap}
        />
      )}
      <InclusionsFlow
        hotelId={hotelId} stay={stay}
        open={inclusions} onOpenChange={setInclusions}
      />
      {arrived && (
        <MoveRoomFlow
          hotelId={hotelId} stay={stay} businessDate={businessDate}
          open={move} onOpenChange={setMove}
        />
      )}
    </>
  );
}
