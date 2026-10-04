import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { setsRates } from "@/lib/permissions";
import { Page, PageHeader, Card, CardHeader, CardBody, Button, Skeleton, EmptyState, toast } from "@/components/ui";
import {
  getPlanSettings, setMealDays, mealDaysInWords, PLAN_SETTINGS_KEY, type Day, type MealDays,
} from "@/modules/inventory/data/planSettings";

/* ══════════════════════════════════════════════════════════════════
   MEAL PLANS BY DAY (the owner's D27-258 Q5)

   On which days of a stay each meal of a plan is served: the check-in
   day, a stay-over day, the check-out day - "breakfast on stay-over and
   check-out days, dinner on check-in and stay-over". Shown on a rate
   plan's summary and the guest's voucher. A meal's PRICE is the add-on on
   Rates (How rates are built); this says only when it is served.
   ══════════════════════════════════════════════════════════════════ */

const PLANS: { code: string; name: string }[] = [
  { code: "CP", name: "Breakfast (CP)" }, { code: "MAP", name: "MAP" },
  { code: "AP", name: "AP" }, { code: "AI", name: "All inclusive (AI)" },
];
const MEALS = ["breakfast", "lunch", "dinner"] as const;
const DAYS: { day: Day; label: string }[] = [
  { day: "arrival", label: "Check-in day" }, { day: "stay", label: "Stay-over days" }, { day: "departure", label: "Check-out day" },
];

export default function MealPlansPage() {
  const hotelId = useUi((s) => s.hotelId);
  const mayEdit = setsRates(useRole());
  const q = useQuery({ queryKey: PLAN_SETTINGS_KEY(hotelId), queryFn: () => getPlanSettings(hotelId) });
  if (q.isLoading) return <Page><PageHeader title="Meal plans" description="Loading…" /><Skeleton className="h-64" /></Page>;
  if (!q.data) return <Page><PageHeader title="Meal plans" /><EmptyState title="The meal plans did not load" description="Nothing was changed." /></Page>;
  return (
    <Page>
      <PageHeader title="Meal plans"
        description="On which days of a stay each meal is served. The price of a meal is its add-on, on Rates." />
      <div className="grid gap-3 lg:grid-cols-2">
        {PLANS.map((p) => (
          <PlanCard key={p.code} hotelId={hotelId} code={p.code} name={p.name} mayEdit={mayEdit}
            days={q.data.mealDays.find((d) => d.mealPlan === p.code)} />
        ))}
      </div>
    </Page>
  );
}

function PlanCard({ hotelId, code, name, days, mayEdit }: {
  hotelId: string; code: string; name: string; days: MealDays | undefined; mayEdit: boolean;
}) {
  const qc = useQueryClient();
  const [held, setHeld] = useState<Record<(typeof MEALS)[number], Day[]>>({
    breakfast: days?.breakfast ?? [], lunch: days?.lunch ?? [], dinner: days?.dinner ?? [],
  });
  const [busy, setBusy] = useState(false);
  const flip = (meal: (typeof MEALS)[number], day: Day) => setHeld((h) => ({
    ...h, [meal]: h[meal].includes(day) ? h[meal].filter((d) => d !== day) : [...h[meal], day],
  }));
  const save = async () => {
    setBusy(true);
    const res = await setMealDays(hotelId, code, held);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Saved", name);
    void qc.invalidateQueries({ queryKey: PLAN_SETTINGS_KEY(hotelId) });
  };
  const words = mealDaysInWords({ mealPlan: code, ...held });
  return (
    <Card>
      <CardHeader title={name} description={words ?? "Not said yet."} />
      <CardBody className="pt-0">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left font-medium text-grey-500 py-1.5"><span className="sr-only">Meal</span></th>
              {DAYS.map((d) => <th key={d.day} className="font-medium text-grey-500 py-1.5 text-center">{d.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {MEALS.map((m) => (
              <tr key={m} className="border-t border-grey-100">
                <th className="text-left font-medium text-ink-900 py-2 capitalize">{m}</th>
                {DAYS.map((d) => (
                  <td key={d.day} className="text-center">
                    <input type="checkbox" checked={held[m].includes(d.day)} disabled={!mayEdit}
                           aria-label={`${name}: ${m} on the ${d.label.toLowerCase()}`}
                           onChange={() => flip(m, d.day)} className="size-4 accent-brand-orange cursor-pointer" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {mayEdit && (
          <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
