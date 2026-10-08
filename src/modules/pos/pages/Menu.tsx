import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { UtensilsCrossed, Plus, Upload, TicketPercent, ListPlus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, Skeleton, EmptyState, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Checkbox, Segmented,
} from "@/components/ui";
import { NumberedAddonsTab } from "@/modules/pos/components/NumberedAddonsTab";
import { getModules } from "@/data/repositories";
import { getMenu, addCategory, addItem, toggleItem, takeItemOff, putItemBack, takeAddonOff, putAddonBack, importMenu, importAddons, setItemPrepMinutes, setCategoryPrepMinutes, setItemCourse, setCategoryCourse, setCategoryTaxKind, type SectionHeading, listPromotions, addPromotion, amendPromotion, saveVariations, listAddonGroups, addAddonGroup, editAddonGroup, setGroupDishes, addAddonOption, editAddonOption, removeAddonOption, type OffFor, type Promotion, type MenuCategory, type MenuItem, type VariationKind, type Addon, type AddonGroupSetup } from "@/modules/pos/data/till";
import { ReadFailed, ReadStale } from "@/components/ui";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { MENU_SPEC } from "@/lib/importSpec";
import { ADDON_SPEC } from "@/modules/pos/lib/addonSpec";
import { chooseRule } from "@/modules/pos/flows/DishDialog";
import { typesOf } from "@/modules/pos/lib/pricing";

/* ══════════════════════════════════════════════════════════════════
   THE MENU

   Prices are the hotel's. Nothing in this system ships a dish or a
   number — a migration that seeded "Paneer Tikka ₹320" would put an
   invented rupee figure on a screen that looks like the real thing,
   and somebody would eventually believe it.

   The demo property has a sample card loaded by the demo loader,
   alongside the invented guest names, where it belongs.

   TAX SITS ON THE ITEM, NOT THE OUTLET. Restaurant food is 5% and
   packaged water is 18%, and one bill routinely carries both. An
   outlet-level rate would be wrong on every mixed bill, and the folio
   posting it produced would be wrong with it.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

export default function MenuPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();

  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<"menu" | "addons" | null>(null);
  /* Two tabs (the owner's D27-289): the dishes as they were, and the
     numbered Add-ons any dish can take. */
  const [view, setView] = useState<"dishes" | "addons">("dishes");

  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
  });
  /* The sidebar's own read: whether this property serves alcohol, which
     opens the Alcohol heading (D21-90). The server refuses it either way. */
  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
  });
  const servesAlcohol = modules.data?.["alcohol"] === true;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["till-menu"] });
    void qc.invalidateQueries({ queryKey: ["till-addon-groups"] });
  };

  const createCategory = async () => {
    const name = category.trim();
    if (!name) return;
    setBusy(true);
    const res = await addCategory(hotelId, name);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason ?? "Refused.");
    setCategory("");
    refresh();
  };

  const cats = menu.data ?? [];
  const items = cats.flatMap((c) => c.items);

  /* A group of sides is shared: "Sides" can hang off three dishes, and
     switching its onions off switches them off on all three. Counted
     once here so each add-on's dialog can say which. */
  const dishesByGroup = new Map<string, string[]>();
  for (const item of items) {
    for (const group of item.addonGroups) {
      dishesByGroup.set(group.id,
        [...(dishesByGroup.get(group.id) ?? []), item.name]);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Menu"
        description="What the outlets sell, and what each item is taxed at."
        badge={
          menu.data ? (
            <StatusPill tone="neutral">
              {items.length} item{items.length === 1 ? "" : "s"}
            </StatusPill>
          ) : undefined
        }
        actions={view === "addons" ? undefined : (
          /* A real card is two hundred dishes across a dozen sections.
             Typing that into a dialog one at a time is not something
             anybody will do, so the file route sits beside the manual
             one rather than hidden behind it. */
          /* Two files, the owner's D21-43: the add-ons first, because the
             menu file names their groups. Left to right in that order. */
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => setImporting("addons")}>
              <Upload className="size-4" /> Import sides
            </Button>
            <Button variant="secondary" className="h-11"
                    onClick={() => setImporting("menu")}>
              <Upload className="size-4" /> Import the menu
            </Button>
          </>
        )}
      />

      <Segmented
        className="mb-5"
        value={view}
        onChange={setView}
        options={[{ value: "dishes", label: "Dishes" }, { value: "addons", label: "Add-ons" }]}
      />

      {view === "addons" ? <NumberedAddonsTab hotelId={hotelId} /> : (<>

      <div className="flex items-start gap-3 rounded-lg border border-grey-200 bg-grey-50 px-4 py-3.5 mb-5">
        <UtensilsCrossed className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            These prices are yours
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Nothing here was shipped with the system. A price changed today
            applies to the next order - bills already printed keep the price
            they were sold at.
          </p>
        </div>
      </div>

      <Card className="mb-5">
        <CardBody>
          <p className="text-md font-semibold text-ink-900 mb-1">
            Add a part of the menu
          </p>
          <p className="text-sm text-grey-600 mb-3">
            Starters, Main course, Beverages - whatever the card is organised by.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Starters"
              className="flex-1 min-w-40 h-11 px-3 rounded-md border border-grey-300 text-base"
            />
            <Button onClick={createCategory} loading={busy} size="lg">
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* POS-4: "The menu is empty" is a statement about the hotel's
          card. It used to be drawn while the menu loaded and when it
          failed to — telling a kitchen manager their dishes were gone. */}
      {menu.error && menu.data !== undefined && (
        <ReadStale
          className="mb-5"
          error={menu.error}
          loadedAt={menu.dataUpdatedAt}
          onRetry={() => void menu.refetch()}
        />
      )}

      {menu.data === undefined ? (
        menu.error ? (
          <Card>
            <ReadFailed
              compact
              error={menu.error}
              what="the menu"
              onRetry={() => void menu.refetch()}
            />
          </Card>
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : cats.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<UtensilsCrossed />}
            title="The menu is empty"
            description="Add a part of the menu above, then put items in it. Until then the till has nothing to sell."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {cats.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              hotelId={hotelId}
              servesAlcohol={servesAlcohol}
              dishesByGroup={dishesByGroup}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      {menu.data !== undefined && (
        <AddonGroups hotelId={hotelId} categories={cats} onChanged={refresh} />
      )}

      {/* ── Promotions ────────────────────────────────────────────
          Beside the dishes and the taxes, because it is the same
          question: what does this restaurant sell and on what terms.
          Last on the page — a card is edited every week and a
          concession is decided about once a season. */}
      <Promotions hotelId={hotelId} />

      {importing && (
        <ImportDialog
          key={importing}
          spec={importing === "menu" ? MENU_SPEC : ADDON_SPEC}
          load={(rows, dry) => importing === "menu"
            ? importMenu(hotelId, rows, dry)
            : importAddons(hotelId, rows, dry)}
          open
          onOpenChange={(o) => { if (!o) setImporting(null); }}
          onImported={refresh}
        />
      )}
      </>)}
    </Page>
  );
}

/* ══════════════════════════════════════════════════════════════════
   PROMOTIONS — the named discounts, and the line a biller may not cross

   ⚠ WHAT THIS REPLACED. The plan was an approval queue: a discount over
   some threshold would wait for the GM to decide. Asked what the
   threshold should be, the owner answered with a better design — a free
   hand up to 10%, and anything larger applied by code from a list
   decided in advance.

   A queue asks somebody to answer the same question again every night.
   "House guests eat at 50%" is not a decision, it is a policy, and a
   policy typed in fresh by a biller at 11pm is a policy that drifts.

   It also answers a question the queue could not: what did each
   concession COST last month. A promotion is a column on the bill; a
   free-hand discount with the words typed into the reason box is a
   search through text nobody spelled the same way twice.

   NOTHING IS SEEDED. Every rate here is a decision about money that
   somebody at the hotel has to make, and a shipped "STAFF — 50%" would
   be defect 63 wearing an apron.
   ══════════════════════════════════════════════════════════════════ */
function Promotions({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);

  const q = useQuery({
    queryKey: ["promotions", hotelId],
    queryFn: () => listPromotions(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["promotions"] });
  };

  const cap = q.data?.freehandCapPercent ?? null;
  const list = q.data?.promotions ?? [];

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-md font-semibold text-ink-900">Promotions</h2>
        <Button variant="secondary" className="h-11"
                onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add a promotion
        </Button>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <TicketPercent className="size-4 text-grey-400 shrink-0 mt-0.5" />
            <p className="text-sm text-grey-600 leading-relaxed">
              {/* The cap is the server's number and is shown, not
                  restated. A copy of "10" in this file would be a
                  second thing to be wrong. */}
              A biller may take {cap === null ? "a limited amount" : `up to ${cap}%`}
              {" "}off a bill by hand. Anything larger is one of these, applied
              by code - so it is the same concession every time, and the
              month-end report can count what it cost.
            </p>
          </div>

          {q.error && q.data !== undefined && (
            <ReadStale
              error={q.error}
              loadedAt={q.dataUpdatedAt}
              onRetry={() => void q.refetch()}
            />
          )}

          {/* POS-4: "None set up" only when the list arrived and is empty. */}
          {q.data === undefined ? (
            q.error ? (
              <ReadFailed
                compact
                error={q.error}
                what="the promotions"
                onRetry={() => void q.refetch()}
              />
            ) : (
              <p className="text-sm text-grey-500">Loading the promotions…</p>
            )
          ) : list.length === 0 ? (
            <p className="text-sm text-grey-500">
              None set up. Until there is one, a discount above the cap is
              refused at the till.
            </p>
          ) : (
            <ul className="divide-y divide-grey-100">
              {list.map((p) => (
                <li key={p.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold",
                    "tabular tracking-wide",
                    p.isActive
                      ? "bg-brand-orange-50 text-brand-orange-700"
                      : "bg-grey-100 text-grey-600")}>
                    {p.code}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-base",
                                      p.isActive
                                        ? "text-ink-900" : "text-grey-500")}>
                    {p.name}
                    {!p.isActive && (
                      <span className="ml-2 text-sm text-grey-500">
                        not running
                      </span>
                    )}
                  </span>
                  <span className="tabular text-base font-medium text-ink-900">
                    {p.kind === "percent" ? `${p.value}%` : money(p.value)}
                  </span>
                  <span className={cn("tabular text-sm w-20 text-right",
                                      p.used === 0
                                        ? "text-grey-500" : "text-grey-600")}>
                    {p.used} bill{p.used === 1 ? "" : "s"}
                  </span>
                  <Button variant="ghost" className="h-11"
                          onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {adding && (
        <PromotionDialog hotelId={hotelId} onClose={() => setAdding(false)}
                         onSaved={refresh} />
      )}
      {editing && (
        <PromotionDialog hotelId={hotelId} promotion={editing}
                         onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </section>
  );
}

function PromotionDialog({
  hotelId, promotion, onClose, onSaved,
}: {
  hotelId: string; promotion?: Promotion;
  onClose: () => void; onSaved: () => void;
}) {
  const [code, setCode] = useState(promotion?.code ?? "");
  const [name, setName] = useState(promotion?.name ?? "");
  const [kind, setKind] =
    useState<"percent" | "fixed">(promotion?.kind ?? "percent");
  const [value, setValue] =
    useState(promotion ? String(promotion.value) : "");
  const [active, setActive] = useState(promotion?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const amount = Number(value);
  const bad = !Number.isFinite(amount) || amount <= 0
    || (kind === "percent" && amount > 100);
  const ready = name.trim().length > 0 && (promotion || code.trim().length > 0)
    && !bad;

  const submit = async () => {
    setBusy(true);
    const res = promotion
      ? await amendPromotion(hotelId, promotion.id,
          { name: name.trim(), value: amount, isActive: active })
      : await addPromotion(hotelId,
          { code: code.trim().toUpperCase(), name: name.trim(),
            kind, value: amount });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(promotion ? `${name.trim()} saved` : `${name.trim()} added`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={promotion ? `Edit ${promotion.name}` : "Add a promotion"}
        description={
          promotion
            ? "The code cannot change - bills already printed name it."
            : "A named discount a biller applies by typing its code."
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!promotion && (
            <Field label="Code" required
                   hint="What the biller types. Short - a terminal has a queue behind it.">
              {(f) => (
                <Input {...fieldProps(f)} value={code} placeholder="HOUSE"
                       autoFocus
                       onChange={(e) => setCode(e.target.value.toUpperCase())} />
              )}
            </Field>
          )}

          <Field label="Name" required
                 hint="Prints on the bill and groups the report. The guest reads this.">
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="House guests"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>

          {!promotion && (
            <div className="flex gap-2">
              {(["percent", "fixed"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setKind(t)}
                  className={cn(
                    "press flex-1 h-11 rounded-full border text-base font-medium cursor-pointer",
                    kind === t
                      ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
                      : "border-grey-300 bg-white text-grey-600 hover:border-grey-400 hover:bg-grey-50")}>
                  {t === "percent" ? "Percentage" : "Fixed amount"}
                </button>
              ))}
            </div>
          )}

          <Field
            label={kind === "percent" ? "Percent off" : "Amount off"}
            required
            error={value.trim() !== "" && bad
              ? (kind === "percent"
                  ? "Between 0 and 100."
                  : "More than nothing.")
              : undefined}
          >
            {(f) => (
              <Input {...fieldProps(f)} value={value} type="number"
                     inputMode="decimal"
                     placeholder={kind === "percent" ? "50" : "200.00"}
                     onChange={(e) => setValue(e.target.value)} />
            )}
          </Field>

          {promotion && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={active} className="mt-1 size-4"
                     onChange={(e) => setActive(e.target.checked)} />
              <span>
                <span className="text-base text-ink-900">
                  Offer this at the till
                </span>
                <span className="block text-sm text-grey-600">
                  Switching it off hides it from the discount dialog. Bills
                  that already used it keep it - a promotion is never
                  deleted.
                </span>
              </span>
            </label>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   OUT OF PANEER, UNTIL EIGHT

   The most-used menu action in a live kitchen, and it has to take
   three seconds — a waiter is already at a table asking for it.

   A DURATION, never a switch. "Off" with no end is a dish that stays
   off for a week because whoever took it off went home, and nobody can
   say since when. A time answers both questions, and answers the
   second one to the guest at the table.
   ══════════════════════════════════════════════════════════════════ */
const OFF_FOR: { key: OffFor; label: string }[] = [
  { key: "2h", label: "2 hours" },
  { key: "4h", label: "4 hours" },
  { key: "8h", label: "8 hours" },
  { key: "24h", label: "24 hours" },
  { key: "next_business_day", label: "Tomorrow" },
];

/* ONE CONTROL FOR A DISH AND FOR AN ADD-ON (POS-2, the owner's D17-19:
   "on/off switches for add-ons on the Menu screen, like dishes have").
   The same words, the same durations and the same "put back", so a
   kitchen manager who has switched off paneer already knows how to
   switch off onions. Two differences, both the database's: an add-on
   keeps no reason, and an add-on can be on more than one dish. */
function OffControl({
  name, offUntil, askWhy, alsoOn, takeOff, putBack, onDone,
}: {
  name: string;
  offUntil: string | null;
  /** A dish keeps a reason and shows it to the waiter. An add-on has
      nowhere to keep one, so it is not asked for. */
  askWhy: boolean;
  /** Every dish this add-on is offered with. Named in the dialog when
      there is more than one, because it goes off on all of them. */
  alsoOn?: string[];
  takeOff: (until: OffFor, reason: string) =>
    Promise<{ ok: boolean; reason?: string }>;
  putBack: () => Promise<{ ok: boolean; reason?: string }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const off = offUntil !== null && Date.parse(offUntil) > Date.now();

  const back = off
    ? new Date(offUntil!).toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit" })
    : null;

  const choose = async (until: OffFor) => {
    setBusy(true);
    const res = await takeOff(until, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    setOpen(false);
    setReason("");
    toast.success(`${name} is off`, `Back in ${
      OFF_FOR.find((o) => o.key === until)?.label.toLowerCase()}.`);
    onDone();
  };

  const restore = async () => {
    setBusy(true);
    const res = await putBack();
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(`${name} is back on`);
    onDone();
  };

  if (off) {
    return (
      <Button variant="secondary" size="sm" loading={busy}
        aria-label={`Off till ${back} - put back ${name}`}
        onClick={() => void restore()}>
        {/* When, not just whether. A waiter asked "is it back?" needs a
            time, and the row is where they look. */}
        Off till {back} - put back
      </Button>
    );
  }

  const shared = (alsoOn?.length ?? 0) > 1;

  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Out of stock: ${name}`}
        onClick={() => setOpen(true)}>
        Out of stock
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`${name} is off`}
          description={shared
            ? `For how long? It comes back on by itself. It goes off on `
              + `every dish that offers it: ${alsoOn!.join(", ")}.`
            : "For how long? It comes back on by itself."}
          size="sm"
          footer={
            <Button variant="secondary" size="lg"
              onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        >
          <div className="space-y-4">
            {askWhy && (
              <Field label="Why" hint="Shown to the waiter who tries to ring it">
                {(f) => (
                  <Input
                    {...fieldProps(f)}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Out of paneer"
                    autoFocus
                  />
                )}
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              {OFF_FOR.map((o) => (
                <Button
                  key={o.key}
                  variant="secondary"
                  size="lg"
                  loading={busy}
                  onClick={() => void choose(o.key)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CategoryCard({ category, hotelId, servesAlcohol, dishesByGroup, onChanged }: {
  category: MenuCategory; hotelId: string;
  /** Whether the Alcohol heading may be chosen (D21-90). */
  servesAlcohol: boolean;
  /** Add-on group → every dish on the menu that offers it. */
  dishesByGroup: Map<string, string[]>;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [free, setFree] = useState(false);
  const [tax, setTax] = useState("5");
  const [busy, setBusy] = useState(false);
  /* The dish whose variations are open in the form (D27-192). */
  const [varying, setVarying] = useState<MenuItem | null>(null);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    /* POS-14: `Number("")` is 0, so an empty price box added the dish at
       ₹0.00. A blank is not zero; and since D27-120 (POS-5) 0 is only a
       dish ticked Free. */
    if (price.trim() === "" && !free) {
      return toast.error("Not added",
        "Type a price. A blank is not zero - tick Free for a dish that costs nothing.");
    }
    const rupees = free ? 0 : Number(price);
    if (!Number.isFinite(rupees) || rupees < 0) {
      return toast.error("Not added", "A price must be zero or more.");
    }
    const rate = Number(tax);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return toast.error("Not added", "A tax rate must be between 0 and 100.");
    }

    setBusy(true);
    const res = await addItem(hotelId, category.id, trimmed, rupees, rate, free);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason ?? "Refused.");
    setName("");
    setPrice("");
    setFree(false);
    onChanged();
  };

  const toggle = async (itemId: string) => {
    const res = await toggleItem(hotelId, itemId);
    if (!res.ok) return toast.error("Not changed", res.reason ?? "Refused.");
    onChanged();
  };

  const setHeading = async (kind: SectionHeading) => {
    const res = await setCategoryTaxKind(hotelId, category.id, kind);
    if (!res.ok) return toast.error("Not changed", res.reason ?? "Refused.");
    /* Said (QA RT-9: it saved with no word). */
    toast.success("Saved", `${category.name}: the tax heading is changed.`);
    onChanged();
  };

  return (
    <Card>
      {/* Wraps on a phone: the heading picker goes under the name rather
          than squeezing it (D22-49). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 border-b border-grey-200">
        {/* The section's name is the card's heading (16px, the ladder). */}
        <h2 className="text-md font-semibold text-ink-900 flex-1 min-w-32">
          {category.name}
        </h2>
        {/* The default every dish in here inherits. Set once for two
            hundred dishes rather than timed one at a time — which is
            the whole reason the fallback exists. */}
        <CourseControl
          course={category.course}
          own={category.course}
          label={`Course for everything in ${category.name}`}
          onSet={async (v) => {
            const res = await setCategoryCourse(hotelId, category.id, v);
            if (!res.ok) {
              toast.error("Not changed", res.reason ?? "Refused.");
              return;
            }
            onChanged();
          }}
        />
        <PrepControl
          minutes={category.prepMinutes}
          own={category.prepMinutes}
          label={`Default preparation time for ${category.name}`}
          onSet={async (m) => {
            const res = await setCategoryPrepMinutes(hotelId, category.id, m);
            if (!res.ok) {
              toast.error("Not changed", res.reason ?? "Refused.");
              return;
            }
            onChanged();
          }}
        />
        {/* THE SECTION'S TAX HEADING (D22-4): every dish in here without a
            rate of its own is rung at this heading's rate. The tax card's
            words. "Not set" and an Alcohol section at a property that no
            longer serves it are shown as they are, and cannot be chosen. */}
        <NativeSelect
          aria-label={`Tax heading for ${category.name}`}
          value={category.taxKind ?? ""}
          onChange={(e) => void setHeading(e.target.value as SectionHeading)}
          className="w-auto h-11"
        >
          {!category.taxKind && <option value="" disabled>Not set</option>}
          <option value="restaurant">Restaurant</option>
          <option value="bar">Bar</option>
          <option value="banquet">Banquet</option>
          {(servesAlcohol || category.taxKind === "alcohol") && (
            <option value="alcohol" disabled={!servesAlcohol}>Alcohol (VAT)</option>
          )}
          <option value="other">Everything else</option>
        </NativeSelect>
      </div>

      <ul className="divide-y divide-grey-100">
        {category.items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-9">
              <span
                className={cn(
                  "flex-1 min-w-32 text-base truncate",
                  item.isActive ? "text-ink-900" : "text-grey-500 line-through",
                )}
              >
                {item.name}
              </span>
              <span className="text-2xs text-grey-500 tabular shrink-0">
                {/* The rate the till rings it at; a dash when its section
                    has none set - never "0%" (POS-15, D21-94). */}
                {item.taxRate === null ? "-" : `${item.taxRate}%`}
              </span>
              <span className="tabular text-base text-ink-900 shrink-0 w-20 text-right"
                    title={item.variations.length > 0
                      ? "Sold by variation - each has its own price" : undefined}>
                {/* A dish with variations has no price of its own (045): a
                    dash, never the column nobody has looked at since. */}
                {item.variations.length > 0 ? "-" : moneyPrecise(item.price)}
              </span>
              {/* POS-9: THE CONTROLS GO UNDER THE NAME ON A PHONE. On one line
                  at 375px the row needed 465px of 302 and the dish name was
                  squeezed to nothing (17 September). A desk has the room, and
                  there nothing moves. */}
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 ml-auto">
                <CourseControl
                  course={item.course}
                  own={item.ownCourse}
                  label={`Course for ${item.name}`}
                  onSet={async (v) => {
                    const res = await setItemCourse(hotelId, item.id, v);
                    if (!res.ok) {
                      toast.error("Not changed", res.reason ?? "Refused.");
                      return;
                    }
                    onChanged();
                  }}
                />
                <PrepControl
                  minutes={item.prepMinutes}
                  own={item.ownPrepMinutes}
                  label={`Preparation time for ${item.name}`}
                  onSet={async (m) => {
                    const res = await setItemPrepMinutes(hotelId, item.id, m);
                    if (!res.ok) {
                      toast.error("Not changed", res.reason ?? "Refused.");
                      return;
                    }
                    onChanged();
                  }}
                />
                {/* TWO DIFFERENT ACTS, and the words are different because
                    the decisions are.

                    "Out of paneer" is a shift decision with an end on it.
                    "Take off the card" is a menu decision with none — and
                    a dish taken off the card is still off tomorrow, which
                    is exactly what nobody wants from the first one. */}
                <Button variant="ghost" size="sm"
                        aria-label={item.variations.length > 0
                          ? `Change variations of ${item.name}` : `Add variation to ${item.name}`}
                        onClick={() => setVarying(item)}>
                  <ListPlus className="size-4" />
                  {item.variations.length > 0 ? "Change variations" : "Add variation"}
                </Button>
                <OffControl
                  name={item.name}
                  offUntil={item.offUntil}
                  askWhy
                  takeOff={(until, reason) =>
                    takeItemOff(hotelId, item.id, until, reason)}
                  putBack={() => putItemBack(hotelId, item.id)}
                  onDone={onChanged}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void toggle(item.id)}
                >
                  {/* Off, not gone. The lines that sold it point at this row,
                      and a dish that is unavailable today was on the card
                      yesterday. */}
                  {item.isActive ? "Take off" : "Put back"}
                </Button>
              </div>
            </div>

            {/* ── Its variations, type by type (D27-192) ─────────────────
                The first type is the dish's price; a later one adds to it.
                Changed on the form, all at once. */}
            {item.variations.length > 0 && (
              <div className="mt-2 ml-4 pl-3 border-l border-grey-200">
                {typesOf(item).map((t, i) => (
                  <p key={t.typeNo} className="text-base text-ink-900 py-0.5">
                    <span className="text-2xs uppercase tracking-wide text-grey-500 mr-2">
                      {t.heading}
                    </span>
                    <span className="tabular">
                      {t.choices.map((v) => `${v.label} ${v.price === 0 ? "Free"
                        : `${i > 0 ? "+" : ""}${moneyPrecise(v.price)}`}`).join(" · ")}
                    </span>
                  </p>
                ))}
              </div>
            )}

            {/* ── Its add-ons ──────────────────────────────────────────
                Under the dish, because that is where a kitchen manager
                looks for "the onions with the Bhaaji Pau". Each switches
                off the way the dish does (D17-19). */}
            {item.addonGroups.map((group) => (
              <div key={group.id} className="mt-2 ml-4 pl-3 border-l border-grey-200">
                <p className="text-2xs uppercase tracking-wide text-grey-500 pt-1">
                  {group.label}
                </p>
                <ul>
                  {group.addons.map((addon) => (
                    <li key={addon.id}
                        className="flex flex-wrap items-center gap-x-3 min-h-9 py-0.5">
                      {/* WRAPS rather than squeezes. On a phone "Off till
                          04:46 pm — put back" took the whole row and the
                          add-on's own name shrank to nothing (measured at
                          375px, 17 September); the button goes under it. */}
                      <span className="flex-1 min-w-28 text-base text-ink-900 truncate">
                        {addon.label}
                      </span>
                      <span className="tabular text-base text-ink-900 shrink-0 w-20 text-right">
                        {addon.price === 0 ? "Free" : moneyPrecise(addon.price)}
                      </span>
                      <div className="ml-auto">
                        <OffControl
                          name={addon.label}
                          offUntil={addon.offUntil}
                          askWhy={false}
                          alsoOn={dishesByGroup.get(group.id)}
                          takeOff={(until) => takeAddonOff(hotelId, addon.id, until)}
                          putBack={() => putAddonBack(hotelId, addon.id)}
                          onDone={onChanged}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
        {category.items.length === 0 && (
          <li className="px-4 py-3.5 text-sm text-grey-500">
            Nothing in here yet.
          </li>
        )}
      </ul>

      <CardBody className="border-t border-grey-100">
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dish"
            className="flex-1 min-w-36 h-11 px-3 rounded-md border border-grey-300 text-base"
          />
          <input
            value={free ? "0" : price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Price"
            aria-label={`Price of a new dish in ${category.name}`}
            disabled={free}
            className="w-24 h-11 px-3 rounded-md border border-grey-300 text-base tabular"
          />
          <Checkbox label="Free" checked={free} onCheckedChange={setFree} />
          <select
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            className="w-24 h-11 px-2 rounded-md border border-grey-300 text-base"
          >
            {/* The rates a hotel restaurant actually meets. Not a free
                number, because a typo here mis-taxes every bill the item
                appears on. */}
            <option value="0">0%</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18">18%</option>
          </select>
          <Button onClick={add} loading={busy} size="lg">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardBody>

      {varying && (
        <VariationsDialog hotelId={hotelId} item={varying}
                          onClose={() => setVarying(null)} onSaved={onChanged} />
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AN ADD-ON OPTION: A NAME AND A PRICE, OR FREE

   THE PRICE IS TYPED OR TICKED FREE, OR NOTHING IS SAVED. A blank is not
   zero (HANDOVER § 5), and since D27-192 a 0 is a Preference such as No
   onion only when it is ticked Free (D27-120 replaced D21-42's "type 0").
   ══════════════════════════════════════════════════════════════════ */
function EntryDialog({
  title, description, name, initialPrice = "", initialFree = false, onSave, onClose,
}: {
  title: string;
  description: string;
  name: { label: string; initial: string; placeholder: string };
  initialPrice?: string;
  initialFree?: boolean;
  onSave: (label: string, price: string, free: boolean) => Promise<{ ok: boolean; reason?: string }>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(name.initial);
  const [price, setPrice] = useState(initialPrice);
  const [free, setFree] = useState(initialFree);
  const [busy, setBusy] = useState(false);

  const typed = price.trim();
  const rupees = Number(typed.replace(/[,₹\s]/g, ""));
  const bad = !free && typed !== "" && (!Number.isFinite(rupees) || rupees < 0);
  const ready = label.trim() !== "" && (free || typed !== "") && !bad;

  const submit = async () => {
    setBusy(true);
    const res = await onSave(label.trim(), free ? "" : typed, free);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={name.label} required>
            {(f) => (
              <Input {...fieldProps(f)} value={label} autoFocus
                     placeholder={name.placeholder}
                     onChange={(e) => setLabel(e.target.value)} />
            )}
          </Field>
          <Field label="Price" required
                 hint="Rupees. A blank is not zero - tick Free for something that costs nothing."
                 error={bad ? "A price is a number, more than 0." : undefined}>
            {(f) => (
              <Input {...fieldProps(f)} value={free ? "" : price} inputMode="decimal"
                     disabled={free} className="tabular"
                     onChange={(e) => setPrice(e.target.value)} />
            )}
          </Field>
          <Checkbox label="Free" checked={free} onCheckedChange={setFree} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   A DISH'S VARIATIONS, EVERY TYPE AT ONCE (D27-189, D27-192, D27-195)

   Size, Quantity, or an Option the manager heads ("Crust", "Spice
   level"). The first type's choices are the dish's price; a further
   type's choices add to it. Picking a type fills in the NAMES when its
   list is empty - never a price (no default prices, HANDOVER § 5). A name may
   be in two types ("Regular" size and "Regular" crust). Saved in one go:
   the server keeps all of it or none.
   ══════════════════════════════════════════════════════════════════ */
const KINDS: { kind: VariationKind; label: string; names: string[] }[] = [
  { kind: "size", label: "Size", names: ["Small", "Medium", "Large"] },
  { kind: "quantity", label: "Quantity", names: ["Half", "Full"] },
  { kind: "option", label: "Option", names: [] },
];
type ChoiceRow = { id?: string; label: string; price: string; free: boolean };
type TypeRow = { kind: VariationKind | null; heading: string; choices: ChoiceRow[] };
const blankChoice = (): ChoiceRow => ({ label: "", price: "", free: false });
const priced = (c: { price: string; free: boolean }) => c.free || c.price.trim() !== "";

function VariationsDialog({ hotelId, item, onClose, onSaved }: {
  hotelId: string; item: MenuItem; onClose: () => void; onSaved: () => void;
}) {
  /* A carried-over dish's type is not picked yet: kind null, and Save
     waits until it is (D27-195, C). A ₹0 choice was ticked Free. */
  const [types, setTypes] = useState<TypeRow[]>(() => typesOf(item).map((t) => ({
    kind: t.choices[0]!.kind ?? null,
    heading: t.choices[0]!.heading ?? "",
    choices: t.choices.map((v) => ({ id: v.id, label: v.label,
      price: v.price === 0 ? "" : String(v.price), free: v.price === 0 })),
  })));
  /* The first type went, so the next one's figures are no longer
     additions: cleared, to be typed again as the dish's price. */
  const [moved, setMoved] = useState(false);
  const [dishPrice, setDishPrice] = useState("");
  const [dishFree, setDishFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const hadAny = item.variations.length > 0;

  const change = (i: number, next: Partial<TypeRow>) =>
    setTypes((ts) => ts.map((t, j) => (j === i ? { ...t, ...next } : t)));
  const changeChoice = (i: number, k: number, next: Partial<ChoiceRow>) =>
    setTypes((ts) => ts.map((t, j) => (j !== i ? t : {
      ...t, choices: t.choices.map((c, m) => (m === k ? { ...c, ...next } : c)) })));

  const pick = (i: number, kind: VariationKind) => {
    const t = types[i]!;
    const untouched = t.choices.every((c) => !c.label.trim() && !priced(c));
    const names = KINDS.find((k) => k.kind === kind)!.names;
    change(i, {
      kind,
      ...(kind === "option" ? {} : { heading: "" }),
      ...(untouched && names.length > 0
        ? { choices: names.map((label) => ({ ...blankChoice(), label })) } : {}),
    });
  };

  const removeType = (i: number) => {
    if (i === 0 && types.length > 1) setMoved(true);
    setTypes((ts) => ts.filter((_, j) => j !== i).map((t, j) => (i === 0 && j === 0
      ? { ...t, choices: t.choices.map((c) => ({ ...c, price: "", free: false })) } : t)));
  };

  const ready = types.length > 0
    ? types.every((t) => t.kind && (t.kind !== "option" || t.heading.trim())
        && t.choices.length > 0 && t.choices.every((c) => c.label.trim() && priced(c)))
    : hadAny && priced({ price: dishPrice, free: dishFree });

  const save = async () => {
    setBusy(true);
    const res = await saveVariations(hotelId, item.id, {
      types: types.map((t) => ({
        kind: t.kind!,
        ...(t.kind === "option" ? { heading: t.heading.trim() } : {}),
        choices: t.choices.map((c) => ({
          ...(c.id ? { id: c.id } : {}), label: c.label.trim(), price: c.price, free: c.free })),
      })),
      ...(types.length === 0 ? { dishPrice, dishFree } : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`${item.name}: variations saved`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="lg"
        title={`Variations - ${item.name}`}
        description={"The waiter picks one of each. The first type's prices are the dish's "
          + "price; each further type adds to it. A blank price is not zero - tick Free."}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {types.map((t, i) => (
            <section key={i} aria-label={`Type ${i + 1}`}
                     className="space-y-3 pb-4 border-b border-grey-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-md font-semibold text-ink-900 w-6">{i + 1}</span>
                {KINDS.map((k) => (
                  <button key={k.kind} type="button" aria-pressed={t.kind === k.kind}
                          onClick={() => pick(i, k.kind)}
                          className={cn(
                            "press h-11 px-4 rounded-full border text-base font-medium cursor-pointer",
                            t.kind === k.kind
                              ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
                              : "border-grey-300 bg-white text-grey-700 hover:border-grey-400 hover:bg-grey-50",
                          )}>
                    {k.label}
                  </button>
                ))}
                <Button variant="ghost" size="sm" className="ml-auto"
                        onClick={() => removeType(i)}>
                  Remove type
                </Button>
              </div>
              {!t.kind && (
                <p className="text-sm text-brand-red-700">
                  Pick Size, Quantity or Option. It sells as "Variation" until you do.
                </p>
              )}
              {t.kind === "option" && (
                <Field label="Heading" required hint="What the waiter reads - Spice level, Crust.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={t.heading}
                           onChange={(e) => change(i, { heading: e.target.value })} />
                  )}
                </Field>
              )}
              <div className="space-y-2">
                <div className="flex gap-2 text-2xs uppercase tracking-wide text-grey-500">
                  <span className="flex-1 min-w-32">Choice</span>
                  <span className="w-24">{i === 0 ? "Price" : "Adds"}</span>
                  <span className="w-28" />
                </div>
                {t.choices.map((c, k) => (
                  <div key={k} className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Type ${i + 1}, choice ${k + 1}`} value={c.label}
                           className="flex-1 min-w-32"
                           onChange={(e) => changeChoice(i, k, { label: e.target.value })} />
                    <Input aria-label={`Price of type ${i + 1}, choice ${k + 1}`}
                           value={c.free ? "" : c.price} disabled={c.free}
                           inputMode="decimal" className="w-24 tabular"
                           onChange={(e) => changeChoice(i, k, { price: e.target.value })} />
                    <Checkbox label="Free" checked={c.free}
                              onCheckedChange={(free) => changeChoice(i, k, { free })} />
                    <button type="button"
                            aria-label={`Remove type ${i + 1}, choice ${k + 1}`}
                            onClick={() => change(i, { choices: t.choices.filter((_, m) => m !== k) })}
                            className="press size-11 grid place-items-center rounded-full text-grey-500 hover:text-brand-red-700 hover:bg-brand-red-50 cursor-pointer">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <Button variant="secondary" size="sm"
                        onClick={() => change(i, { choices: [...t.choices, blankChoice()] })}>
                  <Plus className="size-4" /> Add a choice
                </Button>
              </div>
            </section>
          ))}

          {moved && (
            <p className="text-sm text-brand-orange-700">
              The next type is now the first, so its prices are the dish's price.
              Type them again.
            </p>
          )}

          {types.length === 0 && hadAny && (
            <div className="space-y-2">
              <Field label={`Price of ${item.name}`} required
                     hint="With no variations it is sold at one price again.">
                {(f) => (
                  <Input {...fieldProps(f)} value={dishFree ? "" : dishPrice}
                         disabled={dishFree} inputMode="decimal" className="tabular w-32"
                         onChange={(e) => setDishPrice(e.target.value)} />
                )}
              </Field>
              <Checkbox label="Free" checked={dishFree} onCheckedChange={setDishFree} />
            </div>
          )}

          <Button variant="secondary"
                  onClick={() => setTypes((ts) => [...ts,
                    { kind: null, heading: "", choices: [blankChoice()] }])}>
            <Plus className="size-4" /> {types.length > 0 ? "Add another type" : "Add a type"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ADD-ON GROUPS — made once, offered on many dishes (D21-41)

   "Choice of bread" is one group on every curry, so a price changed here
   changes on all of them: it is one row. A group says how many a guest
   may choose, and the order pad and the server both hold the waiter to
   it. "Preferences" - No onion, Less spicy, Jain - is a group like any
   other whose options somebody priced at 0 (D21-42); it prints on the
   kitchen slip under the dish.

   Listed from its own read, because the menu shows a group only under
   a dish that offers it, and a group just made is on none yet.
   ══════════════════════════════════════════════════════════════════ */
function AddonGroups({ hotelId, categories, onChanged }: {
  hotelId: string;
  categories: MenuCategory[];
  onChanged: () => void;
}) {
  const q = useQuery({
    queryKey: ["till-addon-groups", hotelId],
    queryFn: () => listAddonGroups(hotelId),
  });
  const [editing, setEditing] = useState<AddonGroupSetup | "new" | null>(null);
  const [dishesFor, setDishesFor] = useState<AddonGroupSetup | null>(null);
  const [option, setOption] =
    useState<{ group: AddonGroupSetup; addon?: Addon } | null>(null);

  const dishName = new Map(
    categories.flatMap((c) => c.items).map((i) => [i.id, i.name]));
  const groups = q.data ?? [];

  const remove = async (group: AddonGroupSetup, addon: Addon) => {
    const res = await removeAddonOption(hotelId, addon.id);
    if (!res.ok) return toast.error("Not removed", res.reason);
    toast.success(`${addon.label} is off ${group.label}`);
    onChanged();
  };

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        {/* "Sides" since D27-289 - the label only: the numbered Add-ons are
            their own tab now, and two things called add-ons on one screen
            is one too many. */}
        <h2 className="text-md font-semibold text-ink-900">Sides</h2>
        <Button variant="secondary" className="h-11"
                onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add a group of sides
        </Button>
      </div>

      {q.error && q.data !== undefined && (
        <ReadStale className="mb-3" error={q.error} loadedAt={q.dataUpdatedAt}
                   onRetry={() => void q.refetch()} />
      )}

      {q.data === undefined ? (
        q.error ? (
          <Card>
            <ReadFailed compact error={q.error} what="the sides"
                        onRetry={() => void q.refetch()} />
          </Card>
        ) : (
          <Skeleton className="h-24 w-full" />
        )
      ) : groups.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-grey-500">
              None yet. A group is a list a dish offers - Choice of bread,
              Extra toppings, or Preferences such as No onion at 0 - made once
              and offered on as many dishes as you like.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const rule = chooseRule(g.minSelect, g.maxSelect);
            const on = g.itemIds.map((id) => dishName.get(id)).filter(Boolean);
            return (
              <Card key={g.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3.5">
                  <p className="flex-1 min-w-32 text-md font-semibold text-ink-900">
                    {g.label}
                    <span className="ml-2 text-sm font-normal text-grey-500">
                      {rule ? rule[0]!.toUpperCase() + rule.slice(1) : "Any number, or none"}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1 ml-auto">
                    <Button variant="ghost" size="sm"
                            aria-label={`Edit ${g.label}`}
                            onClick={() => setEditing(g)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm"
                            aria-label={`Dishes offering ${g.label}`}
                            onClick={() => setDishesFor(g)}>
                      Dishes
                    </Button>
                  </div>
                </div>
                <p className="px-4 text-sm text-grey-600">
                  {on.length > 0 ? `On ${on.join(", ")}` : "Not on any dish yet."}
                </p>
                <ul className="divide-y divide-grey-100 mt-2">
                  {g.addons.map((a) => (
                    <li key={a.id}
                        className="flex flex-wrap items-center gap-x-3 px-4 min-h-11 py-1">
                      <span className="flex-1 min-w-28 text-base text-ink-900 truncate">
                        {a.label}
                      </span>
                      <span className="tabular text-base text-ink-900 shrink-0 w-20 text-right">
                        {a.price === 0 ? "Free" : moneyPrecise(a.price)}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button variant="ghost" size="sm"
                                aria-label={`Change ${g.label} ${a.label}`}
                                onClick={() => setOption({ group: g, addon: a })}>
                          Change
                        </Button>
                        <Button variant="ghost" size="sm"
                                aria-label={`Remove ${g.label} ${a.label}`}
                                onClick={() => void remove(g, a)}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <CardBody className="border-t border-grey-100">
                  <Button variant="secondary" size="sm"
                          onClick={() => setOption({ group: g })}>
                    <Plus className="size-4" /> Add option
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <GroupDialog hotelId={hotelId}
                     group={editing === "new" ? undefined : editing}
                     onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
      {dishesFor && (
        <DishesDialog hotelId={hotelId} group={dishesFor} categories={categories}
                      onClose={() => setDishesFor(null)} onSaved={onChanged} />
      )}
      {option && (
        <EntryDialog
          title={option.addon
            ? `Change ${option.group.label} - ${option.addon.label}`
            : `Add an option to ${option.group.label}`}
          description="A price changed here changes on every dish that offers the group."
          name={{ label: "Option", initial: option.addon?.label ?? "",
                  placeholder: "Butter naan" }}
          initialPrice={option.addon && option.addon.price > 0 ? String(option.addon.price) : ""}
          initialFree={option.addon?.price === 0}
          onSave={async (label, typed, free) => {
            const res = option.addon
              ? await editAddonOption(hotelId, option.addon.id, label, typed, free)
              : await addAddonOption(hotelId, option.group.id, label, typed, free);
            if (res.ok) {
              toast.success(option.addon ? `${label} saved`
                : `${label} added to ${option.group.label}`);
              onChanged();
            }
            return res;
          }}
          onClose={() => setOption(null)}
        />
      )}
    </section>
  );
}

function GroupDialog({ hotelId, group, onClose, onSaved }: {
  hotelId: string; group?: AddonGroupSetup;
  onClose: () => void; onSaved: () => void;
}) {
  const [label, setLabel] = useState(group?.label ?? "");
  const [min, setMin] = useState(String(group?.minSelect ?? 0));
  const [max, setMax] = useState(group?.maxSelect == null ? "" : String(group.maxSelect));
  const [busy, setBusy] = useState(false);

  const minBad = !/^\d+$/.test(min.trim());
  const maxN = max.trim() === "" ? null : Number(max.trim());
  const maxBad = maxN !== null && (!/^\d+$/.test(max.trim()) || maxN < 1);
  const crossed = !minBad && !maxBad && maxN !== null && Number(min) > maxN;
  const ready = label.trim() !== "" && !minBad && !maxBad && !crossed;

  const submit = async () => {
    setBusy(true);
    const rule = { label: label.trim(), minSelect: Number(min), maxSelect: maxN };
    const res = group
      ? await editAddonGroup(hotelId, group.id, rule)
      : await addAddonGroup(hotelId, rule);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(group ? `${rule.label} saved` : `${rule.label} added`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={group ? `Edit ${group.label}` : "Add a group of sides"}
        description="A list a dish offers, and how many of it a guest may choose."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required hint="Printed on the kitchen slip beside each option.">
            {(f) => (
              <Input {...fieldProps(f)} value={label} autoFocus
                     placeholder="Choice of bread"
                     onChange={(e) => setLabel(e.target.value)} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Choose at least" required
                   hint="0 if the guest may take none."
                   error={minBad ? "A whole number." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={min} inputMode="numeric"
                       onChange={(e) => setMin(e.target.value)} />
              )}
            </Field>
            <Field label="Choose at most"
                   hint="Empty for no limit."
                   error={maxBad ? "A whole number from 1."
                     : crossed ? "Not fewer than at least." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={max} inputMode="numeric"
                       onChange={(e) => setMax(e.target.value)} />
              )}
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DishesDialog({ hotelId, group, categories, onClose, onSaved }: {
  hotelId: string; group: AddonGroupSetup; categories: MenuCategory[];
  onClose: () => void; onSaved: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(group.itemIds));
  const [busy, setBusy] = useState(false);

  const flip = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setBusy(true);
    const res = await setGroupDishes(hotelId, group.id, [...picked]);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`${group.label} is on ${picked.size} dish${picked.size === 1 ? "" : "es"}`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Dishes offering ${group.label}`}
        description="Tick every dish a waiter should be offered it with."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {categories.filter((c) => c.items.length > 0).map((c) => (
            <fieldset key={c.id}>
              <legend className="text-2xs uppercase tracking-wide text-grey-500 mb-1">
                {c.name}
              </legend>
              {c.items.map((item) => (
                <label key={item.id}
                       className="flex items-center gap-3 min-h-11 cursor-pointer">
                  <input type="checkbox" className="size-4"
                         checked={picked.has(item.id)}
                         onChange={() => flip(item.id)} />
                  <span className="text-base text-ink-900">{item.name}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}


/* ══════════════════════════════════════════════════════════════════
   HOW LONG IT TAKES

   ⚠ AN UNTIMED DISH SHOWS A DASH, NEVER A ZERO. Same rule the prices
   follow, and for a sharper reason: "0 min" tells a kitchen display the
   dish is instant, so it sorts to the front of the pass and a chef
   starts it last. A dash says nobody has timed it, which is true.

   INHERITED TIMES ARE SHOWN DIFFERENTLY from chosen ones. A dish
   reading "12" because its category says so, and one reading "12"
   because somebody typed it there, behave differently the next time the
   category changes — so they must not look identical. Clearing a dish
   back to inherited is the point of the empty field, and without the
   distinction it looks like the clear did nothing.
   ══════════════════════════════════════════════════════════════════ */
function PrepControl({ minutes, own, label, onSet }: {
  /** The resolved time — the dish's own, else its category's. */
  minutes: number | null;
  /** Set on this row itself. Equal to `minutes` when chosen here. */
  own: number | null;
  label: string;
  onSet: (minutes: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  /* ⚠ `== null` CATCHES UNDEFINED TOO, and that is not pedantry. The
     menu is persisted for a week, so a browser can hold a response from
     BEFORE this field existed — and `minutes === null` is false for
     undefined, which rendered the literal string "undefined min" on the
     first open of this screen. A missing field and an unset value mean
     the same thing to a reader: nobody has timed it. */
  const unset = minutes == null;
  const inherited = own == null && !unset;

  const commit = async () => {
    const text = draft.trim();
    /* An empty field CLEARS, which is a real act: the row falls back to
       its category. It is not "leave it alone" — leaving it alone is
       pressing Escape. */
    const next = text === "" ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 480)) {
      toast.error(
        "That is not a preparation time",
        "A whole number of minutes, from 1 to 480. Leave it empty to "
        + "clear it and use the category default.",
      );
      return;
    }
    setBusy(true);
    await onSet(next);
    setBusy(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        inputMode="numeric"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="min"
        className="w-16 h-11 px-2 rounded-md border border-brand-orange text-base tabular shrink-0"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setDraft(own == null ? "" : String(own));
        setEditing(true);
      }}
      className={cn(
        "press w-16 h-11 rounded-full border text-base tabular shrink-0 cursor-pointer",
        "bg-white border-grey-300 hover:border-grey-400 hover:bg-grey-50",
        unset ? "text-grey-500" : "text-ink-900",
      )}
      title={
        unset
          ? "Nobody has timed this"
          : inherited
            ? `${minutes} min, from the category`
            : `${minutes} min, set here`
      }
    >
      {/* The dash IS the answer, not a placeholder. */}
      {unset ? "-" : `${minutes}${inherited ? "*" : ""} min`}
    </button>
  );
}


/* ══════════════════════════════════════════════════════════════════
   WHICH COURSE

   ⚠ AN UNSEQUENCED DISH IS NOT COURSE ZERO. It reads "Any" and sorts
   after the sequence on the pass, because a lime soda fired before the
   starters is wrong on every table, every service. Empty clears back to
   the category, and clearing a CATEGORY takes the whole drinks list out
   of the sequence, which is what a drinks list wants.

   Same shape as `PrepControl` deliberately — two controls that behave
   differently for the same gesture is how somebody clears the wrong
   one. Both use `== null` for the reason defect 201 records: a cached
   response from before these fields existed renders as unset, not as
   the string "undefined".
   ══════════════════════════════════════════════════════════════════ */
function CourseControl({ course, own, label, onSet }: {
  course: number | null;
  own: number | null;
  label: string;
  onSet: (course: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const unset = course == null;
  const inherited = own == null && !unset;

  const commit = async () => {
    const text = draft.trim();
    const next = text === "" ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 9)) {
      toast.error(
        "That is not a course",
        "A whole number from 1 to 9. Leave it empty for a dish that is "
        + "not part of the sequence - a drink goes when it is poured.",
      );
      return;
    }
    setBusy(true);
    await onSet(next);
    setBusy(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        inputMode="numeric"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="crs"
        className="w-14 h-11 px-2 rounded-md border border-brand-orange text-base tabular shrink-0"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setDraft(own == null ? "" : String(own));
        setEditing(true);
      }}
      className={cn(
        "press w-14 h-11 rounded-full border text-base tabular shrink-0 cursor-pointer",
        "bg-white border-grey-300 hover:border-grey-400 hover:bg-grey-50",
        unset ? "text-grey-500" : "text-ink-900",
      )}
      title={
        unset
          ? "Not part of the sequence - goes when it is ready"
          : inherited
            ? `Course ${course}, from the category`
            : `Course ${course}, set here`
      }
    >
      {unset ? "Any" : `${course}${inherited ? "*" : ""}`}
    </button>
  );
}
