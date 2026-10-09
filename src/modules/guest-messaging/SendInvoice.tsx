import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { getGuestMessages } from "./data/guestMessages";
import { sendInvoice } from "./data/settings";
import { NOTHING_SENT, useIsTestHotel } from "@/lib/testHotel";

/* ══════════════════════════════════════════════════════════════════
   SEND INVOICE (D27-252, D27-261) - one button, for the Invoice page

   The tax invoice with its PDF to the stay's guest, by email only (D27-284),
   if it has not gone yet - a company's too (Q5), never a credit
   note (Q6). Where nothing can send, the button is off and the sender's own
   sentence says why, as Send check-in link does.
   ══════════════════════════════════════════════════════════════════ */

export function SendInvoice({ hotelId, number }: { hotelId: string; number: string }) {
  const [busy, setBusy] = useState(false);
  const state = useQuery({ queryKey: ["guest-messages", hotelId], queryFn: () => getGuestMessages(hotelId) });
  const connected = state.data?.connected ?? false;
  /* NOTHING LEAVES A TEST HOTEL (the owner's D27-296 (4)): off, with the
     sentence the server refuses a send with (409). */
  const test = useIsTestHotel(hotelId);

  const send = async () => {
    setBusy(true);
    try {
      await sendInvoice(hotelId, number);
      toast.success("Invoice sent to the guest");
    } catch (error) {
      toast.error("Invoice not sent", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 print:hidden">
      <Button variant="secondary" loading={busy} disabled={!connected || test} onClick={() => void send()}>
        <Send className="size-4" /> Send invoice
      </Button>
      {test ? (
        <p className="text-sm text-grey-500">{NOTHING_SENT}</p>
      ) : state.data && !connected && <p className="text-sm text-grey-500">{state.data.notConnected}</p>}
    </div>
  );
}
