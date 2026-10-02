import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, CardBody, Field, Input, fieldProps } from "@/components/ui";
import { keepUnlockFor, openByRoom, sendRoomCode } from "@/modules/online-checkin/data/guestWays";
import { messageFrom } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   YOUR STAY, BY ROOM AND PHONE - /g/h/:hotel (D27-235 2.4)

   For a guest staying now without the room's card or their booking's link:
   the room number and the phone number, then the six digits the door sends
   to the booking's own number - and only when both match. The door answers
   the same either way, so this page says the same either way: it cannot
   tell a stranger which room is whose. Outside the sign-in gate, like the
   guest's own page; the hotel's QR card (HotelCard.tsx) opens it.
   ══════════════════════════════════════════════════════════════════ */

export default function ByRoomPage() {
  const { hotel = "" } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const asked = useMutation({ mutationFn: () => sendRoomCode(hotel, room.trim(), phone.trim()) });
  const ticket = asked.data?.ticket;
  const opened = useMutation({
    mutationFn: () => openByRoom(ticket!, code.trim()),
    onSuccess: (r) => { keepUnlockFor(ticket!, r.unlock); navigate(`/g/${ticket}`, { replace: true }); },
  });

  return (
    <main className="min-h-dvh bg-grey-50 px-5 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <h1 className="page-title text-ink-900 mb-1">Your stay</h1>
        <p className="text-sm text-grey-600 mb-5">
          Staying with us now? Type your room number and the phone number on your booking.
        </p>
        <Card><CardBody>
          <form className="flex flex-col gap-3"
                onSubmit={(e) => { e.preventDefault(); asked.mutate(); }}>
            <Field label="Your room number">
              {(f) => <Input {...fieldProps(f)} inputMode="numeric" autoComplete="off" maxLength={10}
                             value={room} onChange={(e) => setRoom(e.target.value)} />}
            </Field>
            <Field label="Your phone number">
              {(f) => <Input {...fieldProps(f)} type="tel" autoComplete="tel" maxLength={20}
                             value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <Button type="submit" variant={ticket ? "secondary" : "primary"}
                    disabled={asked.isPending || !room.trim() || phone.replace(/\D/g, "").length < 10}>
              {asked.isPending ? "Sending…" : ticket ? "Send a new code" : "Send me a code"}
            </Button>
            {asked.data && <p className="text-sm text-grey-600" role="status">{asked.data.message}</p>}
            {import.meta.env.DEV && asked.data?.devCode && (
              <p className="text-sm text-warning-dark">Development only - the code is {asked.data.devCode}</p>
            )}
            {asked.error && <p className="text-sm text-brand-red-700">{messageFrom(asked.error)}</p>}
          </form>

          {ticket && (
            <form className="flex flex-col gap-3 mt-3.5 border-t border-grey-100 pt-3.5"
                  onSubmit={(e) => { e.preventDefault(); opened.mutate(); }}>
              <Field label="The six digits">
                {(f) => <Input {...fieldProps(f)} inputMode="numeric" autoComplete="one-time-code"
                               maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />}
              </Field>
              <Button type="submit" variant="primary"
                      disabled={opened.isPending || code.replace(/\D/g, "").length !== 6}>
                {opened.isPending ? "Opening…" : "Open my stay"}
              </Button>
              {opened.error && <p className="text-sm text-brand-red-700">{messageFrom(opened.error)}</p>}
            </form>
          )}
        </CardBody></Card>
      </div>
    </main>
  );
}
