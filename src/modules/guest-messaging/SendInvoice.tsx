import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { getGuestMessages } from "./data/guestMessages";
import { sendInvoice } from "./data/settings";

/* ══════════════════════════════════════════════════════════════════
   SEND INVOICE (D27-252, D27-261) - one button, for the Invoice page

   The tax invoice with its PDF to the stay's guest, each way they can be
   reached that it has not gone yet - a company's too (Q5), never a credit
   note (Q6). Where nothing can send, the button is off and the sender's own
   sentence says why, as Send check-in link does.
   ══════════════════════════════════════════════════════════════════ */

export function SendInvoice({ hotelId, number }: { hotelId: string; number: string }) {
  const [busy, setBusy] = useState(false);
  const state = useQuery({ queryKey: ["guest-messages", hotelId], queryFn: () => getGuestMessages(hotelId) });
  const connected = state.data?.connected ?? false;

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
      <Button variant="secondary" loading={busy} disabled={!connected} onClick={() => void send()}>
        <Send className="size-4" /> Send invoice
      </Button>
      {state.data && !connected && <p className="text-sm text-grey-500">{state.data.notConnected}</p>}
    </div>
  );
}
