import type { Docket } from "@/modules/pos/data/till";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN DOCKET — what the chef is handed

   80 mm thermal roll, printed by the KOT station alone (D27-159,
   components/KotStation.tsx). It was a page of its own that every
   waiter's device opened on each send (D17-18), retired by D27-161.

   WHAT IT IS NOT: a bill. There are no prices on it and there never
   will be. A chef reading a docket is deciding what to cook and in
   what order, and a column of rupees is noise on a rail above a
   hotplate — worse, it invites the wrong document being handed to a
   guest.

   ONE BATCH, NOT THE ORDER. Starters, then mains, then the dessert
   somebody changed their mind about: three dockets, three numbers,
   one bill. The kitchen works from paper in the order it arrived.
   ══════════════════════════════════════════════════════════════════ */

const TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine In",
  takeaway: "Parcel",
  room_service: "Room Service",
  delivery: "Delivery",
};

export function DocketSlip({ d }: { d: Docket }) {
  /* A TEST HOTEL'S KOT (the owner's D27-296 (8)): TEST · NOT VALID at its
     head and foot, so a practice docket on a real rail is never cooked.
     Nothing else changes, in a test hotel or a real one. */
  const test = useIsTestHotel();
  return (
    <div className="mx-auto px-3 py-4 w-[80mm] font-mono text-[13px] leading-snug bg-white text-ink-900">
      {test && <TestDocumentMark slip />}
      <p className="text-center tabular">{d.sentAt}</p>
      {/* The number, biggest thing on the paper. A chef finds a docket
          on a rail of twenty by its number and nothing else. */}
      {/* WHAT IT IS, BIG, between two rules (the owner's D27-292): one
          printer may take every kind, so the slip says which - "BAR KOT 14"
          - and a reprint says so too. A docket from before kinds is "KOT". */}
      <p className="mt-1 border-y-2 border-ink-900 py-1 text-center text-[22px] font-bold tracking-wide"
         data-kot-heading>
        {d.kind ? `${d.kind.name.toUpperCase()} KOT ${d.kotNo}` : `KOT - ${d.kotNo}`}
      </p>
      {d.reprint && (
        <p className="text-center font-bold tracking-wide mt-0.5">REPRINT</p>
      )}
      {/* A parcel (D27-359) is "Parcel · <customer>", big, in place of a table. */}
      {d.orderType === "takeaway" ? (
        <p className="text-center font-bold text-[16px] mt-1">{d.table ?? "Parcel"}</p>
      ) : (
        <>
          <p className="text-center font-bold mt-1">
            {TYPE_LABEL[d.orderType] ?? d.orderType}
          </p>
          {d.table && (
            <p className="text-center font-bold">Table No: {d.table}</p>
          )}
        </>
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
        {/* Each dish with what hangs under it. An add-on line whose dish
            went on an earlier KOT (D27-291) stands on its own, naming it. */}
        {d.lines.filter((l) => l.parentId === null || l.for).map((dish) => {
          if (dish.for) {
            return (
              <li key={dish.id} className="mb-2">
                <div className="flex">
                  <span className="flex-1 font-bold">+ {dish.name}</span>
                  <span className="w-10 text-right font-bold tabular">{dish.qty}</span>
                </div>
                <div className="pl-4">
                  for: {dish.for.name}{dish.for.kotNo !== null ? ` (KOT ${dish.for.kotNo})` : ""}
                </div>
              </li>
            );
          }
          const sides = d.lines.filter((l) => l.parentId === dish.id && !l.extra);
          const extras = d.lines.filter((l) => l.parentId === dish.id && l.extra);
          return (
            <li key={dish.id} className="mb-2">
              <div className="flex">
                <span className="flex-1 font-bold">{dish.name}</span>
                <span className="w-10 text-right font-bold tabular">
                  {dish.qty}
                </span>
              </div>
              {/* The numbered add-ons ON this dish (D27-289), each on a line
                  of its own and bold - the owner: "+ Kebab" under the dish,
                  so a cook does not read past it. Per one of the dish. */}
              {(dish.plus ?? []).map((p, i) => (
                <div key={i} className="pl-4 font-bold">
                  + {p.name}{p.qty > 1 ? ` ×${p.qty}` : ""}
                </div>
              ))}
              {/* Indented, which is the whole reason this is printed
                  rather than listed. Flat, a chef plates the sides as
                  separate dishes. */}
              {sides.map((s) => (
                <div key={s.id} className="pl-4 italic">
                  {s.name} - {s.qty}
                </div>
              ))}
              {/* Its add-on lines (D27-291), bold, each with its own number. */}
              {extras.map((x) => (
                <div key={x.id} className="flex pl-4 font-bold">
                  <span className="flex-1">+ {x.name}</span>
                  <span className="w-10 text-right tabular">{x.qty}</span>
                </div>
              ))}
              {dish.note && (
                <div className="pl-4 italic">[Note] {dish.note}</div>
              )}
            </li>
          );
        })}
      </ul>

      {d.lines.length === 0 && (d.struck ?? []).length === 0 && (
        <p className="mt-2 italic">
          Everything on this docket was struck before it printed.
        </p>
      )}

      {/* Taken off after the kitchen had it, with the manager's reason
          (D27-119): a reprint tells the kitchen to stop, and why. */}
      {(d.struck ?? []).length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-ink-900" />
          <p className="font-bold">STOP - TAKEN OFF</p>
          <ul className="mt-1">
            {d.struck!.map((s, i) => (
              <li key={i} className="mb-1.5">
                <div className="flex">
                  <span className="flex-1 font-bold line-through">{s.name}</span>
                  <span className="w-10 text-right font-bold tabular">{s.qty}</span>
                </div>
                {s.reason && <div className="pl-4 italic">[Why] {s.reason}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 text-center text-[11px]">
        {d.outlet} · {d.orderNo}
      </p>
      {test && <TestDocumentMark slip />}
    </div>
  );
}
