import { useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Printer } from "lucide-react";
import { getOrder, nextBillHeading, printBillHere, type BillHeading } from "@/modules/pos/data/till";
import { useGroupSettings } from "@/modules/admin";
import { BillSlip } from "@/modules/pos/components/BillSlip";
import { ReadFailed, Button, toast } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE BILL PAGE — the bill on this device

   It prints from the browser; there is no driver and no native app, which
   is the whole reason this system is web based. The paper is BillSlip,
   the same the bill printer prints (D27-292).

   "PRINT HERE" (the owner's D27-292): with a bill printer chosen, Print bill
   sends the bill there; this page is where it is printed on the device
   instead - with none chosen, or with the bill printer offline. Printing
   here takes a bill waiting at the bill printer off its list, and the paper
   says what it is: INTERIM BILL, BILL, or BILL · DUPLICATE.
   ══════════════════════════════════════════════════════════════════ */

export default function BillPage() {
  const { code, id } = useParams();
  const hotelId = code ?? "";
  /* The group's name and logo, as on every bill (D27-53). */
  const group = useGroupSettings(hotelId);
  /* What the server said this print is, once it has been asked. */
  const [printed, setPrinted] = useState<BillHeading | null>(null);
  const [busy, setBusy] = useState(false);

  const order = useQuery({
    queryKey: ["bill", hotelId, id],
    queryFn: () => getOrder(hotelId, id ?? ""),
    enabled: !!id,
    /* Asked each time: whether it is paid decides what it says it is. */
    staleTime: 0,
  });

  if (order.isLoading) {
    return <p className="p-8 text-grey-500">Loading…</p>;
  }
  /* POS-4: every failure used to print "No such order." on the page a
     guest is handed. The server says that itself when it is true. */
  if (!order.data && order.error) {
    return (
      <ReadFailed
        error={order.error}
        what="this bill"
        onRetry={() => void order.refetch()}
      />
    );
  }
  if (!order.data) {
    return <p className="p-8 text-grey-500">No such order.</p>;
  }

  const o = order.data;
  const heading = printed ?? nextBillHeading(o);

  /* The print is written down first, so the bill printer does not print it
     too and the next one says DUPLICATE; then the paper. */
  const printHere = async () => {
    setBusy(true);
    let res: Awaited<ReturnType<typeof printBillHere>>;
    try {
      res = await printBillHere(hotelId, o.id);
    } catch {
      res = { ok: false, reason: "The connection is down. Print it again when it is back." };
    } finally {
      setBusy(false);
    }
    if (!res.ok) return void toast.error("Not printed", res.reason);
    const told = res.heading;
    flushSync(() => setPrinted(told));
    window.print();
  };

  return (
    <div className="bg-grey-100 print:bg-white min-h-screen py-6 print:py-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: 80mm auto; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex gap-2 px-3" style={{ maxWidth: "80mm" }}>
        <Button loading={busy} onClick={() => void printHere()}>
          <Printer className="size-4" />
          Print here
        </Button>
        <Button onClick={() => window.close()}>
          Close
        </Button>
      </div>

      <BillSlip order={o} group={group} heading={heading} />
    </div>
  );
}
