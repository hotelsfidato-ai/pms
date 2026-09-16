import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Receipt, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import {
  Card, CardBody, Button, Dialog, DialogContent, Field, fieldProps,
  Input, NativeSelect, StatusPill, toast,
} from "@/components/ui";
import { getTaxSetup, setTaxRules, setCategoryTaxKind, type TaxKind, type TaxKindRules, type TaxSlab } from "@/modules/finance/data/tax";

/* ══════════════════════════════════════════════════════════════════
   GST, IN ONE PLACE, FOR THE DESK AND THE TILL

   Before this screen there were two answers and no way to change
   either without a database session. The desk read one flat pair of
   percentages off the property; the till read a per-item rate that
   defaulted to 5% the moment somebody typed a dish in. A bar built on
   that would have billed its whisky at the restaurant's rate and
   nothing anywhere would have said so.

   ONE KIND, MANY SLABS. The rate on a room turns on what the room
   costs — at or under ₹7,500 it is one figure and above it another —
   so a kind is a list of rates and the amounts they start above, not
   a single number. Everything the desk posts follows 'room'.

   UNSET IS NOT ZERO. A kind with no slabs refuses to be billed, and
   the refusal names it. That is why the bar can sit here empty and
   safe until somebody knows the answer, and why this card shows a dash
   rather than 0%.
   ══════════════════════════════════════════════════════════════════ */

const LABEL: Record<TaxKind, string> = {
  room: "Rooms",
  restaurant: "Restaurant",
  bar: "Bar",
  banquet: "Banquet",
  other: "Everything else",
};

const WHAT: Record<TaxKind, string> = {
  room: "The night, and everything the front desk adds to it — an early "
      + "arrival, a late departure, laundry, transport.",
  restaurant: "Food and non-alcoholic drink, on any menu category set to it.",
  bar: "Alcohol. Its own rate, and its own decision.",
  banquet: "Hall hire and the packages sold with it.",
  other: "Anything that belongs under none of the above.",
};

export function TaxRulesCard({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TaxKind | null>(null);

  const setup = useQuery({
    queryKey: ["tax-setup", hotelId],
    queryFn: () => getTaxSetup(hotelId),
    enabled: !!hotelId,
  });

  const kinds = setup.data?.kinds ?? [];
  const categories = setup.data?.categories ?? [];

  /* A category selling under a kind nobody has set is the one thing
     here that actually stops a till mid-service, so it is named at the
     top rather than left to be discovered. */
  const orphaned = categories.filter((c) => {
    if (c.kind === null) return true;
    const k = kinds.find((x) => x.kind === c.kind);
    return !k || k.slabs.length === 0;
  });

  const current = kinds.find((k) => k.kind === editing) ?? null;

  return (
    <>
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-grey-400" />
            <h2 className="text-md font-semibold text-ink-900">GST</h2>
            <span className="text-sm text-grey-500">
              One set of rules, for the front desk and the till
            </span>
          </div>

          {orphaned.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-md border
                            border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-ink-900 leading-relaxed">
                {orphaned.length === 1 ? "One menu category sells" : `${orphaned.length} menu categories sell`}
                {" "}under a heading with no rate set —{" "}
                <span className="font-medium">
                  {orphaned.map((c) => c.name).join(", ")}
                </span>
                . The till will refuse those items rather than bill them at
                nothing.
              </p>
            </div>
          )}

          <div className="grid gap-2 @lg:grid-cols-2 @3xl:grid-cols-3">
            {kinds.map((k) => (
              <KindTile key={k.kind} rules={k}
                        onEdit={() => setEditing(k.kind)} />
            ))}
          </div>

          {categories.length > 0 && (
            <CategoryKinds hotelId={hotelId} categories={categories}
                           onChanged={() => {
                             void qc.invalidateQueries({
                               queryKey: ["tax-setup", hotelId] });
                           }} />
          )}
        </CardBody>
      </Card>

      {current && (
        <SlabsDialog
          hotelId={hotelId}
          rules={current}
          open
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["tax-setup", hotelId] });
          }}
        />
      )}
    </>
  );
}

function KindTile({ rules, onEdit }: {
  rules: TaxKindRules; onEdit: () => void;
}) {
  const unset = rules.slabs.length === 0;

  return (
    <div className={cn(
      "rounded-md border p-3",
      unset ? "border-dashed border-grey-300 bg-grey-50"
            : "border-grey-200 bg-white",
    )}>
      <div className="flex items-baseline gap-2">
        <p className="text-base font-medium text-ink-900">
          {LABEL[rules.kind]}
        </p>
        {unset && <StatusPill tone="neutral">Not set</StatusPill>}
      </div>

      {unset ? (
        /* A DASH, not 0%. Nothing here has decided the rate is nought;
           nobody has said what it is. */
        <p className="text-lg font-semibold text-grey-500 tabular mt-0.5">—</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rules.slabs.map((s) => (
            <li key={s.id} className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular text-ink-900">
                {s.rate}%
              </span>
              <span className="text-sm text-grey-500">
                {s.overAmount === 0
                  ? rules.slabs.length > 1 ? "up to the next band" : "on everything"
                  : `above ${money(s.overAmount)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-grey-500 mt-1.5 leading-relaxed">
        {WHAT[rules.kind]}
      </p>

      <Button variant="secondary" className="h-11 w-full mt-2.5"
              onClick={onEdit}>
        {unset ? "Set it" : "Edit"}
      </Button>
    </div>
  );
}

/* ── The slabs of one kind, edited together ───────────────────────── */

function SlabsDialog({ hotelId, rules, open, onOpenChange, onSaved }: {
  hotelId: string;
  rules: TaxKindRules;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  type Draft = { overAmount: string; rate: string; note: string };
  const [rows, setRows] = useState<Draft[]>(
    rules.slabs.length > 0
      ? rules.slabs.map((s: TaxSlab) => ({
          overAmount: String(s.overAmount),
          rate: String(s.rate),
          note: s.note ?? "",
        }))
      : [{ overAmount: "0", rate: "", note: "" }],
  );
  const [busy, setBusy] = useState(false);

  const set = (i: number, patch: Partial<Draft>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const res = await setTaxRules(
      hotelId, rules.kind,
      rows
        .filter((r) => r.rate.trim() !== "")
        .map((r) => ({
          overAmount: Number(r.overAmount) || 0,
          rate: Number(r.rate),
          note: r.note.trim() || null,
        })),
    );
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(
      `${LABEL[rules.kind]} GST saved`,
      res.slabs === 0
        ? "Cleared. Nothing under this heading can be billed until a rate is set."
        : `${res.slabs} ${res.slabs === 1 ? "rate" : "rates"}.`,
    );
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`GST on ${LABEL[rules.kind].toLowerCase()}`}
        description={WHAT[rules.kind]}
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="h-11" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-grey-600 leading-relaxed">
            One row is one rate. Leave the amount at zero for the rate that
            applies to everything; add a second row to charge more above a
            figure — rooms above {money(7500)} being the usual one.
          </p>

          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="rounded-md border border-grey-200 bg-grey-50 p-3">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 min-w-0">
                    <Field label={i === 0 ? "On everything from" : "Above"}>
                      {(f) => (
                        <Input {...fieldProps(f)} value={r.overAmount}
                               inputMode="decimal"
                               onChange={(e) => set(i, { overAmount: e.target.value })} />
                      )}
                    </Field>
                  </div>
                  <div className="w-28 shrink-0">
                    <Field label="GST %" required>
                      {(f) => (
                        <Input {...fieldProps(f)} value={r.rate}
                               inputMode="decimal" placeholder="5"
                               onChange={(e) => set(i, { rate: e.target.value })} />
                      )}
                    </Field>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove this rate"
                    onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                    className="size-11 grid place-items-center rounded-md
                               text-grey-500 hover:text-brand-red hover:bg-red-50
                               cursor-pointer shrink-0"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <Field label="Note"
                       hint="Why this band exists. It shows on this card.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={r.note}
                           placeholder="Rooms above 7,500 a night"
                           onChange={(e) => set(i, { note: e.target.value })} />
                  )}
                </Field>
              </li>
            ))}
          </ul>

          <Button variant="secondary" className="h-11 w-full"
                  onClick={() => setRows((r) => [
                    ...r, { overAmount: "7500", rate: "", note: "" }])}>
            <Plus className="size-4" /> Add a band
          </Button>

          {rows.length === 0 && (
            <p className="text-sm text-grey-600 rounded-md border border-grey-200
                          bg-grey-50 p-3 leading-relaxed">
              With no rates, nothing under this heading can be billed — the
              desk and the till will refuse it and say why. That is the right
              state for something the property does not sell yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Which menu category is taxed as what ─────────────────────────── */

function CategoryKinds({ hotelId, categories, onChanged }: {
  hotelId: string;
  categories: { name: string; kind: TaxKind | null; items: number }[];
  onChanged: () => void;
}) {
  const change = async (name: string, kind: string) => {
    const res = await setCategoryTaxKind(
      hotelId, name, (kind || null) as TaxKind | null);
    if (!res.ok) return toast.error("Not changed", res.reason);
    onChanged();
  };

  return (
    <div className="pt-1">
      <p className="text-sm text-grey-500 mb-1.5">
        The till's half: which rate each part of the menu sells under.
      </p>
      <ul className="space-y-1.5">
        {categories.map((c) => (
          <li key={c.name}
              className="flex items-center gap-3 rounded-md border
                         border-grey-200 bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-base text-ink-900 truncate">{c.name}</p>
              <p className="text-sm text-grey-500">
                {c.items} {c.items === 1 ? "item" : "items"}
              </p>
            </div>
            <div className="w-40 shrink-0">
              <NativeSelect
                aria-label={`GST heading for ${c.name}`}
                value={c.kind ?? ""}
                onChange={(e) => void change(c.name, e.target.value)}
              >
                <option value="">Not set</option>
                <option value="restaurant">Restaurant</option>
                <option value="bar">Bar</option>
                <option value="banquet">Banquet</option>
                <option value="other">Everything else</option>
              </NativeSelect>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
