import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Check, Link2, Send } from "lucide-react";
import { dateShort } from "@/lib/format";
import { Button, Card, CardBody, CardHeader, Input, toast } from "@/components/ui";
import { getGuestMessages } from "@/modules/guest-messaging";
import { confirmWaiting, makeGuestLink, sendVoucher } from "@/modules/reservations/data/booking";

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
      <CardHeader title={waiting ? "Held, waiting for the hotel" : "Booked"}
        description={booked.guest} />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-grey-200">
          {booked.bookings.map((b) => {
            const a = booked.assigned[b.reference];
            return (
              <li key={b.reference} className="py-2 flex flex-wrap justify-between gap-x-4 text-base">
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
            {lead && <Voucher hotelId={hotelId} stayId={lead} />}
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-grey-200">
          {booked.arrivesToday && !waiting && booked.bookings.length === 1 && lead && (
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
      <Button variant="secondary" loading={busy} disabled={!sent.data.connected}
        onClick={() => void send()}>
        <Send className="size-4" /> Send voucher
      </Button>
      {!sent.data.connected && (
        <p className="text-sm text-grey-500">{sent.data.notConnected}</p>
      )}
    </div>
  );
}
