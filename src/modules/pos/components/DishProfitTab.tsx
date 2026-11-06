import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardHeader, CardBody, DataTable, EmptyState, Field, fieldProps, Input, type Column,
} from "@/components/ui";
import { moneyPrecise } from "@/lib/format";
import { BUSINESS_DATE } from "@/data/repositories";
import { getDishProfit, type DishProfit } from "@/modules/pos/data/till";

/* ══════════════════════════════════════════════════════════════════
   PROFIT PER DISH (D27-383 item 9) - the Menu's third tab, for the owner,
   an Admin and the GM.

   A dish's cost is its recipe (Inventory's Restaurant tab, D27-374) at each
   Store item's average cost today; its margin is the menu price less that.
   No recipe, or an ingredient nobody has priced: a dash, never zero - and
   the reason beside it. Below, what the paid bills of the chosen days sold
   of each, at the price sold.
   ══════════════════════════════════════════════════════════════════ */

const dash = (n: number | null) => (n === null ? "-" : moneyPrecise(n));

type Dish = DishProfit["dishes"][number];
type Sold = DishProfit["sold"][number];

export function DishProfitTab({ hotelId }: { hotelId: string }) {
  /* The business date is set at sign-in, so it is read here, never at import. */
  const [from, setFrom] = useState(() => BUSINESS_DATE.slice(0, 8) + "01");
  const [to, setTo] = useState(() => BUSINESS_DATE);
  const q = useQuery({
    queryKey: ["dish-profit", hotelId, from, to],
    queryFn: () => getDishProfit(hotelId, from, to),
    enabled: Boolean(hotelId && from && to && from <= to),
  });

  const why = (r: Dish | Sold) => r.noCost && <span className="block text-2xs text-grey-500">{r.noCost}</span>;
  const dishColumns: Column<Dish>[] = [
    { key: "name", header: "Dish", cell: (d) => <span>{d.name}<span className="block text-2xs text-grey-500">{d.section}</span></span> },
    { key: "price", header: "Menu price", numeric: true, cell: (d) => moneyPrecise(d.price) },
    { key: "cost", header: "Cost", numeric: true, cell: (d) => <span>{dash(d.cost)}{why(d)}</span> },
    { key: "margin", header: "Margin", numeric: true, cell: (d) => dash(d.margin) },
    { key: "pct", header: "Margin %", numeric: true, cell: (d) => (d.marginPct === null ? "-" : `${d.marginPct}%`) },
  ];
  const soldColumns: Column<Sold>[] = [
    { key: "name", header: "Dish", cell: (s) => s.name },
    { key: "qty", header: "Sold", numeric: true, cell: (s) => s.qty },
    { key: "sales", header: "Sales", numeric: true, cell: (s) => moneyPrecise(s.sales) },
    { key: "cost", header: "Cost", numeric: true, cell: (s) => <span>{dash(s.cost)}{why(s)}</span> },
    { key: "margin", header: "Margin", numeric: true, cell: (s) => dash(s.margin) },
  ];
  const t = q.data?.totals;

  return (
    <div className="space-y-5">
      <p className="text-sm text-grey-600 leading-relaxed max-w-3xl">
        A dish's cost is its recipe (Inventory, Restaurant tab) at each Store item's average cost today.
        A dish with no recipe, or with an ingredient nobody has priced, shows a dash: it has no cost yet,
        which is not the same as costing nothing.
      </p>
      <Card>
        <CardHeader title="Each dish" description="At its menu price now." />
        <CardBody>
          <DataTable columns={dishColumns} rows={q.data?.dishes ?? []} rowKey={(d) => `${d.itemId}:${d.variationId ?? ""}`}
                     loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
                     empty={<EmptyState compact title="No dishes on the menu yet" />} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="What was sold" description="The dishes on paid bills of these days, at the price sold, before the bill's discount." />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Field label="From">{(f) => <Input {...fieldProps(f)} type="date" value={from} className="w-44" onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To">{(f) => <Input {...fieldProps(f)} type="date" value={to} className="w-44" onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
          {t && (
            <p className="text-base text-ink-900" data-profit-total>
              Sales {moneyPrecise(t.sales)}. Of the dishes with a cost: sales {moneyPrecise(t.costedSales)},
              cost {moneyPrecise(t.cost)}, margin {moneyPrecise(t.margin)}.
              {t.uncostedSales > 0 && <span className="text-grey-600"> {moneyPrecise(t.uncostedSales)} was sold of dishes with no cost.</span>}
            </p>
          )}
          <DataTable columns={soldColumns} rows={q.data?.sold ?? []} rowKey={(s) => `${s.itemId}:${s.variationId ?? ""}`}
                     loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
                     empty={<EmptyState compact title="Nothing sold on these days" />} />
        </CardBody>
      </Card>
    </div>
  );
}
