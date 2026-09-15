import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus, Percent, Globe } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input,
  NativeSelect, StatusPill, DataTable, type Column,
} from "@/components/ui";
import { listBookingSources, addBookingSource, amendBookingSource, setBookingSourceCommission, SOURCE_KINDS, kindLabel, type BookingSource, type BookingSourceKind } from "@/modules/guests/data/bookingSources";

/* ══════════════════════════════════════════════════════════════════
   WHERE THE BOOKINGS COME FROM

   ⚠ THE SCREEN HAS TO SAY WHICH HALF IS WHICH, because the address
   does not. `/h/AKK/booking-sources` reads like a per-property screen
   and it is half of one:

     the LIST     is the group's. Adding Agoda adds it everywhere.
     the RATE     is this property's. 18% here is 18% here only.

   Somebody who assumes the first is per-property will add "Agoda"
   twice and then wonder why the source-mix report splits in two.
   Somebody who assumes the second is group-wide will set one hotel's
   contract on all seven. Both assumptions are natural and both are
   expensive, so the split is stated on the page rather than left to be
   inferred from a URL.

   NO COMMISSION IS INVENTED. A source with no rate agreed at this
   property shows a DASH. Not "0%", which would say the bookings cost
   nothing — a claim about money nobody at the hotel has made. Defect
   63 is this system shipping a price nobody chose, and a commission
   column defaulting to zero is the same fault wearing a hat.

   NOTHING IS DELETED. Bookings point at a source, and a booking whose
   origin vanished is one nobody can explain. A source that is no
   longer used is switched off; it stops appearing on the booking form
   and stays on every booking that already used it.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const KIND_TONES: Record<string, "info" | "accent" | "neutral" | "success"> = {
  ota: "info",
  travel_agent: "accent",
  corporate: "accent",
  direct: "success",
  walk_in: "neutral",
  other: "neutral",
};

/** A percentage, or a dash. Never a zero standing in for silence. */
function Commission({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-grey-400" title="No rate agreed">—</span>;
  }
  return (
    <span className="tabular font-medium text-ink-900">
      {pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%
    </span>
  );
}

export default function BookingSourcesPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BookingSource | null>(null);
  const [rating, setRating] = useState<BookingSource | null>(null);

  const q = useQuery({
    queryKey: ["booking-sources", hotelId],
    queryFn: () => listBookingSources(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["booking-sources"] });
  };

  const rows = q.data ?? [];
  const priced = rows.filter((s) => s.commissionPct !== null).length;
  const live = rows.filter((s) => s.isActive).length;

  const columns: Column<BookingSource>[] = [
    {
      key: "name",
      header: "Source",
      cell: (s) => (
        <div className="min-w-0">
          <p className={cn("font-medium truncate",
                           s.isActive ? "text-ink-900" : "text-grey-400")}>
            {s.name}
          </p>
          {!s.isActive && (
            <p className="text-xs text-grey-500">
              Not offered on new bookings
            </p>
          )}
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      width: "w-[150px]",
      cell: (s) => (
        <StatusPill tone={KIND_TONES[s.kind] ?? "neutral"} dot={false}>
          {kindLabel(s.kind)}
        </StatusPill>
      ),
    },
    {
      key: "code",
      header: "Channel code",
      hideBelow: "lg",
      width: "w-[160px]",
      cell: (s) => (
        s.channelCode
          ? <span className="tabular text-grey-600">{s.channelCode}</span>
          /* A walk-in has no code and never will. A dash says "none",
             which is the truth, rather than an empty cell that reads
             as "not filled in yet". */
          : <span className="text-grey-400">—</span>
      ),
    },
    {
      key: "commission",
      header: "Commission here",
      numeric: true,
      width: "w-[160px]",
      cell: (s) => <Commission pct={s.commissionPct} />,
    },
    {
      key: "bookings",
      header: "Bookings here",
      numeric: true,
      hideBelow: "md",
      width: "w-[140px]",
      cell: (s) => (
        <span className={cn("tabular",
                            s.bookings === 0 ? "text-grey-400" : "text-grey-700")}>
          {s.bookings}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "w-[220px]",
      cell: (s) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" className="h-11"
                  onClick={(e) => { e.stopPropagation(); setRating(s); }}>
            <Percent className="size-4" /> Commission
          </Button>
          <Button variant="ghost" className="h-11"
                  onClick={(e) => { e.stopPropagation(); setEditing(s); }}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  if (q.isLoading) {
    return (
      <Page className="max-w-6xl">
        <PageHeader title="Booking sources" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Booking sources"
        description={
          rows.length === 0
            ? "Nothing yet. A source is where a booking arrived from."
            : `${live} in use · ${priced} with a commission agreed here`
        }
        actions={
          <Button variant="primary" className="h-11" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a source
          </Button>
        }
      />

      {/* ── Which half is which ────────────────────────────────────
          Stated, not inferred. See the note at the top of this file. */}
      <Card>
        <CardBody className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <div className="flex items-start gap-3">
            <Globe className="size-5 text-grey-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-ink-900">
                The list is the group's
              </p>
              <p className="text-sm text-grey-600 max-w-[38ch]">
                A source added here appears at every property. Agoda is
                Agoda everywhere, so the source-mix report can add them
                up without matching names.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Percent className="size-5 text-grey-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-ink-900">
                The commission is this property's
              </p>
              <p className="text-sm text-grey-600 max-w-[38ch]">
                What you agreed here, and nowhere else. It is copied onto
                each booking as it is taken, so renegotiating later does
                not restate last month.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="No booking sources yet"
          description={
            "A source is where a booking arrived from — an OTA, a travel "
            + "agent, a corporate account, the property's own website, or "
            + "somebody at the door."
          }
          action={<Button onClick={() => setAdding(true)}>Add the first</Button>}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          empty="No booking sources yet"
        />
      )}

      {adding && (
        <SourceDialog hotelId={hotelId} onClose={() => setAdding(false)}
                      onSaved={refresh} />
      )}
      {editing && (
        <SourceDialog hotelId={hotelId} source={editing}
                      onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {rating && (
        <CommissionDialog hotelId={hotelId} source={rating}
                          onClose={() => setRating(null)} onSaved={refresh} />
      )}
    </Page>
  );
}

/* ── Adding and editing ───────────────────────────────────────────── */

function SourceDialog({
  hotelId, source, onClose, onSaved,
}: {
  hotelId: string; source?: BookingSource;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(source?.name ?? "");
  const [kind, setKind] = useState<BookingSourceKind>(source?.kind ?? "ota");
  const [code, setCode] = useState(source?.channelCode ?? "");
  const [active, setActive] = useState(source?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const ready = name.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    const result = source
      ? await amendBookingSource(hotelId, source.id, {
          name: name.trim(), kind, isActive: active,
          /* Explicit null CLEARS it; the repository leaves the field
             alone only when it is omitted entirely. A manager who
             empties the box means "there is no code". */
          channelCode: code.trim() || null,
        })
      : await addBookingSource(hotelId, {
          name: name.trim(), kind,
          ...(code.trim() ? { channelCode: code.trim() } : {}),
        });
    setBusy(false);

    if (!result.ok) { toast.error(result.reason); return; }
    toast.success(source ? `${name.trim()} saved` : `${name.trim()} added`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={source ? `Edit ${source.name}` : "Add a booking source"}
        description={
          source
            ? "Changes apply at every property in the group."
            : "It will be available at every property in the group. The "
              + "commission is set separately, on this screen, for this "
              + "property."
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" className="h-11">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Agoda"
                     className="h-12 text-base"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>

          <Field label="Kind" required
                 hint="What the name cannot answer: how much came through OTAs at all.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={kind}
                            className="h-12 text-base"
                            onChange={(e) =>
                              setKind(e.target.value as BookingSourceKind)}>
                {SOURCE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field label="Channel code"
                 hint="What a channel manager will send for this source. Leave it blank if there is none — a walk-in has no code.">
            {(f) => (
              <Input {...fieldProps(f)} value={code} placeholder="AGODA"
                     className="h-12 text-base"
                     onChange={(e) => setCode(e.target.value.toUpperCase())} />
            )}
          </Field>

          {source && (
            <label className="flex items-start gap-3 pt-1 cursor-pointer">
              <input type="checkbox" checked={active} className="mt-1 size-4"
                     onChange={(e) => setActive(e.target.checked)} />
              <span>
                <span className="text-sm font-medium text-ink-900">
                  Offer this on new bookings
                </span>
                <span className="block text-sm text-grey-600">
                  Switching it off hides it from the booking form. It stays
                  on every booking that already used it — a source is never
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

/* ── This property's commission ───────────────────────────────────── */

function CommissionDialog({
  hotelId, source, onClose, onSaved,
}: {
  hotelId: string; source: BookingSource;
  onClose: () => void; onSaved: () => void;
}) {
  /* Empty string is "no rate agreed" and is a real answer, which is why
     this is a string and not a number with a zero in it. */
  const [pct, setPct] = useState(
    source.commissionPct === null ? "" : String(source.commissionPct));
  const [busy, setBusy] = useState(false);

  const trimmed = pct.trim();
  const value = trimmed === "" ? null : Number(trimmed);
  const invalid = value !== null
    && (!Number.isFinite(value) || value < 0 || value > 100);

  const submit = async () => {
    setBusy(true);
    const result = await setBookingSourceCommission(hotelId, source.id, value);
    setBusy(false);
    if (!result.ok) { toast.error(result.reason); return; }
    toast.success(
      value === null
        ? `No rate agreed with ${source.name} here`
        : `${source.name} at ${value}% here`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${source.name} — commission here`}
        description={
          "What this property pays. Other properties keep their own rate, "
          + "and bookings already taken keep the rate they were taken at."
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" className="h-11">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-11" disabled={invalid || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="Commission"
            hint="Per cent of the booking. Leave it blank if no rate has been agreed."
            error={invalid ? "Between 0 and 100." : undefined}
          >
            {(f) => (
              <div className="flex items-center gap-2">
                <Input {...fieldProps(f)} value={pct} inputMode="decimal"
                       placeholder="—" className="h-12 text-base tabular"
                       onChange={(e) => setPct(e.target.value)} />
                <span className="text-grey-500">%</span>
              </div>
            )}
          </Field>

          {/* ⚠ THE DIFFERENCE THIS SCREEN MUST NOT BLUR. Blank and zero
              are two different statements, and a manager is allowed to
              make either. Saying so here is cheaper than discovering it
              from a report. */}
          <p className="text-sm text-grey-600">
            {trimmed === ""
              ? "Blank means no rate has been agreed. The list shows a dash, "
                + "and bookings taken through this source record no commission."
              : value === 0
                ? "Zero means you agreed to pay nothing — which is not the "
                  + "same as leaving it blank."
                : "Copied onto each booking as it is taken. Changing it later "
                  + "does not change bookings already made."}
          </p>

          {source.bookings > 0 && (
            <p className="text-sm text-grey-500">
              {source.bookings} booking{source.bookings === 1 ? "" : "s"} at
              {" "}this property came through {source.name}.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
