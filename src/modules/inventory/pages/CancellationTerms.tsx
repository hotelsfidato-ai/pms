import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus, Trash2, ShieldAlert } from "lucide-react";
import { useUi } from "@/lib/ui";
import { money } from "@/lib/format";
import {
  Page, PageHeader, Button, Card, Field, Input, NativeSelect,
  StatusPill, EmptyState, toast,
} from "@/components/ui";
import { listCancellationPolicies, addCancellationPolicy, retireCancellationPolicy, setDefaultCancellationPolicy, RETENTION_BASES, type CancellationPolicy } from "@/modules/inventory/data/rateSetup";

/* ══════════════════════════════════════════════════════════════════
   WHAT A CANCELLATION COSTS

   The night audit has always marked an arrival that never came as a
   no-show and charged nothing for it, because nothing in the system
   said what one costs. That was right while it was unmodelled — a
   guessed charge on a real guest's bill is worse than no charge, since
   a missing charge is visible and a wrong one is not.

   This is where a property writes its terms down. It ships EMPTY, and
   the audit goes on charging nothing until somebody here decides
   otherwise. That is the same rule the rates follow: the group said
   prices are not fixed and nothing is standard across properties, and
   a retention is a price.

   TWO EVENTS, PRICED SEPARATELY

   Cancelling and not turning up are different acts. Most hotels here
   charge one night for the first and the whole stay for the second,
   but "most hotels" is not this hotel, so both are asked.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/** The terms as a sentence, because a basis and a figure are not one. */
function describe(
  basis: string, percent: number | null, amount: number | null,
): string {
  switch (basis) {
    case "nothing": return "Nothing is retained";
    case "first_night": return "The first night";
    case "full_stay": return "The whole stay";
    case "percent": return percent === null ? "-" : `${percent}% of the booking`;
    case "flat": return amount === null ? "-" : money(amount);
    default: return "-";
  }
}

export default function CancellationTermsPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const policies = useQuery({
    queryKey: ["cancellation-policies", hotelId],
    queryFn: () => listCancellationPolicies(hotelId),
  });

  const makeDefault = async (p: CancellationPolicy) => {
    const res = await setDefaultCancellationPolicy(
      hotelId, p.id, !p.appliesToNewBookings,
    );
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(
      p.appliesToNewBookings
        ? "New bookings carry no terms"
        : `New bookings will use "${p.name}"`,
      /* Said explicitly. Somebody flipping this expects it to apply to
         the bookings already taken, and it does not — those froze
         whatever terms were in force when they were made. */
      "Bookings already taken keep the terms they were made under.",
    );
    await qc.invalidateQueries({ queryKey: ["cancellation-policies"] });
  };

  const retire = async (p: CancellationPolicy) => {
    const res = await retireCancellationPolicy(hotelId, p.id);
    if (!res.ok) return toast.error("Not retired", res.reason);
    toast.success(`"${p.name}" retired`, "Bookings already made keep their terms.");
    await qc.invalidateQueries({ queryKey: ["cancellation-policies"] });
  };

  const list = policies.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Cancellation terms"
        description="What a cancellation or a no-show costs at this property."
        actions={
          <Button variant="primary" onClick={() => setOpen((v) => !v)}>
            <Plus className="size-4" />
            New policy
          </Button>
        }
      />

      {open && (
        <PolicyForm
          hotelId={hotelId}
          onDone={async () => {
            setOpen(false);
            await qc.invalidateQueries({ queryKey: ["cancellation-policies"] });
          }}
          onCancel={() => setOpen(false)}
        />
      )}

      {list.length === 0 && !open ? (
        <EmptyState
          icon={<ShieldAlert />}
          title="No terms written down"
          /* Says what the consequence IS, not what the screen lacks.
             A property may be perfectly happy charging nothing, and
             this should not read as an error. */
          description={
            "Until a policy exists, the night audit charges nothing on a "
            + "no-show. That is a valid way to run a hotel - write terms "
            + "here only if this property actually bills for them."
          }
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              Write the first one
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-md font-semibold text-ink-900">
                      {p.name}
                    </h2>
                    {p.appliesToNewBookings && (
                      <StatusPill tone="success">New bookings</StatusPill>
                    )}
                    {p.bookings > 0 && (
                      <StatusPill tone="info">
                        {p.bookings} booking{p.bookings === 1 ? "" : "s"}
                      </StatusPill>
                    )}
                  </div>

                  <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-2 mt-3">
                    <div>
                      <dt className="text-2xs uppercase tracking-wide text-grey-500">
                        Free until
                      </dt>
                      <dd className="text-base text-ink-900 tabular">
                        {p.freeUntilHours === null
                          ? "No free window"
                          : p.freeUntilHours === 0
                            ? "Check-in time"
                            : `${p.freeUntilHours}h before arrival`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-2xs uppercase tracking-wide text-grey-500">
                        Cancellation
                      </dt>
                      <dd className="text-base text-ink-900">
                        {describe(p.cancelBasis, p.cancelPercent, p.cancelAmount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-2xs uppercase tracking-wide text-grey-500">
                        No-show
                      </dt>
                      <dd className="text-base text-ink-900">
                        {describe(p.noShowBasis, p.noShowPercent, p.noShowAmount)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* The switch that actually makes terms bite. Without
                      it a policy is a piece of writing: the audit reads
                      what is frozen on the BOOKING, and nothing freezes
                      anything until one policy claims new bookings. */}
                  <Button
                    variant={p.appliesToNewBookings ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => void makeDefault(p)}
                  >
                    {p.appliesToNewBookings ? "Stop using" : "Use for new bookings"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void retire(p)}
                    aria-label={`Retire ${p.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

function PolicyForm({ hotelId, onDone, onCancel }: {
  hotelId: string; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [freeHours, setFreeHours] = useState("");
  const [cancelBasis, setCancelBasis] = useState("first_night");
  const [cancelPercent, setCancelPercent] = useState("");
  const [cancelAmount, setCancelAmount] = useState("");
  const [noShowBasis, setNoShowBasis] = useState("full_stay");
  const [noShowPercent, setNoShowPercent] = useState("");
  const [noShowAmount, setNoShowAmount] = useState("");
  const [busy, setBusy] = useState(false);

  /* Empty is not zero. A blank free window means there is no free
     window at all; typing 0 means free until the check-in instant.
     Coercing "" to 0 would silently turn the first into the second. */
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const save = async () => {
    setBusy(true);
    const res = await addCancellationPolicy(hotelId, {
      name: name.trim(),
      freeUntilHours: num(freeHours),
      cancelBasis,
      cancelPercent: cancelBasis === "percent" ? num(cancelPercent) : null,
      cancelAmount: cancelBasis === "flat" ? num(cancelAmount) : null,
      noShowBasis,
      noShowPercent: noShowBasis === "percent" ? num(noShowPercent) : null,
      noShowAmount: noShowBasis === "flat" ? num(noShowAmount) : null,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`"${name.trim()}" saved`);
    await onDone();
  };

  return (
    <Card className="mb-5">
      <div className="p-4 space-y-4">
        <Field label="Name" hint="What the front desk will call it" required>
          {({ id }) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Flexible, Non-refundable, Peak season"
            />
          )}
        </Field>

        <Field
          label="Free cancellation until"
          hint="Hours before arrival. Leave empty for no free window at all."
        >
          {({ id }) => (
            <Input
              id={id}
              numeric
              value={freeHours}
              onChange={(e) => setFreeHours(e.target.value)}
              placeholder="24"
            />
          )}
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <BasisPicker
            legend="A cancellation retains"
            basis={cancelBasis} onBasis={setCancelBasis}
            percent={cancelPercent} onPercent={setCancelPercent}
            amount={cancelAmount} onAmount={setCancelAmount}
          />
          <BasisPicker
            legend="A no-show retains"
            basis={noShowBasis} onBasis={setNoShowBasis}
            percent={noShowPercent} onPercent={setNoShowPercent}
            amount={noShowAmount} onAmount={setNoShowAmount}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            Save policy
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** One event's terms: the basis, and the figure it needs — if it needs one. */
function BasisPicker({
  legend, basis, onBasis, percent, onPercent, amount, onAmount,
}: {
  legend: string;
  basis: string; onBasis: (v: string) => void;
  percent: string; onPercent: (v: string) => void;
  amount: string; onAmount: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-md border border-grey-200 p-3">
      <legend className="text-2xs uppercase tracking-wide text-grey-500 px-1">
        {legend}
      </legend>

      <Field label="Basis" required>
        {({ id }) => (
          <NativeSelect
            id={id} value={basis} onChange={(e) => onBasis(e.target.value)}
          >
            {RETENTION_BASES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </NativeSelect>
        )}
      </Field>

      {/* Only the figure the chosen basis actually needs. A percentage
          box beside "the first night" invites somebody to fill it in
          and then wonder why it had no effect. */}
      {basis === "percent" && (
        <Field label="Percentage" required>
          {({ id }) => (
            <Input
              id={id} numeric value={percent}
              onChange={(e) => onPercent(e.target.value)}
              placeholder="50"
            />
          )}
        </Field>
      )}
      {basis === "flat" && (
        <Field label="Amount" required>
          {({ id }) => (
            <Input
              id={id} numeric value={amount}
              onChange={(e) => onAmount(e.target.value)}
              placeholder="1500"
            />
          )}
        </Field>
      )}
    </fieldset>
  );
}
