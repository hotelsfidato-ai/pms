import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Plus, Building2, UtensilsCrossed } from "lucide-react";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, Textarea,
  StatusPill,
} from "@/components/ui";
import { getBanquetSetup, addBanquetVenue, amendBanquetVenue, addBanquetPackage, type BanquetVenue } from "@/modules/banquet/data/banquet";
import { ReadFailed, ReadStale, readError } from "@/components/ui";
import { queryKeys } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   HALLS AND PACKAGES

   NOTHING HERE IS SHIPPED. No hall, no package, no price. A property
   with a banquet hall has somebody enter it, exactly as rooms are
   entered — inventing "Main Hall" at every property would put a room
   on the floor that nobody has ever seen, and inventing a rate would
   quote a wedding at a number nobody agreed.

   THE DEFAULT RATE IS AN OFFER, NOT A PRICE. It fills the box on the
   booking form and can be overwritten there; the number that gets
   billed is snapshotted onto the function, so changing a hall's usual
   rate in March cannot reprice a wedding sold in January.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

export default function BanquetSetupPage() {
  const hotelId = useHotel();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addingVenue, setAddingVenue] = useState(false);
  const [addingPackage, setAddingPackage] = useState(false);
  const [editing, setEditing] = useState<BanquetVenue | null>(null);

  const q = useQuery({
    queryKey: queryKeys.banquetSetup(hotelId),
    queryFn: () => getBanquetSetup(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.banquetSetup(hotelId) });
    void qc.invalidateQueries({ queryKey: ["banquet-diary"] });
  };

  if (q.isLoading) {
    return (
      <Page>
        <PageHeader title="Halls and packages" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  /* The read did not succeed (BQ-3). Banquet switched off arrives here as
     the server's own sentence; a fault or a lost connection says so. */
  if (!q.data) {
    return (
      <Page>
        <PageHeader title="Halls and packages" />
        <ReadFailed error={readError(q)} what="halls and packages"
                    onRetry={() => void q.refetch()} />
      </Page>
    );
  }

  const { venues, packages } = q.data;

  return (
    <Page>
      <PageHeader
        title="Halls and packages"
        description="Nothing here is created for you, and no price is ever assumed."
        actions={
          <Button variant="secondary" className="h-11"
                  onClick={() => navigate(`/h/${hotelId}/banquet`)}>
            <ArrowLeft className="size-4" /> Diary
          </Button>
        }
      />

      <ReadStale error={readError(q)} loadedAt={q.dataUpdatedAt}
                 onRetry={() => void q.refetch()} />

      {/* ── Halls ───────────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-base font-medium">
              <Building2 className="size-4 shrink-0 text-grey-500" /> Halls
            </p>
            <Button className="h-11" onClick={() => setAddingVenue(true)}>
              <Plus className="size-4" /> Add a hall
            </Button>
          </div>

          {venues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-grey-200
                          px-3 py-6 text-center text-sm text-grey-500">
              No halls yet. Enter the ones this property actually has.
            </p>
          ) : (
            <ul className="divide-y divide-grey-200">
              {venues.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{v.name}</span>
                      {!v.isActive && <StatusPill tone="neutral">Not in use</StatusPill>}
                    </p>
                    <p className="text-sm text-grey-500">
                      {v.seated !== null ? `Seats ${v.seated}` : "Seating not recorded"}
                      {v.floating !== null ? ` · ${v.floating} standing` : ""}
                      {" · "}
                      {/* A DASH. No hall ships with a price. */}
                      {v.defaultRate === null
                        ? <span className="text-grey-500">no usual rate</span>
                        : `usually ${money(v.defaultRate)}`}
                    </p>
                  </div>
                  <Button variant="secondary" className="h-11 shrink-0"
                          onClick={() => setEditing(v)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Packages ────────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-base font-medium">
              <UtensilsCrossed className="size-4 shrink-0 text-grey-500" /> Packages
            </p>
            <Button variant="secondary" className="h-11"
                    onClick={() => setAddingPackage(true)}>
              <Plus className="size-4" /> Add a package
            </Button>
          </div>

          {packages.length === 0 ? (
            <p className="rounded-lg border border-dashed border-grey-200
                          px-3 py-6 text-center text-sm text-grey-500">
              None. Packages are optional - a function can be fed off-menu, or
              from the till, or not at all.
            </p>
          ) : (
            <ul className="divide-y divide-grey-200">
              {packages.map((p) => (
                <li key={p.id} className="py-2.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.mealType && <StatusPill tone="neutral">{p.mealType}</StatusPill>}
                  </p>
                  <p className="text-sm text-grey-500">
                    {p.ratePerHead === null
                      ? <span className="text-grey-500">no rate - agreed per function</span>
                      : `${money(p.ratePerHead)} a head`}
                    {p.description ? ` · ${p.description}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {addingVenue && (
        <VenueDialog
          hotelId={hotelId} venue={null}
          onClose={() => setAddingVenue(false)}
          onDone={() => { setAddingVenue(false); refresh(); }}
        />
      )}
      {editing && (
        <VenueDialog
          hotelId={hotelId} venue={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}
      {addingPackage && (
        <PackageDialog
          hotelId={hotelId}
          onClose={() => setAddingPackage(false)}
          onDone={() => { setAddingPackage(false); refresh(); }}
        />
      )}
    </Page>
  );
}

function VenueDialog({
  hotelId, venue, onClose, onDone,
}: {
  hotelId: string; venue: BanquetVenue | null;
  onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(venue?.name ?? "");
  const [seated, setSeated] = useState(
    venue?.seated === null || venue?.seated === undefined ? "" : String(venue.seated));
  const [floating, setFloating] = useState(
    venue?.floating === null || venue?.floating === undefined ? "" : String(venue.floating));
  const [rate, setRate] = useState(
    venue?.defaultRate === null || venue?.defaultRate === undefined
      ? "" : String(venue.defaultRate));
  const [notes, setNotes] = useState(venue?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async () => {
    setBusy(true);
    const body = {
      name: name.trim(),
      seated: num(seated), floating: num(floating),
      defaultRate: num(rate),
      notes: notes || undefined,
    };
    const res = venue
      ? await amendBanquetVenue(hotelId, venue.id, body)
      : await addBanquetVenue(hotelId, body);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(venue ? "Saved" : "Hall added");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={venue ? "Edit the hall" : "Add a hall"}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" className="h-11">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-11" disabled={!name.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Emerald Hall"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Seated capacity"
                   hint="Leave blank if it has not been measured.">
              {(f) => (
                <Input {...fieldProps(f)} value={seated} inputMode="numeric"
                       placeholder="-"
                       onChange={(e) => setSeated(e.target.value)} />
              )}
            </Field>
            <Field label="Standing capacity">
              {(f) => (
                <Input {...fieldProps(f)} value={floating} inputMode="numeric"
                       placeholder="-"
                       onChange={(e) => setFloating(e.target.value)} />
              )}
            </Field>
          </div>

          <Field
            label="Usual rate"
            hint={
              "Optional, and only ever OFFERED on the booking form. What gets "
              + "billed is what somebody agrees for the function, so changing "
              + "this cannot reprice a booking already made."
            }
          >
            {(f) => (
              <Input {...fieldProps(f)} value={rate} inputMode="decimal"
                     placeholder="-"
                     onChange={(e) => setRate(e.target.value)} />
            )}
          </Field>

          <Field label="Notes">
            {(f) => (
              <Textarea {...fieldProps(f)} value={notes} rows={2}
                        onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function PackageDialog({
  hotelId, onClose, onDone,
}: {
  hotelId: string; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("");
  const [mealType, setMealType] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await addBanquetPackage(hotelId, {
      name: name.trim(),
      description: description || undefined,
      ratePerHead: rate.trim() === "" ? null : Number(rate),
      mealType: mealType || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success("Package added");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Add a package"
        description={"A package can name what is served without carrying a "
                     + "price - that is how most banquet food is sold here."}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" className="h-11">Cancel</Button>
            </DialogClose>
            <Button variant="primary" className="h-11" disabled={!name.trim() || busy}
                    onClick={() => void submit()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Dinner buffet"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rate a head" hint="Optional.">
              {(f) => (
                <Input {...fieldProps(f)} value={rate} inputMode="decimal"
                       placeholder="-"
                       onChange={(e) => setRate(e.target.value)} />
              )}
            </Field>
            <Field label="Kind" hint="Veg, non-veg, jain…">
              {(f) => (
                <Input {...fieldProps(f)} value={mealType}
                       onChange={(e) => setMealType(e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="What is in it">
            {(f) => (
              <Textarea {...fieldProps(f)} value={description} rows={3}
                        onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
