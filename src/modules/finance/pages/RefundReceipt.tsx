import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button, DocPage } from "@/components/ui";
import { useDocumentTitle } from "@/lib/documentTitle";
import { moneyPrecise, dateShort } from "@/lib/format";
import { placeLine } from "../place";
import { getRefundReceipt } from "../data/refunds";

/* ══════════════════════════════════════════════════════════════════
   THE REFUND RECEIPT, ON PAPER (the owner's D27-315 Part B)

   A plain receipt: what was given back, how, the reference, why and by
   whom. Not the GST refund voucher (Rule 51), which waits for the CA
   (B5/C2) - and it says so on the paper. A page of its own, like the
   interim bill, so the app's shell stays off the print.
   ══════════════════════════════════════════════════════════════════ */

export default function RefundReceiptPage() {
  const { code = "", id = "", postingId = "" } = useParams();
  const receipt = useQuery({
    queryKey: ["refund-receipt", code, id, postingId],
    queryFn: () => getRefundReceipt(code, id, postingId),
  });
  useDocumentTitle("Refund receipt");
  const r = receipt.data;

  return (
    <DocPage
      toolbar={
        <Button variant="primary" onClick={() => window.print()} disabled={!r}>
          <Printer className="size-4" />
          Print
        </Button>
      }
    >
      {r ? (
        <article className="space-y-5 text-ink-900" data-refund-receipt>
          <header className="space-y-0.5">
            <p className="text-lg font-semibold">{r.hotel.name}</p>
            <p className="text-sm text-grey-700">{placeLine(r.hotel.address, r.hotel.city, r.hotel.state)}</p>
            {r.hotel.phone && <p className="text-sm text-grey-700">{r.hotel.phone}</p>}
            {r.hotel.gstin && <p className="text-sm text-grey-700">GSTIN {r.hotel.gstin}</p>}
          </header>
          <h1 className="text-xl font-semibold">Refund receipt</h1>
          {r.takenBack && (
            <p className="text-base font-semibold text-brand-red-700">This refund was taken back.</p>
          )}
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-base">
            <dt className="text-grey-600">Receipt</dt><dd className="tabular">{r.number}</dd>
            <dt className="text-grey-600">Date</dt><dd>{dateShort(r.date)}</dd>
            <dt className="text-grey-600">Guest</dt><dd>{r.guest}</dd>
            <dt className="text-grey-600">Booking</dt><dd>{r.booking}{r.room ? `, Room ${r.room}` : ""}</dd>
            <dt className="text-grey-600">Amount refunded</dt>
            <dd className="font-semibold tabular">{moneyPrecise(r.amount)}</dd>
            {/* A cash refund handed over to the rupee (D27-337 (d)). */}
            {r.roundOff ? (
              <>
                <dt className="text-grey-600">Cash given</dt>
                <dd className="tabular">
                  {moneyPrecise(r.amount + r.roundOff)} (round-off {r.roundOff > 0 ? "+" : "-"}{moneyPrecise(Math.abs(r.roundOff))})
                </dd>
              </>
            ) : null}
            <dt className="text-grey-600">Back by</dt><dd>{r.method}</dd>
            <dt className="text-grey-600">Reference</dt><dd>{r.reference ?? "-"}</dd>
            <dt className="text-grey-600">Why</dt><dd>{r.reason}</dd>
            <dt className="text-grey-600">Given by</dt><dd>{r.givenBy ?? "-"}</dd>
          </dl>
          <p className="text-sm text-grey-600">
            A plain refund receipt. The GST refund voucher (Rule 51) waits for the hotel's CA.
          </p>
          <div className="grid grid-cols-2 gap-8 pt-10 text-sm text-grey-600">
            <p className="border-t border-grey-300 pt-1">Guest's signature</p>
            <p className="border-t border-grey-300 pt-1">For {r.hotel.name}</p>
          </div>
        </article>
      ) : receipt.isError ? (
        <p className="text-sm text-brand-red-700">The refund could not be read. Try again.</p>
      ) : (
        <p className="text-sm text-grey-600">One moment…</p>
      )}
    </DocPage>
  );
}
