import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { getGuestMessages, sendCheckInLink } from "./data/guestMessages";

/* ══════════════════════════════════════════════════════════════════
   SEND CHECK-IN LINK (D27-105) - one button, for whichever screen shows
   a booking

   Since D27-264 it RESENDS THE VOUCHER, whose PDF prints the guest's own
   check-in page as a link and a QR code - every way the guest can be
   reached (WhatsApp on the tick, and email). The server decides and refuses
   a booking still waiting for the hotel. Each press sends it again: a clerk
   who presses twice means it. Where nothing can send, the button is off and
   the sender's own sentence says why (D21-25), never a button that was
   never going to work. HIDDEN where the hotel switched online check-in off
   (on by default, D27-281).
   ══════════════════════════════════════════════════════════════════ */

export function SendCheckInLink({ hotelId, stayId }: { hotelId: string; stayId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  /* The same read, and the same key, as the voucher beside it. */
  const sent = useQuery({
    queryKey: ["guest-messages", hotelId, stayId],
    queryFn: () => getGuestMessages(hotelId, stayId),
  });
  const connected = sent.data?.connected ?? false;
  if (!sent.data?.onlineCheckIn) return null;

  const send = async () => {
    setBusy(true);
    try {
      await sendCheckInLink(hotelId, stayId);
      toast.success("Voucher sent again, with the check-in link");
      void qc.invalidateQueries({ queryKey: ["guest-messages", hotelId, stayId] });
    } catch (error) {
      toast.error("Voucher not sent", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="secondary" loading={busy} disabled={!connected} onClick={() => void send()}>
        <Link2 className="size-4" /> Send check-in link
      </Button>
      {sent.data && !connected && (
        <p className="text-sm text-grey-500">{sent.data.notConnected}</p>
      )}
    </div>
  );
}
