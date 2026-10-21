import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { ClipboardList, FileText, GlassWater, Sparkles } from "lucide-react";
import { bottlesAndMl } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, EmptyState, NativeSelect, Input,
  Segmented, StatusPill, toast,
} from "@/components/ui";
import { getBarPours, saveBarPours, type BarDish, type BarPours, type Pour } from "@/modules/stores/data/barPours";

/* ══════════════════════════════════════════════════════════════════
   INVENTORY (the owner's D27-354): Bar, and Restaurant to come

   The owner: "in the inventory section, there's two different things,
   bar and restaurant ... leave restaurant open for now". BAR: what each bar
   dish and size takes from the bar's store - ml of a bottle, or whole ones -
   which the sending of a KOT then takes off the stock (migration 235); the
   daily count; the Bar stock report; recording a bar bill. A proposal from
   the names is shown for what is not set, and saved only when chosen.
   ══════════════════════════════════════════════════════════════════ */

type Draft = { stockItemId: string; how: "ml" | "units"; amount: string };
const keyOf = (d: BarDish) => `${d.itemId}/${d.variationId ?? ""}`;
const draftOf = (p: Pour | null): Draft =>
  p ? { stockItemId: p.stockItemId, how: p.ml !== null ? "ml" : "units", amount: String(p.ml ?? p.units ?? "") }
    : { stockItemId: "", how: "units", amount: "" };
const same = (a: Draft, b: Draft) =>
  a.stockItemId === b.stockItemId && (a.stockItemId === "" || (a.how === b.how && Number(a.amount) === Number(b.amount)));

export default function InventoryPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "restaurant" ? "restaurant" : "bar";
  const q = useQuery({ queryKey: ["bar-pours", code], queryFn: () => getBarPours(code), enabled: tab === "bar" });

  return (
    <Page>
      <PageHeader
        title="Inventory"
        description={tab === "bar"
          ? "The bar's stock: what each drink takes, so a KOT sent takes it off; the daily count; and the day's report."
          : "The restaurant's stock comes next."}
        actions={tab === "bar" && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" leadingIcon={<FileText />}>
              <Link to="/reports/bar-stock">Bar stock report</Link>
            </Button>
            {q.data?.store && (
              <Button asChild variant="secondary" leadingIcon={<ClipboardList />}>
                <Link to={`/h/${code}/stores?store=${q.data.store.id}&count=1`}>Count the bar</Link>
              </Button>
            )}
            <Button asChild variant="secondary" leadingIcon={<GlassWater />}>
              <Link to={`/h/${code}/purchasing?tab=bar`}>Bar bills</Link>
            </Button>
          </div>
        )}
      />
      <Segmented className="mb-4" value={tab}
        onChange={(t) => setParams(t === "restaurant" ? { tab: "restaurant" } : {}, { replace: true })}
        options={[{ value: "bar", label: "Bar" }, { value: "restaurant", label: "Restaurant" }]} />

      {tab === "restaurant" ? (
        <Card><CardBody className="text-sm text-grey-600">
          The restaurant's stock is being built next. Until then the Store keeps the kitchen's stock, as it does today.
        </CardBody></Card>
      ) : q.isPending ? <Skeleton className="h-64" />
        : q.isError ? <ErrorState title="What each drink takes did not load" onRetry={() => void q.refetch()} />
        : <WhatEachTakes code={code} data={q.data} />}
    </Page>
  );
}

function WhatEachTakes({ code, data }: { code: string; data: BarPours }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "stock");
  const saved = useMemo(() => new Map(data.dishes.map((d) => [keyOf(d), draftOf(d.pour)])), [data]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(saved));
  const [saving, setSaving] = useState(false);
  const drinks = new Map(data.drinks.map((d) => [d.id, d]));
  const proposals = data.dishes.filter((d) => d.proposed && !d.pour && drafts[keyOf(d)]!.stockItemId === "");
  const changed = data.dishes.filter((d) => !same(drafts[keyOf(d)]!, saved.get(keyOf(d))!));

  const set = (d: BarDish, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [keyOf(d)]: { ...all[keyOf(d)]!, ...patch } }));

  const save = async () => {
    for (const d of changed) {
      const x = drafts[keyOf(d)]!;
      if (x.stockItemId && !(Number(x.amount) > 0)) {
        return toast.error("Not saved", `${d.item}${d.size ? ` ${d.size}` : ""}: how much it takes, more than none.`);
      }
    }
    setSaving(true);
    const res = await saveBarPours(code, changed.map((d) => {
      const x = drafts[keyOf(d)]!;
      return x.stockItemId === ""
        ? { itemId: d.itemId, variationId: d.variationId, stockItemId: null, ml: null, units: null }
        : { itemId: d.itemId, variationId: d.variationId, stockItemId: x.stockItemId,
            ml: x.how === "ml" ? Number(x.amount) : null, units: x.how === "units" ? Number(x.amount) : null };
    }));
    setSaving(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved", "Each KOT sent now takes these off the bar's stock.");
    void qc.invalidateQueries({ queryKey: ["bar-pours", code] });
  };

  if (!data.store) {
    return <Card><CardBody className="text-sm text-grey-600">
      This hotel has no bar store marked, so nothing can be taken off one. Mark it in Places and suppliers.
    </CardBody></Card>;
  }
  if (data.dishes.length === 0) {
    return <EmptyState icon={<GlassWater />} title="No bar dish on the menu"
      description="A dish in a section taxed as bar or alcohol shows here, with each of its sizes." />;
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-ink-900">What each drink takes from the bar</p>
            <p className="text-sm text-grey-600">
              {mayEdit ? "Pick the bottle each dish and size is poured from, and how much. Saved, every KOT sent takes it off."
                : "Set by the GM or the Inventory Manager."}
            </p>
          </div>
          {mayEdit && proposals.length > 0 && (
            <Button variant="secondary" leadingIcon={<Sparkles />}
              onClick={() => setDrafts((all) => ({ ...all,
                ...Object.fromEntries(proposals.map((d) => [keyOf(d), draftOf(d.proposed)])) }))}>
              Use the {proposals.length} suggestion{proposals.length === 1 ? "" : "s"}
            </Button>
          )}
          {mayEdit && (
            <Button variant="primary" loading={saving} disabled={changed.length === 0} onClick={() => void save()}>
              Save{changed.length ? ` ${changed.length}` : ""}
            </Button>
          )}
        </div>

        <ul className="divide-y divide-grey-100" data-bar-pours>
          {data.dishes.map((d) => {
            const x = drafts[keyOf(d)]!;
            const drink = drinks.get(x.stockItemId);
            const label = `${d.item}${d.size ? ` ${d.size}` : ""}`;
            return (
              <li key={keyOf(d)} className="py-3 grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-base text-ink-900 break-words">{label}</p>
                  <p className="text-xs text-grey-500">
                    {d.category}
                    {d.pour ? "" : d.proposed && x.stockItemId === "" ? " · a suggestion is ready" : x.stockItemId ? "" : " · nothing set: takes nothing"}
                  </p>
                </div>
                <NativeSelect aria-label={`Poured from, ${label}`} value={x.stockItemId} disabled={!mayEdit}
                  onChange={(e) => {
                    const next = drinks.get(e.target.value);
                    set(d, { stockItemId: e.target.value, how: next?.sizeMl && x.how === "ml" ? "ml" : x.how });
                  }}>
                  <option value="">Nothing set</option>
                  {data.drinks.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}{k.onHand !== null ? ` - ${bottlesAndMl(k.onHand, k.unit, k.sizeMl)} in the bar` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <div className="flex items-center gap-2">
                  <Input className="w-20 tabular" inputMode="numeric" aria-label={`How much, ${label}`}
                    disabled={!mayEdit || !x.stockItemId} value={x.amount}
                    onChange={(e) => set(d, { amount: e.target.value })} />
                  <NativeSelect className="w-auto" aria-label={`ml or whole, ${label}`} value={x.how}
                    disabled={!mayEdit || !x.stockItemId}
                    onChange={(e) => set(d, { how: e.target.value as Draft["how"] })}>
                    {drink?.sizeMl ? <option value="ml">ml of it</option> : null}
                    <option value="units">whole</option>
                  </NativeSelect>
                  {d.pour && same(x, saved.get(keyOf(d))!) && <StatusPill tone="success">Set</StatusPill>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
