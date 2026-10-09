import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Check, FileText, Link2, Send } from "lucide-react";
import { dateShort, moneyPrecise } from "@/lib/format";
import { Button, Card, CardBody, CardHeader, Input, toast } from "@/components/ui";
import { getGuestMessages, SendCheckInLink } from "@/modules/guest-messaging";
import { confirmWaiting, makeGuestLink, sendVoucher, viewVoucher } from "@/modules/reservations/data/booking";
import { NOTHING_SENT, useIsTestHotel } from "@/lib/testHotel";

/* ══════════════════════════════════════════════════════════════════
   BOOKED - what the desk does next, on the booking just made

   The references, and the room each got. Then, in the order a clerk
   on the phone does them: confirm it (if it was waiting), the guest's
   page link, the ONE voucher (D27-35) and checking in. Each is another
   service's door, used as it is: the guest page's link (114), guest
   messages' confirmation, front desk's check-in on Arrivals.

   A WAITING BOOKING SENDS NOTHING: no link, no voucher, until it is
   confirmed (the owner, 27 September).
   ══════════════════════════════════════════════════════════════════ */

export interface Booked {
  guest: string;
  groupId: string | null;
  bookings: { id?: string; reference: string; roomType: string; rate: number }[];
  waiting: boolean;
  /** A room picked on the form: the one it got, or why it did not. */
  assigned: Record<string, { room: string } | { failed: string }>;
  arrivesToday: boolean;
  /* The one page (D27-163): what its later doors did, each after the booking
     stood. Absent when that button did not ask for it. */
  checkedIn?: { room: string } | { failed: string };
  advance?: { amount: number } | { failed: string };
}

export function BookedCard({ hotelId, booked, onAnother }: {
  hotelId: string; booked: Booked; onAnother: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(booked.waiting);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The group's one voucher is about its lead room - the first booked
     (D22-41, D22-52) - so every question here is asked about that one. */
  const lead = booked.bookings[0]?.id ?? "";

  const confirm = async () => {
    setBusy(true);
    const r = await confirmWaiting(hotelId, lead);
    setBusy(false);
    if (!r.ok) return toast.error("Not confirmed", r.reason);
    setWaiting(false);
    toast.success("Confirmed", "The voucher can go now.");
    void qc.invalidateQueries();
  };

  const showLink = async () => {
    setBusy(true);
    const r = await makeGuestLink(hotelId, lead);
    setBusy(false);
    if (!r.ok) return toast.error("No link", r.reason);
    setLink(r.link);
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={booked.checkedIn && "room" in booked.checkedIn ? "Checked in"
          : waiting ? "Held, waiting for the hotel" : "Booked"}
        description={booked.guest} />
      <CardBody className="space-y-4">
        {/* List rows: 12px, a hairline between (the Rhythm Rule). */}
        <ul className="-mt-3 divide-y divide-grey-100">
          {booked.bookings.map((b) => {
            const a = booked.assigned[b.reference];
            return (
              <li key={b.reference} className="py-3 flex flex-wrap justify-between gap-x-4 text-base">
                <span className="font-medium tabular">{b.reference}</span>
                <span className="text-grey-600">
                  {b.roomType}
                  {a && "room" in a && `, room ${a.room}`}
                </span>
                {a && "failed" in a && (
                  <span className="basis-full text-sm text-warning-dark">
                    No room given: {a.failed} Assign one from Arrivals.
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Each later step, said: the booking stands whatever they answered. */}
        {(booked.checkedIn || booked.advance) && (
          <div className="space-y-1 text-base" data-booked-steps>
            {booked.checkedIn && ("room" in booked.checkedIn
              ? <p className="text-grey-600">In house, room {booked.checkedIn.room}.</p>
              : <p className="text-warning-dark">Not checked in: {booked.checkedIn.failed} Check them in from Arrivals.</p>)}
            {booked.advance && ("amount" in booked.advance
              ? <p className="text-grey-600">Advance of {moneyPrecise(booked.advance.amount)} taken, held as the guest's credit.</p>
              : <p className="text-warning-dark">Advance not taken: {booked.advance.failed} Take it on the bill.</p>)}
          </div>
        )}

        {waiting ? (
          <div className="space-y-2">
            <p className="text-base text-grey-600">
              The room is held. Nothing is sent to the guest until the booking is confirmed.
            </p>
            <Button variant="primary" loading={busy} onClick={() => void confirm()}>
              <Check className="size-4" /> Confirm the booking
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {link ? (
                <div className="flex gap-2">
                  <Input readOnly value={link} aria-label="The guest's page"
                    onFocus={(e) => e.currentTarget.select()} className="h-11 flex-1 min-w-0" />
                  <Button variant="secondary" className="h-11"
                    onClick={() => void navigator.clipboard?.writeText(link)
                      .then(() => toast.success("Copied"))}>
                    Copy
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" loading={busy} onClick={() => void showLink()}>
                  <Link2 className="size-4" /> The guest's page link
                </Button>
              )}
            </div>
            {/* The check-in link beside the voucher (D27-105): the guest's own
                page, sent now; not once they are in house. */}
            {lead && (
              <div className="flex flex-wrap items-start gap-2">
                <Voucher hotelId={hotelId} stayId={lead} />
                {!(booked.checkedIn && "room" in booked.checkedIn) && <>
                  {/* D27-187: the same PDF to look at, print or save; sends nothing. */}
                  <Button variant="secondary" onClick={() => void viewVoucher(hotelId, lead)
                    .then((r) => { if (!r.ok) toast.error("No voucher", r.reason); })}>
                    <FileText className="size-4" /> View voucher
                  </Button>
                  <SendCheckInLink hotelId={hotelId} stayId={lead} />
                </>}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-grey-200">
          {booked.arrivesToday && !waiting && booked.bookings.length === 1 && lead
            && !(booked.checkedIn && "room" in booked.checkedIn) && (
            <Button variant="secondary"
              onClick={() => navigate(`/h/${hotelId}/arrivals?res=${lead}`)}>
              Check in now
            </Button>
          )}
          <Button variant="secondary"
            onClick={() => navigate(booked.groupId
              ? `/h/${hotelId}/groups/${booked.groupId}`
              : `/h/${hotelId}/reservations?res=${lead}`)}>
            Open the booking
          </Button>
          <Button variant="ghost" onClick={onAnother}>Another booking</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── The one voucher (D27-35) ───────────────────────────────────────
   Read from what guest messages recorded, whoever sent it - this desk,
   the background sender, or anybody else. Once it has gone the button is
   gone; the server refuses a second one anyway. */
function Voucher({ hotelId, stayId }: { hotelId: string; stayId: string }) {
  const [busy, setBusy] = useState(false);
  const sent = useQuery({
    queryKey: ["guest-messages", hotelId, stayId],
    queryFn: () => getGuestMessages(hotelId, stayId),
  });
  /* NOTHING LEAVES A TEST HOTEL (the owner's D27-296 (4)): off, with the
     sentence the server refuses a send with (409). */
  const test = useIsTestHotel(hotelId);
  if (!sent.data) return <p className="text-sm text-grey-500">{sent.isError ? "-" : "Checking the voucher…"}</p>;

  const went = sent.data.messages.find((m) =>
    m.kind === "booking-confirmation" && m.status === "sent");
  if (went) {
    /* The hotel's own clock (113). "by -" where this reader may not see
       who (MEMORY 283), never "by the system" for something a person did. */
    const who = went.sentBy ?? (went.byAPerson ? "-" : "the system");
    return (
      <p className="text-base text-grey-600">
        Voucher sent {dateShort(went.sentAt.slice(0, 10))}, {went.sentAt.slice(11, 16)} by {who}.
      </p>
    );
  }

  const send = async () => {
    setBusy(true);
    const r = await sendVoucher(hotelId, stayId);
    setBusy(false);
    if (!r.ok) return toast.error("Voucher not sent", r.reason);
    toast.success("Voucher sent");
    void sent.refetch();
  };

  return (
    <div className="space-y-1">
      <Button variant="secondary" loading={busy} disabled={!sent.data.connected || test}
        onClick={() => void send()}>
        <Send className="size-4" /> Send voucher
      </Button>
      {test ? (
        <p className="text-sm text-grey-500">{NOTHING_SENT}</p>
      ) : !sent.data.connected && (
        <p className="text-sm text-grey-500">{sent.data.notConnected}</p>
      )}
    </div>
  );
}
