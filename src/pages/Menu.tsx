import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { UtensilsCrossed, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, toast,
} from "@/components/ui";
import {
  getMenu, addCategory, addItem, toggleItem,
  type MenuCategory,
} from "@/data/repositories";

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
    </Page>
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
      <div className="px-4 pt-3.5 pb-1">
        <p className="text-2xs uppercase tracking-wide text-grey-500">
          {category.name}
        </p>
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
