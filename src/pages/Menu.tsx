import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { UtensilsCrossed, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, toast,
  Dialog, DialogContent, Field, fieldProps, Input,
} from "@/components/ui";
import {
  getMenu, addCategory, addItem, toggleItem, takeItemOff, putItemBack,
  importMenu, setItemPrepMinutes, setCategoryPrepMinutes,
  setItemCourse, setCategoryCourse,
  type OffFor,
  type MenuCategory, type MenuItem,
} from "@/data/repositories";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { MENU_SPEC } from "@/lib/importSpec";

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
  const [importing, setImporting] = useState(false);

  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["till-menu"] });
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
        actions={
          /* A real card is two hundred dishes across a dozen sections.
             Typing that into a dialog one at a time is not something
             anybody will do, so the file route sits beside the manual
             one rather than hidden behind it. */
          <Button variant="secondary" className="h-11"
                  onClick={() => setImporting(true)}>
            <Upload className="size-4" /> Import from a file
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-md border border-grey-200 bg-grey-50 p-3.5 mb-5">
        <UtensilsCrossed className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            These prices are yours
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Nothing here was shipped with the system. A price changed today
            applies to the next order — bills already printed keep the price
            they were sold at.
          </p>
        </div>
      </div>

      <Card className="mb-5">
        <CardBody>
          <p className="text-base font-medium text-ink-900 mb-1">
            Add a part of the menu
          </p>
          <p className="text-sm text-grey-600 mb-3">
            Starters, Main course, Beverages — whatever the card is organised by.
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

      {cats.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-8">
              <UtensilsCrossed className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                The menu is empty
              </p>
              <p className="text-base text-grey-500 mt-1.5 max-w-md mx-auto">
                Add a part of the menu above, then put items in it. Until then
                the till has nothing to sell.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {cats.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              hotelId={hotelId}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      {importing && (
        <ImportDialog
          spec={MENU_SPEC}
          load={(rows, dry) => importMenu(hotelId, rows, dry)}
          open
          onOpenChange={(o) => { if (!o) setImporting(false); }}
          onImported={refresh}
        />
      )}
    </Page>
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

function OffControl({ item, hotelId, onDone }: {
  item: MenuItem; hotelId: string; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const off = item.offUntil !== null
    && Date.parse(item.offUntil) > Date.now();

  const back = off
    ? new Date(item.offUntil!).toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit" })
    : null;

  const takeOff = async (until: OffFor) => {
    setBusy(true);
    const res = await takeItemOff(hotelId, item.id, until, reason.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    setOpen(false);
    setReason("");
    toast.success(`${item.name} is off`, `Back in ${
      OFF_FOR.find((o) => o.key === until)?.label.toLowerCase()}.`);
    onDone();
  };

  const putBack = async () => {
    setBusy(true);
    const res = await putItemBack(hotelId, item.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(`${item.name} is back on`);
    onDone();
  };

  if (off) {
    return (
      <Button variant="secondary" size="sm" loading={busy}
        onClick={() => void putBack()}>
        {/* When, not just whether. A waiter asked "is it back?" needs a
            time, and the row is where they look. */}
        Off till {back} — put back
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Out of stock
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`${item.name} is off`}
          description="For how long? It comes back on by itself."
          size="sm"
          footer={
            <Button variant="secondary" size="lg"
              onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        >
          <div className="space-y-4">
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
            <div className="grid grid-cols-2 gap-2">
              {OFF_FOR.map((o) => (
                <Button
                  key={o.key}
                  variant="secondary"
                  size="lg"
                  loading={busy}
                  onClick={() => void takeOff(o.key)}
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

function CategoryCard({ category, hotelId, onChanged }: {
  category: MenuCategory; hotelId: string; onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [tax, setTax] = useState("5");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const rupees = Number(price);
    if (!Number.isFinite(rupees) || rupees < 0) {
      return toast.error("Not added", "A price must be zero or more.");
    }
    const rate = Number(tax);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return toast.error("Not added", "A tax rate must be between 0 and 100.");
    }

    setBusy(true);
    const res = await addItem(hotelId, category.id, trimmed, rupees, rate);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason ?? "Refused.");
    setName("");
    setPrice("");
    onChanged();
  };

  const toggle = async (itemId: string) => {
    const res = await toggleItem(hotelId, itemId);
    if (!res.ok) return toast.error("Not changed", res.reason ?? "Refused.");
    onChanged();
  };

  return (
    <Card>
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-1">
        <p className="text-2xs uppercase tracking-wide text-grey-500 flex-1">
          {category.name}
        </p>
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
      </div>

      <ul className="divide-y divide-grey-100">
        {category.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 px-4 py-2.5 min-h-14"
          >
            <span
              className={cn(
                "flex-1 min-w-0 text-base truncate",
                item.isActive ? "text-ink-900" : "text-grey-400 line-through",
              )}
            >
              {item.name}
            </span>
            <span className="text-2xs text-grey-500 tabular shrink-0">
              {item.taxRate}%
            </span>
            <span className="tabular text-base text-ink-900 shrink-0 w-20 text-right">
              {moneyPrecise(item.price)}
            </span>
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
            <OffControl
              item={item}
              hotelId={hotelId}
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
          </li>
        ))}
        {category.items.length === 0 && (
          <li className="px-4 py-4 text-sm text-grey-500">
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
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Price"
            className="w-24 h-11 px-3 rounded-md border border-grey-300 text-base tabular"
          />
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
    </Card>
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
        "w-16 h-11 rounded-md border text-base tabular shrink-0",
        "cursor-pointer transition-colors duration-200",
        "border-grey-300 hover:border-brand-orange hover:bg-brand-orange-50",
        unset ? "text-grey-400" : "text-ink-900",
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
      {unset ? "—" : `${minutes}${inherited ? "*" : ""} min`}
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
        + "not part of the sequence — a drink goes when it is poured.",
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
        "w-14 h-11 rounded-md border text-base tabular shrink-0",
        "cursor-pointer transition-colors duration-200",
        "border-grey-300 hover:border-brand-orange hover:bg-brand-orange-50",
        unset ? "text-grey-400" : "text-ink-900",
      )}
      title={
        unset
          ? "Not part of the sequence — goes when it is ready"
          : inherited
            ? `Course ${course}, from the category`
            : `Course ${course}, set here`
      }
    >
      {unset ? "Any" : `${course}${inherited ? "*" : ""}`}
    </button>
  );
}
