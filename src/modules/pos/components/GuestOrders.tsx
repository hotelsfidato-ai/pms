import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble } from "lucide-react";
import { money } from "@/lib/format";
import { toast } from "@/components/ui";
import { AskDialog, type Ask } from "@/modules/pos/components/AskDialog";
import { listGuestOrders, acceptGuestOrder, declineGuestOrder } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   GUESTS' ROOM-SERVICE ORDERS, ON THE TERMINAL (D27-224, D27-225)

   An order from a guest's own page waits here until whoever rings the
   till answers it. Accept and send makes it a room-service order for the
   guest's room and sends it to the kitchen; Decline asks why, in a line
   the guest reads. Nothing here when nothing waits.
   ══════════════════════════════════════════════════════════════════ */
export function GuestOrders({ hotelId, onAccepted }: {
  hotelId: string; onAccepted: (orderId: string) => void;
}) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["till-guest-orders", hotelId],
    queryFn: () => listGuestOrders(hotelId),
    refetchInterval: 20_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const orders = list.data ?? [];
  if (orders.length === 0) return null;

  const done = () => void qc.invalidateQueries({ queryKey: ["till-guest-orders"] });
  const accept = async (id: string) => {
    setBusy(id);
    const res = await acceptGuestOrder(hotelId, id);
    setBusy(null);
    /* The server's sentence - a price that moved or a dish gone off names
       the dish (Q1): decline it and tell the guest. */
    if (!res.ok) return toast.error("Not accepted", res.reason);
    toast.success("Sent to the kitchen", "A room-service order for the guest's room.");
    done();
    onAccepted(res.order.id);
  };
  const decline = (id: string, room: string | null) => setAsk({
    title: `Decline ${room ? `Room ${room}'s` : "this"} order?`,
    body: "The guest reads your reason on their page.",
    field: { label: "Why?", required: true, hint: "Out of paneer tonight - the dal is ready now." },
    confirm: "Decline",
    onConfirm: async (why) => {
      const res = await declineGuestOrder(hotelId, id, why ?? "");
      if (!res.ok) return void toast.error("Not declined", res.reason);
      done();
    },
  });

  return (
    <section className="mb-5">
      <p className="text-2xs uppercase tracking-wide text-grey-500 mb-2">Room-service orders waiting</p>
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id} className="rounded-lg border-2 border-brand-orange bg-white p-3">
            <div className="flex items-center gap-2">
              <BedDouble className="size-4 text-brand-orange shrink-0" />
              <span className="text-base font-semibold text-ink-900">{o.room ? `Room ${o.room}` : "Room service"}</span>
              <span className="ml-auto tabular text-base text-ink-900">
                {money(o.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0))}
              </span>
            </div>
            <p className="text-base text-ink-900 mt-1">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</p>
            {o.note && <p className="text-sm text-brand-orange-700 mt-0.5">{o.note}</p>}
            <div className="flex gap-2 mt-2">
              <button type="button" disabled={busy === o.id} onClick={() => void accept(o.id)}
                      className="press flex-1 h-12 rounded-full bg-brand-orange text-white text-base font-semibold cursor-pointer disabled:opacity-50">
                Accept and send
              </button>
              <button type="button" onClick={() => decline(o.id, o.room)}
                      className="press h-12 px-5 rounded-full border border-grey-300 bg-white text-base font-medium text-ink-900 cursor-pointer">
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      <AskDialog ask={ask} onClose={() => setAsk(null)} />
    </section>
  );
}
