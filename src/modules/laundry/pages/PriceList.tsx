import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus, Shirt } from "lucide-react";
import { money } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast,
} from "@/components/ui";
import {
  getPriceList, addPriceItem, setPriceItem,
  SERVICE_WORDS, type LaundryService, type PriceItem,
} from "@/modules/laundry/data/laundry";

/* ══════════════════════════════════════════════════════════════════
   THE PRICE LIST — and nothing on it is priced until somebody says so

   A row per (item, service): Shirt / wash, Saree / dry-clean. Not a
   grid of every item against every service, because a property that
   presses shirts and does not dry-clean them would then have a blank
   box to explain on every line. What is not on the list is not offered.

   NO DEFAULT PRICES, and this screen is where that rule is seen. A
   price nobody has set reads "-". It is not 0, it is not blank-meaning-
   free, and it is not carried forward from anything: 0 is a real price
   that means somebody decided it is free, and a dash means nobody has
   decided at all. A bag holding an unpriced line has NO total and
   cannot be charged - refused by the database, not only by a screen.

   RETIRING IS NOT DELETING. A docket already written keeps its own copy
   of the description and the price, so taking a line off the list
   changes what can be collected tomorrow and nothing that happened.
   ══════════════════════════════════════════════════════════════════ */

const unreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

/** The rule, in one place: a figure nobody has set is a dash. Zero is
    a price and prints as one. */
const rupees = (value: number | null) => (value === null ? "-" : money(value));

export default function LaundryPriceListPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const q = useQuery({
    queryKey: ["laundry", "price-list", code],
    queryFn: () => getPriceList(code),
    enabled: !!code,
  });

  const items = q.data?.items ?? [];
  const unpriced = items.filter((i) => i.isActive && i.price === null).length;
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["laundry", "price-list", code] });

  const body = (() => {
    if (q.data === undefined) {
      /* FOUR STATES, NOT ONE. A read that could not reach the server
         must never draw "nothing is on the list yet" - a price list that
         looks empty is a price list somebody types again. */
      if (q.isPaused) {
        return (
          <ErrorState
            title="No connection"
            description="This device is offline, so the price list cannot load. It loads by itself as soon as the connection is back."
          />
        );
      }
      if (q.isError) {
        return (
          <ErrorState
            title="The price list did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server, and there is nothing from earlier to show in its place. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }

    if (items.length === 0) {
      return (
        <EmptyState
          icon={<Shirt />}
          title="Nothing is on the price list yet"
          description={
            "A line is one thing and one service - a shirt washed, a saree "
            + "dry-cleaned. Put the price in if this property has decided one; "
            + "leave it blank if it has not, and it reads a dash until somebody "
            + "does."
          }
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add the first item
            </Button>
          }
        />
      );
    }

    return (
      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-grey-200 text-ink-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">Price</th>
                <th className="px-3 py-2 text-right font-medium">On the list</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-200">
              {items.map((item) => (
                <ItemRow key={item.id} code={code} item={item} onSaved={refresh} />
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    );
  })();

  return (
    <Page>
      <PageHeader
        title="Laundry price list"
        description="What this property charges for each thing it launders, item by item and service by service."
        breadcrumbs={[
          { label: "Laundry", to: `/h/${code}/laundry` },
          { label: "Price list" },
        ]}
        actions={
          <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAdding(true)}>
            Add an item
          </Button>
        }
      />

      {/* SAID WHERE SOMEBODY WOULD LOOK, not discovered on a docket that
          will not add up. An unpriced line is legitimate - it is how the
          hotel's own linen is counted - so this is a count, not a fault. */}
      {unpriced > 0 && (
        <Card className="mb-4">
          <CardBody className="text-sm text-ink-700">
            {unpriced === 1
              ? "One item has no price yet. It reads \"-\", never 0, "
              : `${unpriced} items have no price yet. They read "-", never 0, `}
            and a guest's bag holding one has no total and cannot be charged to
            a room until somebody prices it. Leave it blank for the hotel's own
            linen, which is counted and never charged.
          </CardBody>
        </Card>
      )}

      {body}

      {adding && (
        <AddDialog code={code} onClose={() => setAdding(false)} onAdded={refresh} />
      )}
    </Page>
  );
}

/* ── One line, and its price ────────────────────────────────────────
   Typed here rather than behind a dialog: pricing eleven items is
   eleven numbers, and eleven dialogs to type them is the shape nobody
   finishes. The same reasoning as purchasing's order lines.

   BLANK PUTS IT BACK TO "NOBODY HAS PRICED IT", which is a dash. That
   is why the field is not a `type="number"` with a 0 in it.
   ═══════════════════════════════════════════════════════════════════ */
function ItemRow({
  code, item, onSaved,
}: {
  code: string; item: PriceItem; onSaved: () => void;
}) {
  const [price, setPrice] = useState(item.price === null ? "" : String(item.price));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const typed = price.trim();
    if (typed !== "" && (!Number.isFinite(Number(typed)) || Number(typed) < 0)) {
      toast.error("A price is zero or more, or nothing at all.");
      return;
    }
    if (typed === (item.price === null ? "" : String(item.price))) return;

    setSaving(true);
    /* NULL, NOT 0. Blank means nobody has priced it; 0 means somebody
       decided it is free. The two are different answers and the server
       stores them differently. */
    const out = await setPriceItem(code, item.id, {
      price: typed === "" ? null : Number(typed),
    });
    setSaving(false);
    if (!out.ok) { toast.error(out.reason); return; }
    onSaved();
  };

  const retire = async () => {
    const out = await setPriceItem(code, item.id, { isActive: !item.isActive });
    if (!out.ok) { toast.error(out.reason); return; }
    onSaved();
    toast.success(item.isActive
      ? `${item.name} is off the list. Dockets already written keep their own copy.`
      : `${item.name} is back on the list.`);
  };

  return (
    <tr className={item.isActive ? undefined : "text-ink-600"}>
      <td className="px-3 py-2">
        <span className="font-medium text-ink-900">{item.name}</span>
        <span className="text-ink-600"> · {SERVICE_WORDS[item.service]}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {item.isActive ? (
          <Input
            aria-label={`Price for ${item.name}, ${SERVICE_WORDS[item.service].toLowerCase()}`}
            inputMode="decimal"
            className="w-[100px] text-right"
            placeholder="-"
            value={price}
            disabled={saving}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => void save()}
          />
        ) : (
          <span className={item.price === null ? "text-ink-600" : undefined}>
            {rupees(item.price)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void retire()}
        >
          {item.isActive ? "Retire" : "Put back"}
        </Button>
      </td>
    </tr>
  );
}

/* ── Adding a line ──────────────────────────────────────────────────
   What it is, what is done to it, and - only if this property has
   decided one - what it costs. The price field is deliberately last and
   deliberately optional.
   ═══════════════════════════════════════════════════════════════════ */
function AddDialog({
  code, onClose, onAdded,
}: {
  code: string; onClose: () => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [service, setService] = useState<LaundryService>("wash");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!name.trim()) { setProblem("What is it called?"); return; }
    const typed = price.trim();
    if (typed !== "" && (!Number.isFinite(Number(typed)) || Number(typed) < 0)) {
      setProblem("A price is zero or more, or nothing at all.");
      return;
    }

    setSaving(true);
    const out = await addPriceItem(code, {
      name: name.trim(),
      service,
      /* BLANK IS NOT ZERO. Nobody has priced it, so none is sent. */
      price: typed === "" ? null : Number(typed),
    });
    setSaving(false);

    if (!out.ok) { setProblem(out.reason); return; }
    onAdded();
    onClose();
    toast.success(typed === ""
      ? `${name.trim()} is on the list with no price. It reads "-" until somebody sets one.`
      : `${name.trim()} is on the list.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title="Add an item to the price list">
        <div className="space-y-4">
          <Field label="What is it">
            {(p) => (
              <Input
                {...fieldProps(p)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shirt"
              />
            )}
          </Field>

          <Field label="What is done to it">
            {(p) => (
              <NativeSelect
                {...fieldProps(p)}
                value={service}
                onChange={(e) => setService(e.target.value as LaundryService)}
              >
                <option value="wash">Wash</option>
                <option value="press">Press</option>
                <option value="dry_clean">Dry-clean</option>
              </NativeSelect>
            )}
          </Field>

          <Field
            label="Price"
            hint={"Leave it blank if this property has not decided one. It reads \"-\", never 0, and a guest's bag holding it cannot be charged. Type 0 only where the answer really is free."}
          >
            {(p) => (
              <Input
                {...fieldProps(p)}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Leave blank if nobody has priced it"
              />
            )}
          </Field>

          {problem && <p role="alert" className="text-sm text-brand-red">{problem}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Add it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
