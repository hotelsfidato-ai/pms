import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Hash, PenLine } from "lucide-react";
import { moneyPrecise } from "@/lib/format";
import {
  Card, Button, StatusPill, Skeleton, EmptyState, toast,
  Dialog, DialogContent, Field, fieldProps, Input, Checkbox, ReadFailed,
} from "@/components/ui";
import {
  getNumberedAddons, addNumberedAddon, changeNumberedAddon,
  numberedAddonOff, numberedAddonOn, getCustomAddonsUsed,
  type NumberedAddon, type OffFor, type CustomAddonUsed,
} from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   THE MENU'S ADD-ONS TAB (the owner's D27-289)

   A numbered list - number, name, price, a line on what it is - that any
   dish can take. On the order, Customise beside a dish opens these by
   number: "2" is Kebab, and the dish becomes "Veg Biryani with add-on
   Kebab", one line, priced together.

   THE NUMBER IS WHAT STAFF REMEMBER, so it is typed once and never
   changes: an add-on that goes is switched off, and its number is then
   free for a new one. Not the Sides (the section on the Dishes tab),
   which are linked dish by dish and go on as lines of their own.

   Every list draws four states: loading, failed, empty (what belongs here
   and how it is used), full.
   ══════════════════════════════════════════════════════════════════ */

const OFF_FOR: { key: OffFor; label: string }[] = [
  { key: "2h", label: "2 hours" },
  { key: "4h", label: "4 hours" },
  { key: "8h", label: "8 hours" },
  { key: "next_business_day", label: "Rest of today" },
];

const isOffNow = (a: NumberedAddon) => Boolean(a.offUntil && Date.parse(a.offUntil) > Date.now());
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export function NumberedAddonsTab({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["till-addons-all", hotelId],
    queryFn: () => getNumberedAddons(hotelId, true),
    enabled: Boolean(hotelId),
  });
  const [editing, setEditing] = useState<NumberedAddon | "new" | null>(null);
  /* A custom add-on staff typed, to be numbered (D27-291): the dialog opens
     with its name and price. */
  const [preset, setPreset] = useState<{ name: string; price: number } | null>(null);
  const [offing, setOffing] = useState<NumberedAddon | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["till-addons-all"] });
    void qc.invalidateQueries({ queryKey: ["till-addons"] });
  };

  const act = async (id: string, run: () => Promise<{ ok: boolean; reason?: string }>, done: string) => {
    setBusy(id);
    const res = await run();
    setBusy(null);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(done);
    refresh();
  };

  const list = q.data ?? [];
  const inUse = list.filter((a) => a.isActive);
  const switchedOff = list.filter((a) => !a.isActive);
  const next = Math.max(0, ...inUse.map((a) => a.number)) + 1;

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-md font-semibold text-ink-900">Add-ons</h2>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Numbered extras any dish can take. On an order, tap Customise beside the dish,
            then the number: it is added to that dish and its price.
          </p>
        </div>
        <Button variant="secondary" className="h-11 shrink-0" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add an add-on
        </Button>
      </div>

      {q.isPending ? (
        <Card><div className="p-4 space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div></Card>
      ) : q.isError && !q.data ? (
        <Card><ReadFailed compact error={q.error} what="the add-ons" onRetry={() => void q.refetch()} /></Card>
      ) : inUse.length === 0 && switchedOff.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<Hash />}
            title="No add-ons yet"
            description="Add one with its number, name and price - for example 2, Kebab, ₹120. Staff tap the number under Customise on any dish."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-grey-100">
            {[...inUse, ...switchedOff].map((a) => {
              const off = isOffNow(a);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className={`tabular text-2xl font-semibold w-10 text-center ${a.isActive ? "text-ink-900" : "text-grey-400"}`}>
                    {a.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-base ${a.isActive ? "text-ink-900" : "text-grey-500"}`}>{a.name}</p>
                    {a.description && (
                      <p className="text-sm text-grey-600 truncate">{a.description}</p>
                    )}
                  </div>
                  <span className="tabular text-base text-ink-900 shrink-0">
                    {a.free ? "Free" : `+${moneyPrecise(a.price)}`}
                  </span>
                  <span className="shrink-0 sm:w-36 sm:text-right">
                    {!a.isActive ? (
                      <StatusPill tone="neutral">Switched off</StatusPill>
                    ) : off ? (
                      <StatusPill tone="warning">Off until {time(a.offUntil!)}</StatusPill>
                    ) : (
                      <StatusPill tone="success">In use</StatusPill>
                    )}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    {a.isActive && (
                      <Button variant="secondary" size="sm" className="h-11"
                              onClick={() => setEditing(a)}>
                        Change
                      </Button>
                    )}
                    {a.isActive && (off ? (
                      <Button variant="secondary" size="sm" className="h-11" loading={busy === a.id}
                              onClick={() => void act(a.id, () => numberedAddonOn(hotelId, a.id), `${a.name} is back`)}>
                        Back on
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" className="h-11"
                              onClick={() => setOffing(a)}>
                        Off for a while
                      </Button>
                    ))}
                    <Button variant="secondary" size="sm" className="h-11" loading={busy === a.id && !off}
                            onClick={() => void act(a.id,
                              () => changeNumberedAddon(hotelId, a.id, { active: !a.isActive }),
                              a.isActive ? `${a.name} switched off` : `${a.name} is add-on ${a.number} again`)}>
                      {a.isActive ? "Switch off" : "Bring back"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <CustomUsed hotelId={hotelId}
                  onNumber={(u) => { setPreset({ name: u.name, price: u.price }); setEditing("new"); }} />

      {editing !== null && (
        <AddonDialog
          hotelId={hotelId}
          addon={editing === "new" ? undefined : editing}
          {...(editing === "new" && preset ? { preset } : {})}
          suggested={next}
          onClose={() => { setEditing(null); setPreset(null); }}
          onSaved={refresh}
        />
      )}
      {offing && (
        <OffDialog
          addon={offing}
          onClose={() => setOffing(null)}
          onPick={(until) => {
            const a = offing;
            setOffing(null);
            void act(a.id, () => numberedAddonOff(hotelId, a.id, until), `${a.name} is off`);
          }}
        />
      )}
    </section>
  );
}

function AddonDialog({ hotelId, addon, suggested, onClose, onSaved, preset }: {
  hotelId: string; addon?: NumberedAddon; suggested: number;
  onClose: () => void; onSaved: () => void;
  /** A custom add-on staff typed (D27-291), to number: its name and price. */
  preset?: { name: string; price: number };
}) {
  const [number, setNumber] = useState(addon ? String(addon.number) : String(suggested));
  const [name, setName] = useState(addon?.name ?? preset?.name ?? "");
  const [description, setDescription] = useState(addon?.description ?? "");
  /* No default price (D27-120): blank until typed; 0 only when Free. A
     custom add-on's own price is what staff charged, not a default. */
  const [price, setPrice] = useState(addon && !addon.free ? String(addon.price)
    : !addon && preset && preset.price > 0 ? String(preset.price) : "");
  const [free, setFree] = useState(addon?.free ?? (preset ? preset.price === 0 : false));
  const [busy, setBusy] = useState(false);

  const n = Number(number.trim());
  const numberBad = !addon && (!/^\d+$/.test(number.trim()) || n < 1 || n > 999);
  const priceN = price.trim() === "" ? null : Number(price.trim());
  /* Rupees and paise, as typed: "120" or "120.50" - not "12.345", which the
     database would round, nor "1e2" (the audit of 9 October). */
  const priceBad = !free && (priceN === null || !/^\d+(\.\d{1,2})?$/.test(price.trim()) || priceN <= 0);
  const ready = name.trim() !== "" && !numberBad && !priceBad;

  const submit = async () => {
    setBusy(true);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      price: free ? 0 : priceN,
      free,
    };
    const res = addon
      ? await changeNumberedAddon(hotelId, addon.id, body)
      : await addNumberedAddon(hotelId, { ...body, number: n });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(addon ? `${body.name} saved` : `Add-on ${n} is ${body.name}`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={addon ? `Change add-on ${addon.number}` : "Add an add-on"}
        description={addon
          ? "Its number stays: staff know it by that."
          : "Staff will tap its number under Customise on any dish."}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!addon && (
            <Field label="Number" required hint="What staff tap. Not used by another add-on."
                   error={numberBad ? "A whole number from 1 to 999." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={number} inputMode="numeric"
                       onChange={(e) => setNumber(e.target.value)} />
              )}
            </Field>
          )}
          <Field label="Name" required hint="Printed on the bill and under the dish on the kitchen slip.">
            {(f) => (
              <Input {...fieldProps(f)} value={name} autoFocus placeholder="Kebab"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="What it is" hint="For staff: what goes on the plate.">
            {(f) => (
              <Input {...fieldProps(f)} value={description} placeholder="Two pieces of seekh kebab"
                     onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Price" required={!free} className="flex-1"
                   hint="Added to the dish. Taxed at the dish's own rate."
                   error={!free && price.trim() !== "" && priceBad ? "Rupees, more than 0 - like 120 or 120.50. Or tick Free." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={free ? "" : price} inputMode="decimal"
                       disabled={free} placeholder={free ? "Free" : "120"}
                       onChange={(e) => setPrice(e.target.value)} />
              )}
            </Field>
            <div className="pb-3">
              <Checkbox label="Free" checked={free} onCheckedChange={setFree} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── The custom add-ons used (the owner's D27-291) ────────────────────
   What staff typed in Customise these thirty days, most used first, with
   who: the common ones are the ones worth a number. Nothing joins the list
   above by itself - "Number it" opens the dialog with its name and price.
   Four states, as every list. */
function CustomUsed({ hotelId, onNumber }: {
  hotelId: string; onNumber: (u: CustomAddonUsed) => void;
}) {
  const q = useQuery({
    queryKey: ["till-custom-used", hotelId],
    queryFn: () => getCustomAddonsUsed(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 0,
  });
  const days = q.data?.days ?? 30;
  return (
    <div className="mt-6">
      <h3 className="text-md font-semibold text-ink-900">Custom add-ons used</h3>
      <p className="text-sm text-grey-600 mt-0.5 mb-3 leading-relaxed">
        What staff typed under Customise in the last {days} days. Give the common ones a number.
      </p>
      {q.isPending ? (
        <Card><div className="p-4"><Skeleton className="h-12" /></div></Card>
      ) : q.isError && !q.data ? (
        <Card><ReadFailed compact error={q.error} what="the custom add-ons" onRetry={() => void q.refetch()} /></Card>
      ) : q.data.used.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<PenLine />}
            title="None typed yet"
            description="When a guest asks for something that is not on the list, staff type it under Customise, Custom add-on. It shows here."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-grey-100">
            {q.data.used.map((u) => (
              <li key={`${u.name}-${u.price}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base text-ink-900">{u.name}</p>
                  <p className="text-sm text-grey-600 truncate">
                    {u.times} {u.times === 1 ? "time" : "times"}, {u.qty} in all
                    {u.by ? ` · by ${u.by}` : ""}
                  </p>
                </div>
                <span className="tabular text-base text-ink-900 shrink-0">
                  {u.price === 0 ? "Free" : moneyPrecise(u.price)}
                </span>
                <Button variant="secondary" size="sm" className="h-11 shrink-0" onClick={() => onNumber(u)}>
                  Number it
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function OffDialog({ addon, onClose, onPick }: {
  addon: NumberedAddon; onClose: () => void; onPick: (until: OffFor) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${addon.name} off for a while`}
        description="Customise shows it as off, and an order asking for it is refused until then."
        size="sm"
        footer={<Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>}
      >
        <div className="grid grid-cols-2 gap-2">
          {OFF_FOR.map((o) => (
            <Button key={o.key} variant="secondary" size="lg" onClick={() => onPick(o.key)}>
              {o.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
