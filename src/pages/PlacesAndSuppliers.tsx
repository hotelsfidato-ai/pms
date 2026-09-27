import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { MapPin, Plus, Truck } from "lucide-react";
import {
  Page, PageHeader, Section, Button, DataTable, EmptyState, StatusPill,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, Textarea, toast,
  type Column,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   PLACES AND SUPPLIERS — /h/:code/places

   Where things are kept or stand (a main store, a kitchen store, a bar,
   the lobby) and who they come from. Shared by the Store, the equipment
   register and purchasing; owned by none of them, so it is core.

   Until this screen existed nothing could add either (migration 094 seeds
   nothing, as the owner's rule says), so no property had a store and
   equipment could never "leave the store" (S12).

   The server decides who may change them (api/src/routes/places.ts) and
   says so in `whoMay`; this screen only repeats it. Nothing is deleted:
   a place or a supplier is switched off, because stock was kept there and
   deliveries came from them.
   ══════════════════════════════════════════════════════════════════ */

type Kind = "store" | "kitchen" | "bar" | "restaurant" | "public_area" | "office" | "other";

const KIND_LABEL: Record<Kind, string> = {
  store: "Store - stock is kept here",
  kitchen: "Kitchen",
  bar: "Bar",
  restaurant: "Restaurant",
  public_area: "Public area",
  office: "Office",
  other: "Other",
};
const KINDS = Object.keys(KIND_LABEL) as Kind[];

interface Place { id: string; name: string; kind: Kind; isActive: boolean }
interface Supplier {
  id: string; name: string; contact: string | null; phone: string | null;
  email: string | null; gstin: string | null; address: string | null;
  note: string | null; isActive: boolean;
}
interface PlacesData { mayChange: boolean; whoMay: string | null; places: Place[]; suppliers: Supplier[] }

/** A read that fails throws — an unreadable list is never shown as empty. */
async function readPlaces(code: string): Promise<PlacesData> {
  try {
    return await api<PlacesData>(`/api/hotels/${code}/places`);
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      throw new Error(p?.reason ?? p?.error ?? error.message);
    }
    throw error;
  }
}

async function save(path: string, method: "POST" | "PUT", body: unknown):
  Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await api(path, { method, body: JSON.stringify(body) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}

const dash = (v: string | null) => v ?? "-";

export default function PlacesAndSuppliersPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["places", code], queryFn: () => readPlaces(code), enabled: !!code });
  const refresh = () => {
    for (const key of ["places", "equipment-options", "stores"]) {
      void qc.invalidateQueries({ queryKey: [key, code] });
    }
  };

  const [place, setPlace] = useState<Place | "new" | null>(null);
  const [supplier, setSupplier] = useState<Supplier | "new" | null>(null);

  const may = q.data?.mayChange ?? false;

  const placeColumns: Column<Place>[] = [
    { key: "name", header: "Place", cell: (p) => <span className="font-medium text-ink-900">{p.name}</span> },
    { key: "kind", header: "Kind", cell: (p) => KIND_LABEL[p.kind] ?? p.kind },
    {
      key: "state", header: "State",
      cell: (p) => p.isActive
        ? <StatusPill tone="success">In use</StatusPill>
        : <StatusPill tone="neutral">Switched off</StatusPill>,
    },
  ];

  const supplierColumns: Column<Supplier>[] = [
    {
      key: "name", header: "Supplier",
      cell: (s) => (
        <div className="min-w-0">
          <div className="font-medium text-ink-900">{s.name}</div>
          {s.contact && <div className="text-sm text-grey-600">{s.contact}</div>}
        </div>
      ),
    },
    { key: "phone", header: "Phone", cell: (s) => <span className={s.phone ? "" : "text-grey-500"}>{dash(s.phone)}</span> },
    {
      key: "gstin", header: "GSTIN", hideBelow: "md",
      cell: (s) => <span className={s.gstin ? "tabular" : "text-grey-500"}>{dash(s.gstin)}</span>,
    },
    {
      key: "state", header: "State",
      cell: (s) => s.isActive
        ? <StatusPill tone="success">In use</StatusPill>
        : <StatusPill tone="neutral">Switched off</StatusPill>,
    },
  ];

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Places and suppliers"
        description="Where stock is kept and equipment stands, and who it comes from."
      >
        {q.data && !may && q.data.whoMay && (
          <p className="text-sm text-grey-600 leading-relaxed">{q.data.whoMay}</p>
        )}
      </PageHeader>

      {/* Two sections, each a heading with its action and the list under it.
          The list draws its own frame; inside a padded card it was a card in
          a card. A row that opens something ends in an arrow, and only for
          somebody who may change it (the Tappable Rule, both ways). */}
      <Section
        title="Places"
        actions={
          <Button variant="primary" disabled={!may} onClick={() => setPlace("new")}>
            <Plus className="size-4" /> Add a place
          </Button>
        }
      >
        <DataTable
          columns={placeColumns}
          rows={q.data?.places ?? []}
          rowKey={(p) => p.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={may ? (p) => setPlace(p) : undefined}
          empty={
            <EmptyState
              icon={<MapPin />}
              title="No places yet"
              description={
                "Add where stock is kept - a main store, a kitchen store, a bar store - "
                + "and the other places equipment stands, like the lobby or the office. "
                + "Rooms are already known; they are not added here."
              }
            />
          }
        />
      </Section>

      <Section
        title="Suppliers"
        actions={
          <Button variant="secondary" disabled={!may} onClick={() => setSupplier("new")}>
            <Plus className="size-4" /> Add a supplier
          </Button>
        }
      >
        <DataTable
          columns={supplierColumns}
          rows={q.data?.suppliers ?? []}
          rowKey={(s) => s.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={may ? (s) => setSupplier(s) : undefined}
          empty={
            <EmptyState
              icon={<Truck />}
              title="No suppliers yet"
              description="Who the property buys stock and equipment from. Only a name is needed; the rest can be added later."
            />
          }
        />
      </Section>

      {place !== null && (
        <PlaceDialog code={code} place={place === "new" ? null : place}
                     onClose={() => setPlace(null)} onSaved={() => { setPlace(null); refresh(); }} />
      )}
      {supplier !== null && (
        <SupplierDialog code={code} supplier={supplier === "new" ? null : supplier}
                        onClose={() => setSupplier(null)} onSaved={() => { setSupplier(null); refresh(); }} />
      )}
    </Page>
  );
}

function PlaceDialog({ code, place, onClose, onSaved }: {
  code: string; place: Place | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(place?.name ?? "");
  const [kind, setKind] = useState<Kind | "">(place?.kind ?? "");
  const [busy, setBusy] = useState(false);
  const ready = name.trim() !== "" && kind !== "";

  const submit = async (isActive?: boolean) => {
    if (busy || (!ready && isActive === undefined)) return;
    setBusy(true);
    const res = place
      ? await save(`/api/hotels/${code}/places/${place.id}`, "PUT",
          { name: name.trim() || place.name, kind: kind || place.kind, ...(isActive === undefined ? {} : { isActive }) })
      : await save(`/api/hotels/${code}/places`, "POST", { name: name.trim(), kind });
    setBusy(false);
    if (!res.ok) return toast.error(place ? "Not saved" : "Not added", res.reason);
    toast.success(isActive === false ? `${place?.name} switched off`
      : isActive === true ? `${place?.name} switched on`
      : place ? "Saved" : `${name.trim()} added`);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={place ? place.name : "Add a place"}
        description={place ? undefined : "Somewhere stock is kept or equipment stands."}
        footer={
          <>
            {place && (
              <Button variant="secondary" className="mr-auto" disabled={busy}
                      onClick={() => void submit(!place.isActive)}>
                {place.isActive ? "Switch off" : "Switch on"}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
              {busy ? "Saving…" : place ? "Save" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            {(f) => <Input {...fieldProps(f)} value={name} placeholder="Main store"
                           onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Kind" required
                 hint="A store is where stock is kept. Equipment taken out of a store waits for the Inventory Manager.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="" disabled>Choose…</option>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </NativeSelect>
            )}
          </Field>
          {place && (
            <p className="text-sm text-grey-600 leading-relaxed">
              A place is never deleted: what was kept or stood here still says where. Switch it off
              and it is no longer offered.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SupplierDialog({ code, supplier, onClose, onSaved }: {
  code: string; supplier: Supplier | null; onClose: () => void; onSaved: () => void;
}) {
  const [v, setV] = useState({
    name: supplier?.name ?? "", contact: supplier?.contact ?? "", phone: supplier?.phone ?? "",
    email: supplier?.email ?? "", gstin: supplier?.gstin ?? "", address: supplier?.address ?? "",
    note: supplier?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const ready = v.name.trim() !== "";

  const submit = async (isActive?: boolean) => {
    if (busy || (!ready && isActive === undefined)) return;
    setBusy(true);
    const body = { ...v, name: v.name.trim() || supplier?.name, ...(isActive === undefined ? {} : { isActive }) };
    const res = supplier
      ? await save(`/api/hotels/${code}/suppliers/${supplier.id}`, "PUT", body)
      : await save(`/api/hotels/${code}/suppliers`, "POST", body);
    setBusy(false);
    if (!res.ok) return toast.error(supplier ? "Not saved" : "Not added", res.reason);
    toast.success(isActive === false ? `${supplier?.name} switched off`
      : isActive === true ? `${supplier?.name} switched on`
      : supplier ? "Saved" : `${v.name.trim()} added`);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={supplier ? supplier.name : "Add a supplier"}
        description={supplier ? undefined : "Only the name is needed now."}
        footer={
          <>
            {supplier && (
              <Button variant="secondary" className="mr-auto" disabled={busy}
                      onClick={() => void submit(!supplier.isActive)}>
                {supplier.isActive ? "Switch off" : "Switch on"}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
              {busy ? "Saving…" : supplier ? "Save" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" required>
            {(f) => <Input {...fieldProps(f)} value={v.name} placeholder="Solapur Electricals" onChange={set("name")} />}
          </Field>
          <Field label="Person to call">
            {(f) => <Input {...fieldProps(f)} value={v.contact} onChange={set("contact")} />}
          </Field>
          <Field label="Phone">
            {(f) => <Input {...fieldProps(f)} value={v.phone} inputMode="tel" onChange={set("phone")} />}
          </Field>
          <Field label="Email">
            {(f) => <Input {...fieldProps(f)} value={v.email} type="email" onChange={set("email")} />}
          </Field>
          <Field label="GSTIN" hint="15 characters, as printed on their invoice. Leave blank if you do not have it.">
            {(f) => <Input {...fieldProps(f)} value={v.gstin} className="uppercase" onChange={set("gstin")} />}
          </Field>
          <Field label="Address">
            {(f) => <Textarea {...fieldProps(f)} rows={2} value={v.address} onChange={set("address")} />}
          </Field>
          <Field label="Note">
            {(f) => <Textarea {...fieldProps(f)} rows={2} value={v.note} onChange={set("note")} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
