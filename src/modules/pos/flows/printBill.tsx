import { useState } from "react";
import { toast } from "@/components/ui";
import { AskDialog, type Ask } from "@/modules/pos/components/AskDialog";
import { askBillPrint, BILL_TITLE } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   PRINT BILL, FROM ANY SCREEN (the owner's D27-292)

   With a bill printer chosen in Restaurant setup's KOT section, the bill
   goes there and prints silently, and the screen says where it went:
   "Interim bill sent to Bar PC". Offline, the screen offers Print here
   - the bill still waits there unless it is printed here. With none
   chosen, the bill opens on this device, as it always did (the owner).

   One flow for Tables, the Till and the Terminal, so the three cannot
   disagree about where a bill went.
   ══════════════════════════════════════════════════════════════════ */

export function useBillPrint(hotelId: string) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const here = (orderId: string) => window.open(`/pos/${hotelId}/bill/${orderId}`, "_blank");

  /** `after`: once the server has the print - the floor's "Bill printed". */
  const print = async (orderId: string, after?: () => void) => {
    let res: Awaited<ReturnType<typeof askBillPrint>>;
    try {
      res = await askBillPrint(hotelId, orderId);
    } catch {
      return void toast.error("Not printed", "The connection is down. Print it again when it is back.");
    }
    if (!res.ok) return void toast.error("Not printed", res.reason);
    after?.();
    const what = BILL_TITLE[res.heading];
    if (!res.sentTo) return void here(orderId);
    if (res.sentTo.online) return void toast.success(`${what} sent to ${res.sentTo.name}`);
    const printer = res.sentTo.name;
    setAsk({
      title: `${printer} is offline`,
      body: `The bill printer has not been seen for a while. The ${what.toLowerCase()} waits there and prints when it is back - or print it here now.`,
      confirm: "Print here",
      onConfirm: () => { here(orderId); },
    });
  };

  return { print, dialog: <AskDialog ask={ask} onClose={() => setAsk(null)} /> };
}
