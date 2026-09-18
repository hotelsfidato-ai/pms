import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserRound, Phone, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import { setOrderHeader, listWaiters, type Order } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   THE ORDER HEADER

   Covers, waiter, customer and channel — the row of icons above the
   bill on every till in the trade.

   COLLAPSED BY DEFAULT, and it should be. Most orders are a dine-in
   table where none of this is filled in, and a panel that demanded
   four answers before a dish could be rung would be worked around by
   the second evening. What it shows when closed is only what has been
   ANSWERED, so an empty header takes one line and a full one reads
   back at a glance.

   ONE SAVE for all five fields, because they are one panel. Four
   writes would let three of them fail on their own and leave the
   header half entered with nothing saying which half.
   ══════════════════════════════════════════════════════════════════ */

const CHANNELS: { key: Order["orderType"]; label: string }[] = [
  { key: "dine_in", label: "Dine in" },
  { key: "takeaway", label: "Take away" },
  { key: "room_service", label: "Room service" },
  { key: "delivery", label: "Delivery" },
];

export function OrderHeaderPanel({
  order, hotelId, onChanged,
}: {
  order: Order;
  hotelId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [covers, setCovers] = useState(
    order.covers === null ? "" : String(order.covers));
  const [waiterId, setWaiterId] = useState("");
  const [channel, setChannel] = useState<Order["orderType"]>(order.orderType);
  const [name, setName] = useState(order.customerName ?? "");
  const [phone, setPhone] = useState(order.customerPhone ?? "");
  const [address, setAddress] = useState(order.customerAddress ?? "");
  const [locality, setLocality] = useState(order.customerLocality ?? "");

  const waiters = useQuery({
    queryKey: ["waiters", hotelId],
    queryFn: () => listWaiters(hotelId),
    enabled: open,
    staleTime: 10 * 60_000,
  });

  const settled = order.status !== "open";

  const save = async () => {
    setBusy(true);
    const res = await setOrderHeader(hotelId, order.id, {
      covers: covers.trim() === "" ? null : Number(covers),
      ...(waiterId ? { waiterId } : {}),
      orderType: channel,
      customerName: name,
      customerPhone: phone,
      customerAddress: address,
      customerLocality: locality,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    setOpen(false);
    onChanged();
  };

  const hold = async (held: boolean) => {
    setBusy(true);
    const res = await setOrderHeader(hotelId, order.id, { held });
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(held ? "Held" : "Back on");
    onChanged();
  };

  /* Only what has been ANSWERED. An empty header is one quiet line; a
     full one reads back without opening anything. */
  const summary = [
    order.covers !== null && `${order.covers} cover${order.covers === 1 ? "" : "s"}`,
    order.waiter,
    order.orderType !== "dine_in"
      && CHANNELS.find((c) => c.key === order.orderType)?.label,
    order.customerName,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap px-4 pb-2">
        <button
          type="button"
          disabled={settled}
          onClick={() => setOpen(true)}
          className={cn(
            "flex items-center gap-2 text-sm rounded-md px-2 py-1 -ml-2",
            "transition-colors duration-200",
            settled
              ? "text-grey-500 cursor-not-allowed"
              : "text-grey-600 hover:bg-grey-50 cursor-pointer",
          )}
        >
          <Users className="size-3.5" />
          {summary.length ? summary.join(" · ") : "Covers, waiter, customer"}
        </button>

        {order.heldAt && (
          <span className="text-2xs font-semibold uppercase tracking-wide text-brand-orange-700">
            held
          </span>
        )}

        <div className="flex-1" />

        {!settled && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void hold(order.heldAt === null)}
          >
            {order.heldAt
              ? <><Play className="size-3.5" />Resume</>
              : <><Pause className="size-3.5" />Hold</>}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="This order"
          description="All optional. A dine-in table usually needs none of it."
          footer={
            <div className="flex gap-2 w-full justify-end">
              <Button variant="secondary" size="lg"
                onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>
                Save
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                Where it is going
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setChannel(c.key)}
                    className={cn(
                      "min-h-12 rounded-md border text-base cursor-pointer",
                      "transition-colors duration-200",
                      channel === c.key
                        ? "border-brand-orange bg-orange-50 text-brand-orange-700"
                        : "border-grey-300 text-grey-700 hover:bg-grey-50",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Covers" hint="People eating, not seats">
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    type="number"
                    inputMode="numeric"
                    value={covers}
                    onChange={(e) => setCovers(e.target.value)}
                    placeholder="-"
                  />
                )}
              </Field>
              {/* POS-4: a list that failed looked like a property with
                  nobody to choose. The order keeps the waiter it has. */}
              <Field
                label="Waiter"
                hint={waiters.data === undefined && waiters.error
                  ? "The list of waiters did not load. The order keeps the waiter it has."
                  : undefined}
              >
                {(f) => (
                  <NativeSelect
                    {...fieldProps(f)}
                    value={waiterId}
                    onChange={(e) => setWaiterId(e.target.value)}
                  >
                    <option value="">
                      {order.waiter ?? "-"}
                    </option>
                    {(waiters.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </div>

            <div>
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                Customer
              </h4>
              {channel === "delivery" && !phone.trim() && (
                /* Said BEFORE the bill is cooked. The server refuses at
                   settlement, by which point the kitchen has already
                   made it. */
                <p className="flex items-start gap-2 text-sm text-[#8a6300] mb-2">
                  <Phone className="size-4 shrink-0 mt-0.5" />
                  <span>
                    A delivery needs a phone number, or it gets cooked and
                    cannot leave the building.
                  </span>
                </p>
              )}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mobile">
                    {(f) => (
                      <Input
                        {...fieldProps(f)}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="-"
                      />
                    )}
                  </Field>
                  <Field label="Name">
                    {(f) => (
                      <Input
                        {...fieldProps(f)}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="-"
                      />
                    )}
                  </Field>
                </div>
                {channel === "delivery" && (
                  <>
                    <Field label="Address">
                      {(f) => (
                        <Input
                          {...fieldProps(f)}
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="-"
                        />
                      )}
                    </Field>
                    <Field label="Locality">
                      {(f) => (
                        <Input
                          {...fieldProps(f)}
                          value={locality}
                          onChange={(e) => setLocality(e.target.value)}
                          placeholder="-"
                        />
                      )}
                    </Field>
                  </>
                )}
              </div>
            </div>

            {order.waiter && (
              <p className="flex items-center gap-2 text-sm text-grey-600">
                <UserRound className="size-3.5" />
                Currently {order.waiter}. Leaving the picker alone keeps them.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
