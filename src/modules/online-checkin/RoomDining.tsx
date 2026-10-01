import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Button, Card, CardBody, Input, StatusPill } from "@/components/ui";
import { DishDialog, unitPriceOf, type MenuItem } from "@/modules/pos";
import { SECTION, H2, LEAD, useUnlockGone, messageFrom } from "./guestKit";
import {
  getGuestMenu, getMyFoodOrders, placeFoodOrder, cancelFoodOrder, type GuestFoodLine,
} from "./data/roomDining";

/* ══════════════════════════════════════════════════════════════════
   IN-ROOM DINING (D27-224, D27-225; the in-stay plan, A)

   The restaurant's menu on the guest's own page, behind the code. A tap
   puts a dish in the basket - a dish with choices asks them in the
   waiter's own pop-up (Q2) - and the one note is for the whole order (Q3).
   Prices are shown with "GST added on your bill" (the owner). The order is
   a SUBMISSION: the restaurant accepts it, or declines it saying why, and
   the guest sees which. Charged to the room when it arrives.

   HIDES ITSELF when the restaurant is not taking orders and the guest has
   none to follow (MODULE.md, rule 8).
   ══════════════════════════════════════════════════════════════════ */

type Line = GuestFoodLine & { key: string; item: MenuItem };

const STATUS: Record<string, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  waiting: { label: "Waiting for the restaurant", tone: "warning" },
  accepted: { label: "On its way", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  cancelled: { label: "Taken back", tone: "neutral" },
};

export default function RoomDining(
  { token, onUnlockGone }: { token: string; onUnlockGone: () => void },
) {
  const qc = useQueryClient();
  const menu = useQuery({ queryKey: ["guest-behind", token, "menu"], queryFn: () => getGuestMenu(token), retry: false });
  const mine = useQuery({ queryKey: ["guest-behind", token, "food"], queryFn: () => getMyFoodOrders(token), retry: false });
  const [basket, setBasket] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<MenuItem | null>(null);

  const send = useMutation({
    mutationFn: () => placeFoodOrder(token, basket.map(({ key: _k, item: _i, ...l }) => l), note),
    onSuccess: async () => {
      setBasket([]); setNote("");
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "food"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFoodOrder(token, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guest-behind", token, "food"] }),
  });
  useUnlockGone(menu.error ?? mine.error ?? send.error ?? cancel.error, onUnlockGone);

  const sections = menu.data?.sections ?? [];
  const orders = mine.data?.orders ?? [];
  if (sections.length === 0 && orders.length === 0) return null;

  /* The same dish with the same choices is one more of it (D27-189). */
  const put = (item: MenuItem, qty: number, variationId?: string, addonIds?: string[], moreChoiceIds?: string[]) => {
    const key = [item.id, variationId ?? "", ...(moreChoiceIds ?? []), ...[...(addonIds ?? [])].sort()].join("|");
    setBasket((b) => b.some((l) => l.key === key)
      ? b.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l))
      : [...b, { key, item, itemId: item.id, qty, variationId: variationId ?? null,
                 moreChoiceIds: moreChoiceIds ?? [], addonIds: addonIds ?? [] }]);
    setAsking(null);
  };
  const tap = (item: MenuItem) =>
    item.variations.length > 0 || item.addonGroups.length > 0 ? setAsking(item) : put(item, 1);
  const bump = (key: string, by: number) =>
    setBasket((b) => b.flatMap((l) => l.key !== key ? [l]
      : l.qty + by <= 0 ? [] : [{ ...l, qty: Math.min(20, l.qty + by) }]));
  const price = (l: Line) => unitPriceOf(l.item, l.variationId, l.addonIds, l.moreChoiceIds);
  const total = basket.reduce((s, l) => s + price(l) * l.qty, 0);

  return (
    <section className={SECTION}>
      <h2 className={H2}>Order to your room</h2>
      <p className={cn(LEAD, "mb-3")}>From the restaurant. GST added on your bill, charged to your room when it arrives.</p>

      {sections.length > 0 && (
        <Card><CardBody className="space-y-4">
          {sections.map((s) => (
            <div key={s.name}>
              <p className="text-2xs uppercase tracking-wide text-grey-500 mb-1.5">{s.name}</p>
              <ul className="divide-y divide-grey-100">
                {s.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => tap(item)}
                            className="press w-full min-h-12 flex items-center gap-3 text-left cursor-pointer">
                      <span className="flex-1 min-w-0 text-base text-ink-900">{item.name}</span>
                      {/* A dish sold by its choices has no price of its own: a dash. */}
                      <span className="tabular text-base text-ink-900">
                        {item.variations.length > 0 ? "-" : item.price === 0 ? "Free" : money(item.price)}
                      </span>
                      <Plus className="size-4 text-grey-500 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {basket.length > 0 && (
            <div className="border-t border-grey-200 pt-3 space-y-2">
              {basket.map((l) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-base text-ink-900">{l.item.name}</span>
                  <button type="button" aria-label={`One less ${l.item.name}`} onClick={() => bump(l.key, -1)}
                          className="press size-11 grid place-items-center rounded-full border border-grey-300 cursor-pointer">
                    <Minus className="size-4" />
                  </button>
                  <span className="tabular w-6 text-center">{l.qty}</span>
                  <button type="button" aria-label={`One more ${l.item.name}`} onClick={() => bump(l.key, 1)}
                          className="press size-11 grid place-items-center rounded-full border border-grey-300 cursor-pointer">
                    <Plus className="size-4" />
                  </button>
                </div>
              ))}
              <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
                     placeholder="A note for the kitchen (optional)" aria-label="A note for the kitchen" />
              <div className="flex items-center gap-3">
                <span className="tabular text-md font-semibold text-ink-900">{money(total)}</span>
                <span className="text-2xs text-grey-500">GST added on your bill</span>
                <Button variant="primary" className="ml-auto" loading={send.isPending}
                        onClick={() => send.mutate()}>
                  Order
                </Button>
              </div>
              {send.error && <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>}
            </div>
          )}
        </CardBody></Card>
      )}

      {orders.length > 0 && (
        <ul className="mt-3 space-y-2">
          {orders.map((o) => (
            <li key={o.id}><Card><CardBody className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusPill tone={STATUS[o.status]?.tone ?? "neutral"}>{STATUS[o.status]?.label ?? o.status}</StatusPill>
                {o.status === "waiting" && (
                  <Button variant="secondary" size="sm" className="ml-auto" loading={cancel.isPending}
                          onClick={() => cancel.mutate(o.id)}>
                    Take it back
                  </Button>
                )}
              </div>
              <p className="text-sm text-ink-900">{o.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</p>
              {o.reason && <p className="text-sm text-grey-600">{o.reason}</p>}
            </CardBody></Card></li>
          ))}
        </ul>
      )}

      <DishDialog
        item={asking}
        guest
        open={asking !== null}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        onAdd={(_id, qty, _note, variationId, addonIds, moreChoiceIds) => {
          if (asking) put(asking, qty, variationId, addonIds, moreChoiceIds);
        }}
      />
    </section>
  );
}
