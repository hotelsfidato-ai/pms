import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange, ArrowLeftRight, Ban, Repeat, Gift, Check, FileText, IndianRupee, Undo2, BedDouble, Send,
} from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator, toast } from "@/components/ui";
import { confirmWaiting, viewVoucher, CancelWaitingFlow, CancelConfirmedFlow } from "@/modules/reservations";
import { AmendStayFlow } from "@/modules/front-desk/flows/AmendStayFlow";
import { MoveRoomFlow } from "@/modules/front-desk/flows/MoveRoomFlow";
import { VoidFlow } from "@/modules/front-desk/flows/VoidFlow";
import { ExchangeRoomFlow } from "@/modules/front-desk/flows/ExchangeRoomFlow";
import { InclusionsFlow } from "@/modules/front-desk/flows/InclusionsFlow";
import { ChangeRateDialog } from "@/modules/finance";
import { AskGmDialog, UndoCheckInFlow, UNDO_OFF, undoRightFor } from "@/modules/front-desk/flows/AfterCheckIn";
import type { AskKind } from "@/modules/front-desk/data/operations";
import type { Stay } from "@/data/repositories";
import { useCurrentHotel, useRole } from "@/lib/session";
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
  const [cancelling, setCancelling] = useState(false);
  const [rerate, setRerate] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [retype, setRetype] = useState(false);
  const [asking, setAsking] = useState<AskKind | null>(null);

  const arrived = stay.status === "in-house" || stay.status === "due-out";
  /* The statuses this type actually has. `void` is a BAR TONE on the
     chart, not a stay status — the stay type carries due-in, in-house,
     due-out and no-show, and a comparison against a value outside that
     union is a condition that can never be true. */
  const over = stay.status === "no-show";
  /* Waiting for the hotel (Phase 1): the server answers "tentative", which
     the Stay type does not list yet - a request to the master (core types). */
  const waiting = stay.status === "tentative";
  const qc = useQueryClient();

  /* D24-27: the server's own questions (roleGate). Dates, moves, the swap
     and the inclusions are all `reservation: edit`; the void is `cancel`.
     Nobody refused them is offered the menu. */
  const role = useRole();
  const rules = useCurrentHotel()?.deskRules;
  if (!can(role, "edit", "reservation")) return null;
  const mayVoid = can(role, "cancel", "reservation");
  /* D27-187: the owner, an administrator or the GM, as on the bill. */
  const mayRerate = can(role, "approve", "reservation");
  /* D27-397: who may unmake an arrival - undo it, cancel or void a guest in
     house - by the hotel's switch; the front desk asks the GM. */
  const undo = undoRightFor(role, rules);
  const unmakes = arrived && undo === "yes";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Menu>
          <MenuLabel>The booking</MenuLabel>
          {/* The owner, 27 September: whoever may make a booking confirms
              one that was waiting; then its voucher may go. */}
          {waiting && (
            <MenuItem icon={Check} onSelect={() => void confirmWaiting(hotelId, stay.id)
              .then((r) => {
                if (!r.ok) return toast.error("Not confirmed", r.reason);
                toast.success("Confirmed", `${stay.reference}: the voucher can go now.`);
                void qc.invalidateQueries();
              })}>
              Confirm the booking
            </MenuItem>
          )}
          <MenuItem
            icon={CalendarRange}
            onSelect={() => setAmend(true)}
            disabled={over}
            reason="This stay is over."
          >
            Change dates or guests
          </MenuItem>
          {/* D27-187: the voucher to look at, print or save; sends nothing. */}
          <MenuItem
            icon={FileText}
            onSelect={() => void viewVoucher(hotelId, stay.id)
              .then((r) => { if (!r.ok) toast.error("No voucher", r.reason); })}
            disabled={stay.status !== "due-in"}
            reason="Only a confirmed booking still to arrive has a voucher."
          >
            View voucher
          </MenuItem>
          {/* D27-397: back to confirmed, arriving - the GM's; the desk asks. */}
          {arrived && (undo === "ask" ? (
            <MenuItem icon={Send} onSelect={() => setAsking("undo_check_in")}>
              Ask the GM to undo the check-in
            </MenuItem>
          ) : (
            <MenuItem icon={Undo2} onSelect={() => setUndoing(true)} disabled={undo === "no"} reason={UNDO_OFF}>
              Undo check-in
            </MenuItem>
          ))}

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
                   : "They have not arrived yet - change the room with Assign room on the Calendar."
            }
          >
            Move to another room
          </MenuItem>
          {/* D27-397: in a room, the room type is the room's - so the type
              changes by moving them to a room of another type. */}
          {arrived && (
            <MenuItem icon={BedDouble} onSelect={() => setRetype(true)}>
              Change room type
            </MenuItem>
          )}
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
          {/* D27-187: after confirmation, before check-in; nothing is posted,
              the agreed rate changes. In house too (D27-397), as on the bill;
              the front desk asks the GM. */}
          {mayRerate && (stay.status === "due-in" || arrived) && (
            <MenuItem icon={IndianRupee} onSelect={() => setRerate(true)}>
              Change rate
            </MenuItem>
          )}
          {!mayRerate && arrived && (
            <MenuItem icon={Send} onSelect={() => setAsking("rate")}>
              Ask the GM to change the rate
            </MenuItem>
          )}

          {/* A booking waiting for the hotel is CANCELLED, never voided: it
              was never confirmed, so no charge and nothing sent (D27-64). */}
          {mayVoid && waiting && <>
            <MenuSeparator />
            <MenuItem icon={Ban} danger onSelect={() => setCancelling(true)}>
              Cancel this booking
            </MenuItem>
          </>}
          {mayVoid && !waiting && arrived && undo === "ask" && <>
            <MenuSeparator />
            {/* D27-397: in house, the GM's; the desk asks. */}
            <MenuItem icon={Send} danger onSelect={() => setAsking("cancel")}>
              Ask the GM to cancel this booking
            </MenuItem>
            <MenuItem icon={Send} danger onSelect={() => setAsking("void")}>
              Ask the GM to void this booking
            </MenuItem>
          </>}
          {mayVoid && !waiting && !(arrived && undo === "ask") && <>
            <MenuSeparator />
            {/* BK-1 (the owner, 28 September): the guest cancelled - the
                booking's terms decide the charge. Void stays for a booking
                that should never have existed. In house (D27-397) the
                check-in is undone first, by whoever may undo it. */}
            <MenuItem
              icon={Ban}
              danger
              onSelect={() => setCancelling(true)}
              disabled={stay.status !== "due-in" && !unmakes}
              reason={
                arrived ? "They have arrived, and undoing a check-in is off at this hotel. Check them out instead."
                        : "Only a booking that has not arrived can be cancelled."
              }
            >
              Cancel this booking
            </MenuItem>
            <MenuItem
              icon={Ban}
              danger
              onSelect={() => setVoiding(true)}
              disabled={stay.status !== "due-in" && !unmakes}
              reason={
                arrived ? "They have arrived, and undoing a check-in is off at this hotel. Check them out instead."
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
      {waiting && (
        <CancelWaitingFlow
          hotelId={hotelId} stayId={stay.id} reference={stay.reference}
          open={cancelling} onOpenChange={setCancelling}
        />
      )}
      {(stay.status === "due-in" || unmakes) && (
        <CancelConfirmedFlow
          hotelId={hotelId} stayId={stay.id} reference={stay.reference} inHouse={arrived}
          open={cancelling} onOpenChange={setCancelling}
        />
      )}
      {unmakes && (
        <UndoCheckInFlow hotelId={hotelId} stay={stay} open={undoing} onOpenChange={setUndoing} />
      )}
      {asking && (
        <AskGmDialog hotelId={hotelId} stay={stay} kind={asking}
          open onOpenChange={(o) => { if (!o) setAsking(null); }} />
      )}
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
      {mayRerate && (stay.status === "due-in" || arrived) && (
        <ChangeRateDialog
          hotelId={hotelId} stay={stay}
          open={rerate} onOpenChange={setRerate}
          onDone={() => void qc.invalidateQueries()}
        />
      )}
      {arrived && (
        <MoveRoomFlow
          hotelId={hotelId} stay={stay} businessDate={businessDate}
          open={move} onOpenChange={setMove}
        />
      )}
      {arrived && (
        <MoveRoomFlow
          hotelId={hotelId} stay={stay} businessDate={businessDate} changeType
          open={retype} onOpenChange={setRetype}
        />
      )}
    </>
  );
}
