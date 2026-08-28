import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogIn, IdCard, BedDouble, Users, Sparkle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import {
  Button, Field, Input, NativeSelect, StatusPill, Tooltip, toast,
  Dialog, DialogContent, DialogTrigger,
} from "@/components/ui";
import { checkIn, assignableRooms, checkInAllowed, type Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   FLOW A — arrival to in house

   Five steps, in the order a clerk actually works: confirm the party,
   assign a room, capture ID, confirm the rate, done.

   Only clean or inspected rooms are offered. A dirty room appears in
   the list, disabled, with the reason — hiding it would teach nobody
   why they cannot use it.
   ══════════════════════════════════════════════════════════════════ */

const USER = "front desk";
const STEPS = ["Guest", "Room", "ID", "Rate", "Done"] as const;

export function CheckInFlow({
  hotelId, stay, businessDate, onDone,
}: {
  hotelId: string;
  stay: Stay;
  businessDate: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const [adults, setAdults] = useState(stay.adults);
  const [children, setChildren] = useState(stay.children);
  const [roomNumber, setRoomNumber] = useState(stay.roomNumber);
  const [idCaptured, setIdCaptured] = useState(false);
  const [idSkipReason, setIdSkipReason] = useState("");
  const [ratePlan, setRatePlan] = useState(stay.ratePlan);

  const permitted = useQuery({
    queryKey: ["checkin-allowed", hotelId, stay.id, stay.status],
    queryFn: () => checkInAllowed(hotelId, stay.id, businessDate),
  });
  const rooms = useQuery({
    queryKey: ["assignable", hotelId, stay.roomType, businessDate],
    queryFn: () => assignableRooms(hotelId, stay.roomType, businessDate),
    enabled: open,
  });

  const allowed = permitted.data?.allowed ?? false;
  const reason = permitted.data?.reason;

  const trigger = (
    <Button disabled={!allowed} data-checkin>
      <LogIn className="size-4" />
      Check in
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setStep(0); }}
    >
      <DialogTrigger asChild>
        {reason ? <Tooltip content={reason}>{trigger}</Tooltip> : trigger}
      </DialogTrigger>

      <DialogContent
        title={`Check in ${stay.guest}`}
        description={`${stay.reference} · ${stay.roomType}`}
      >
        <Stepper current={step} />

        <div className="mt-5 min-h-[220px]">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                Confirm who is actually arriving. The booking says{" "}
                {stay.adults} adult{stay.adults === 1 ? "" : "s"}
                {stay.children ? `, ${stay.children} child` : ""}.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Adults">
                  {({ id }) => (
                    <Input
                      id={id} numeric value={String(adults)}
                      onChange={(e) => setAdults(Number(e.target.value) || 0)}
                    />
                  )}
                </Field>
                <Field label="Children">
                  {({ id }) => (
                    <Input
                      id={id} numeric value={String(children)}
                      onChange={(e) => setChildren(Number(e.target.value) || 0)}
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-grey-600">
                Only a clean or inspected room can take a guest. The rest are
                shown with the reason.
              </p>
              <ul className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto scrollbar-quiet">
                {(rooms.data ?? []).map((room) => {
                  const selected = room.number === roomNumber;
                  const body = (
                    <button
                      type="button"
                      disabled={!room.allowed}
                      onClick={() => setRoomNumber(room.number)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 h-11 rounded-md border text-left transition-colors duration-150",
                        selected
                          ? "border-brand-orange bg-brand-orange-50"
                          : room.allowed
                            ? "border-grey-200 hover:border-grey-300 bg-white"
                            : "border-grey-200 bg-grey-50 cursor-not-allowed opacity-60",
                      )}
                    >
                      <BedDouble className="size-4 text-grey-400 shrink-0" />
                      <span className="tabular font-medium text-ink-900">{room.number}</span>
                      <span className="ml-auto">
                        <StatusPill
                          tone={
                            room.housekeeping === "inspected" ? "success"
                              : room.housekeeping === "clean" ? "info"
                              : room.housekeeping === "dirty" ? "warning"
                              : "neutral"
                          }
                        >
                          {room.housekeeping}
                        </StatusPill>
                      </span>
                    </button>
                  );
                  return (
                    <li key={room.number}>
                      {room.reason ? <Tooltip content={room.reason}>{body}</Tooltip> : body}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-grey-600">
                Indian properties must record a guest's identity document.
                It can be skipped, but the reason is kept on the folio.
              </p>
              <button
                type="button"
                onClick={() => setIdCaptured(!idCaptured)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 h-14 rounded-md border transition-colors duration-150",
                  idCaptured
                    ? "border-success bg-success-50"
                    : "border-grey-300 border-dashed bg-white hover:border-grey-400",
                )}
              >
                <IdCard className={cn("size-5", idCaptured ? "text-success" : "text-grey-400")} />
                <span className="text-base text-ink-900">
                  {idCaptured ? "ID captured" : "Capture ID document"}
                </span>
                {idCaptured && <Check className="size-4 text-success ml-auto" />}
              </button>

              {!idCaptured && (
                <Field label="Reason for skipping" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={idSkipReason}
                      onChange={(e) => setIdSkipReason(e.target.value)}
                      placeholder="Scanner offline — to be captured at breakfast"
                    />
                  )}
                </Field>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Field label="Meal plan">
                {({ id }) => (
                  <NativeSelect
                    id={id}
                    value={ratePlan}
                    onChange={(e) => setRatePlan(e.target.value)}
                  >
                    {["CP", "Room Only", "EP", "MAP"].map((p) => <option key={p}>{p}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <div className="rounded-md bg-grey-50 border border-grey-200 p-3 space-y-1.5">
                <Line label="Rack rate" value={money(stay.rackTariff)} muted />
                <Line
                  label="Offered"
                  value={stay.isComplimentary ? "Complimentary" : money(stay.offeredTariff)}
                  bold
                />
                <Line
                  label="Nights"
                  value={String(stay.nights)}
                  muted
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-6 space-y-3">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-success-50">
                <Sparkle className="size-5 text-success" />
              </div>
              <p className="text-md font-semibold text-ink-900">Ready to check in</p>
              <div className="text-sm text-grey-600 space-y-0.5">
                <p>{stay.guest} · room {roomNumber}</p>
                <p className="tabular">
                  <Users className="inline size-3.5 -mt-0.5 mr-1" />
                  {adults} adult{adults === 1 ? "" : "s"}{children ? `, ${children} child` : ""} · {ratePlan}
                </p>
                {!idCaptured && (
                  <p className="text-brand-yellow">ID not captured — {idSkipReason}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 pt-4 border-t border-grey-200">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </Button>

          {step < 4 ? (
            <Button
              disabled={step === 2 && !idCaptured && !idSkipReason.trim()}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={async () => {
                const res = await checkIn(hotelId, stay.id, {
                  roomNumber, adults, children, ratePlan,
                  idCaptured, idSkipReason, businessDate, user: USER,
                });
                if (res.ok) {
                  toast.success(
                    `${stay.guest} is in house`,
                    `Room ${roomNumber} · the arrivals count has dropped.`,
                  );
                  setOpen(false);
                  setStep(0);
                  qc.invalidateQueries();
                  onDone?.();
                } else {
                  toast.error("Could not check in", res.reason);
                }
              }}
            >
              <Check className="size-4" />
              Check in
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1 flex-1 last:flex-none">
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 h-6 rounded-full text-2xs font-medium whitespace-nowrap",
              i < current ? "bg-success-50 text-success-600"
                : i === current ? "bg-ink-900 text-white"
                : "bg-grey-100 text-grey-500",
            )}
          >
            {i < current ? <Check className="size-3" /> : <span className="tabular">{i + 1}</span>}
            {label}
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn("h-px flex-1", i < current ? "bg-success" : "bg-grey-200")} />
          )}
        </li>
      ))}
    </ol>
  );
}

function Line({
  label, value, muted, bold,
}: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className={cn("text-sm", muted ? "text-grey-500" : "text-grey-700")}>{label}</span>
      <span className={cn("tabular shrink-0", bold ? "text-base font-semibold text-ink-900" : "text-sm text-ink-900")}>
        {value}
      </span>
    </div>
  );
}
