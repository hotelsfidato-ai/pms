import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { getDocket } from "@/modules/pos/data/till";
import { ReadFailed } from "@/modules/pos/components/ReadProblem";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN DOCKET — what the chef is handed

   Thermal-roll width, like the bill, and printed from the browser.

   WHAT IT IS NOT: a bill. There are no prices on it and there never
   will be. A chef reading a docket is deciding what to cook and in
   what order, and a column of rupees is noise on a rail above a
   hotplate — worse, it invites the wrong document being handed to a
   guest.

   ONE BATCH, NOT THE ORDER. Starters, then mains, then the dessert
   somebody changed their mind about: three dockets, three numbers,
   one bill. The kitchen works from paper in the order it arrived.

   THE PASS SCREEN STAYS. It is better than paper — oldest first,
   colour by wait, a struck dish shown loudly — but most kitchens run
   on the docket, and a system that only offered the screen would be
   printed from somebody's phone instead.
   ══════════════════════════════════════════════════════════════════ */

const TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine In",
  takeaway: "Take Away",
  room_service: "Room Service",
  delivery: "Delivery",
};

export default function DocketPage() {
  const { code, id, no } = useParams();
  const hotelId = code ?? "";

  const docket = useQuery({
    queryKey: ["docket", hotelId, id, no],
    queryFn: () => getDocket(hotelId, id ?? "", Number(no)),
    enabled: Boolean(id && no),
  });

  if (docket.isLoading) {
    return <p className="p-8 text-grey-500">Loading…</p>;
  }
  /* POS-4: a docket that failed to load said "No such docket." — the
     server's own sentence when it truly has none, a fault otherwise. */
  if (!docket.data && docket.error) {
    return (
      <ReadFailed
        error={docket.error}
        what="this docket"
        onRetry={() => void docket.refetch()}
      />
    );
  }
  if (!docket.data) {
    return <p className="p-8 text-grey-500">No such docket.</p>;
  }

  const d = docket.data;

  return (
    <div className="bg-white text-ink-900 min-h-screen">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 4mm; size: 80mm auto; }
        }
      `}</style>

      <div className="no-print p-4 border-b border-grey-200 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="h-11 px-4 rounded-md bg-ink-900 text-white text-base font-medium cursor-pointer"
        >
          Print
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="h-11 px-4 rounded-md border border-grey-300 text-base cursor-pointer"
        >
          Close
        </button>
      </div>

      <div className="mx-auto px-3 py-4 w-[80mm] font-mono text-[13px] leading-snug">
        <p className="text-center tabular">{d.sentAt}</p>
        {/* The number, biggest thing on the paper. A chef finds a docket
            on a rail of twenty by its number and nothing else. */}
        <p className="text-center text-[19px] font-bold tracking-wide mt-1">
          KOT - {d.kotNo}
        </p>
        <p className="text-center font-bold mt-1">
          {TYPE_LABEL[d.orderType] ?? d.orderType}
        </p>
        {d.table && (
          <p className="text-center font-bold">Table No: {d.table}</p>
        )}

        {/* A border, not a row of dashes. Forty dashes is right at one
            font size and wraps to two lines at another, and the docket
            has to survive whatever the thermal printer decides. */}
        <div className="my-2 border-t border-dashed border-ink-900" />

        <div className="flex font-bold">
          <span className="flex-1">Item</span>
          <span className="w-10 text-right">Qty.</span>
        </div>

        <ul className="mt-1.5">
          {d.lines.filter((l) => !l.isAddon).map((dish) => {
            const sides = d.lines.filter((l) => l.parentId === dish.id);
            return (
              <li key={dish.id} className="mb-2">
                <div className="flex">
                  <span className="flex-1 font-bold">{dish.name}</span>
                  <span className="w-10 text-right font-bold tabular">
                    {dish.qty}
                  </span>
                </div>
                {/* Indented, which is the whole reason this is printed
                    rather than listed. Flat, a chef plates the sides as
                    separate dishes. */}
                {sides.map((s) => (
                  <div key={s.id} className="pl-4 italic">
                    {s.name} - {s.qty}
                  </div>
                ))}
                {dish.note && (
                  <div className="pl-4 italic">[Note] {dish.note}</div>
                )}
              </li>
            );
          })}
        </ul>

        {d.lines.length === 0 && (
          <p className="mt-2 italic">
            Everything on this docket was struck before it printed.
          </p>
        )}

        <p className="mt-3 text-center text-[11px]">
          {d.outlet} · {d.orderNo}
        </p>
      </div>
    </div>
  );
}
