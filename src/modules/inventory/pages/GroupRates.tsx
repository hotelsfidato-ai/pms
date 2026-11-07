import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, TriangleAlert } from "lucide-react";
import { money, dateShort } from "@/lib/format";
import { setsRates } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Checkbox, Field, Input, NativeSelect, Segmented,
  Skeleton, ReadFailed, readError, fieldProps, toast, IconChip,
} from "@/components/ui";
import { useHotelsWhere } from "@/modules/reports";
import {
  previewRateChange, saveRateChange, type ChangeKind, type RatePlan, type RateChangeQuestion,
} from "@/modules/inventory/data/groupRates";

/* ══════════════════════════════════════════════════════════════════
   GROUP RATE CHANGE - `/group-rates` (D27-383 item 6)

   The owner, or a revenue manager over several properties, changes one
   room type's base at several properties at once: a new price, or plus or
   minus an amount or a percent, over the days chosen. Every property's old
   and new price is shown before anything is saved; Save writes them all
   in one go, or none. The room type is matched by its NAME at each
   property and the match is shown; a property without it is listed and
   skipped. Nothing here changes a price by itself: it is a person's
   change, applied where they chose (the owner's rule).

   Only the properties where the person may set a price are offered; the
   server asks again at every one.
   ══════════════════════════════════════════════════════════════════ */

const KINDS: { value: ChangeKind; label: string }[] = [
  { value: "set", label: "New price" },
  { value: "by", label: "Plus or minus ₹" },
  { value: "percent", label: "Plus or minus %" },
];

const days = (from: string, through: string) => (from === through ? dateShort(from) : `${dateShort(from)} to ${dateShort(through)}`);
const figure = (v: number | null) => (v === null ? "-" : money(v));

export default function GroupRatesPage() {
  const qc = useQueryClient();
  const hotels = useHotelsWhere(setsRates);
  const [left, setLeft] = useState<string[]>([]);
  const codes = hotels.filter((h) => !left.includes(h.code)).map((h) => h.code);
  const earliest = hotels.filter((h) => codes.includes(h.code)).map((h) => h.businessDate).sort()[0] ?? "";
  const [roomType, setRoomType] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [kind, setKind] = useState<ChangeKind>("set");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const first = from || earliest;
  const last = through && through >= first ? through : first;
  const whole = Boolean(roomType && first && value.trim() !== "" && Number.isFinite(Number(value)));
  const question: RateChangeQuestion = { hotels: codes, roomType, from: first, through: last, kind, value: Number(value) };

  const preview = useQuery({
    queryKey: ["group-rate-change", codes, whole ? question : null],
    queryFn: () => previewRateChange(whole ? question : { hotels: codes }),
    enabled: codes.length > 0,
    staleTime: 0,
  });
  const plans = preview.data?.hotels ?? [];
  const toSave = plans.filter((p) => !p.skipped);

  const save = async () => {
    setSaving(true);
    const res = await saveRateChange(question, plans);
    setSaving(false);
    if (!res.ok) return toast.error("Nothing was saved", res.reason);
    toast.success(`Prices saved at ${res.saved.length} ${res.saved.length === 1 ? "property" : "properties"}`,
      res.saved.map((s) => s.name).join(", "));
    for (const s of res.saved) {
      void qc.invalidateQueries({ queryKey: ["pricing", s.code] });
      void qc.invalidateQueries({ queryKey: ["stay-view", s.code] });
    }
    void qc.invalidateQueries({ queryKey: ["group-rate-change"] });
    /* Cleared, so a second press cannot add the same change twice. */
    setValue("");
  };

  return (
    <Page>
      <PageHeader
        title="Group rate change"
        description="One room type's price at several properties: see every property's old and new price, then save them all together."
      />

      <div className="grid gap-4">
        <Card>
          <CardHeader title="The change" />
          <CardBody className="grid gap-4">
            {hotels.length === 0 ? (
              <p className="text-sm text-grey-600">You set prices at no property, so there is nothing to change here.</p>
            ) : (
              <>
                <fieldset>
                  <legend className="text-sm font-medium text-ink-900 mb-2">Properties</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {hotels.map((h) => (
                      <Checkbox key={h.code} label={h.name} checked={!left.includes(h.code)}
                        onCheckedChange={(on) => setLeft((l) => (on ? l.filter((c) => c !== h.code) : [...l, h.code]))} />
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Room type" hint="Matched by its name at each property.">
                    {(f) => (
                      <NativeSelect {...fieldProps(f)} value={roomType} onChange={(e) => setRoomType(e.target.value)}>
                        <option value="">Choose a room type</option>
                        {(preview.data?.roomTypes ?? []).map((t) => (
                          <option key={t.name} value={t.name}>{t.name} ({t.at.join(", ")})</option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                  <Field label="From" hint="The first day changed.">
                    {(f) => <Input {...fieldProps(f)} type="date" value={first} onChange={(e) => setFrom(e.target.value)} />}
                  </Field>
                  <Field label="Through" hint="The last day changed.">
                    {(f) => <Input {...fieldProps(f)} type="date" value={last} min={first} onChange={(e) => setThrough(e.target.value)} />}
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-medium text-ink-900 mb-1.5">Change</legend>
                    <Segmented<ChangeKind> value={kind} onChange={setKind} options={KINDS}
                      className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1" />
                  </fieldset>
                  <Field label={kind === "set" ? "New base per night" : kind === "by" ? "Plus or minus, ₹" : "Plus or minus, %"}
                    hint={kind === "set" ? "One guest, room only, as on Rates." : "A minus figure lowers it."}>
                    {(f) => (
                      <Input {...fieldProps(f)} type="number" inputMode="decimal" value={value}
                        onChange={(e) => setValue(e.target.value)} className="tabular" />
                    )}
                  </Field>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {codes.length > 0 && whole && (
          <Card>
            <CardHeader title="What will change"
              description="Nothing is saved until you press Save. Every property below is saved together, or none is." />
            <CardBody className="pt-0">
              {preview.isLoading ? <Skeleton className="h-24 w-full mt-4" />
                : readError(preview) ? (
                  <ReadFailed error={readError(preview)} what="the prices" onRetry={() => void preview.refetch()} />
                ) : preview.data?.problem ? (
                  <p className="text-sm text-grey-600 pt-4">{preview.data.problem}</p>
                ) : (
                  <>
                    <ul className="divide-y divide-grey-100">
                      {plans.map((p) => <PlanRow key={p.code} plan={p} />)}
                    </ul>
                    <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-grey-200">
                      <span className="text-sm text-grey-600">
                        {toSave.length === 0 ? "Nothing to save." : `${toSave.length} of ${plans.length} ${plans.length === 1 ? "property" : "properties"} change.`}
                      </span>
                      <Button variant="primary" disabled={saving || toSave.length === 0} onClick={() => void save()}>
                        {saving ? "Saving…" : `Save at ${toSave.length} ${toSave.length === 1 ? "property" : "properties"}`}
                      </Button>
                    </div>
                  </>
                )}
            </CardBody>
          </Card>
        )}
      </div>
    </Page>
  );
}

/** One property: its match and every run's old and new price, or why it is skipped. */
function PlanRow({ plan }: { plan: RatePlan }) {
  return (
    <li className="py-3.5 grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-6">
      <div className="flex items-start gap-3">
        <IconChip tone={plan.skipped ? "orange" : "green"}>{plan.skipped ? <TriangleAlert /> : <Check />}</IconChip>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-900">{plan.name}</span>
          <span className="block text-xs text-grey-500">
            {plan.roomType ? `${plan.roomType.name.trim()} (${plan.roomType.code})` : "No room type matched"}
          </span>
        </span>
      </div>
      {plan.skipped ? (
        <p className="text-sm text-grey-700 self-center">{plan.skipped}</p>
      ) : (
        <table className="text-sm tabular w-full max-w-xl">
          <thead>
            <tr className="text-xs text-grey-500 text-left">
              <th className="font-medium py-1">Days</th>
              <th className="font-medium py-1 text-right">Now</th>
              <th className="font-medium py-1 text-right">New</th>
            </tr>
          </thead>
          <tbody>
            {plan.runs.map((r) => (
              <tr key={r.from} className="border-t border-grey-100">
                <td className="py-1.5 text-ink-900">{days(r.from, r.through)}</td>
                <td className="py-1.5 text-right text-grey-600">{figure(r.old)}</td>
                <td className="py-1.5 text-right font-semibold text-ink-900">{figure(r.new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
