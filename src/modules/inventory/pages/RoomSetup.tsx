import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus, Layers, BedDouble, Cigarette, Upload, ChevronRight, ArrowLeft, ArrowRight, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input,
  NativeSelect, StatusPill, Segmented, Switch,
} from "@/components/ui";
import { shrinkPhoto } from "@/modules/online-checkin";
import {
  getRoomSetup, addRoomType, amendRoomType, addRoom, amendRoom, removeRoom, importSetup, removeRoomType, orderRooms,
  getTypePhotos, getTypePhoto, addTypePhoto, removeTypePhoto, orderTypePhotos,
  getAmenities, getTypeAmenities, setTypeAmenities,
  type RoomTypeSetup, type RoomSetup as Room,
} from "@/modules/inventory/data/roomSetup";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { ROOM_TYPE_SPEC, ROOM_SPEC } from "@/lib/importSpec";

/* ══════════════════════════════════════════════════════════════════
   THE HOUSE

   What the property sells and what it sells it in. Until this screen
   existed, adding a room type or a room meant a database session —
   `provision_property` builds a hotel from a template once, and after
   that the interface offered nothing. Six of the seven properties are
   still unconfigured, so this is the screen that lets them be.

   NO PRICE IS ASKED FOR HERE. A new type is unpriced, and its price is
   set on Rates (D27-188) by whoever decides what a room is
   worth. Putting a rate field on a create form is how a system ends up
   shipping prices nobody at the hotel chose.

   NOTHING IN USE IS DELETED. A room type is pointed at by reservations,
   rates and a year of folio history; a room is pointed at by every stay
   that was ever in it. Both switch off instead, and refuse to while
   something real still depends on them. A room type nothing uses may be
   Removed (the owner, D27-263: a new hotel starts empty), and so may a room
   nothing has used (D27-336: a mistake at creation). In the Settings
   console as Rooms → Room types (D27-258): adults and children, beds,
   view, size, colour, its amenities and photos, and the rooms in the order
   they are dragged.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

export default function RoomSetupPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const [addingType, setAddingType] = useState(false);
  const [editingType, setEditingType] = useState<RoomTypeSetup | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [importing, setImporting] =
    useState<"room-types" | "rooms" | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["room-setup", hotelId],
    queryFn: () => getRoomSetup(hotelId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["room-setup", hotelId] });
    /* The tape chart, the floor and the rate grid all read this. */
    void qc.invalidateQueries({ queryKey: ["rooms"] });
    void qc.invalidateQueries({ queryKey: ["room-types"] });
  };

  if (q.isLoading) {
    return (
      <Page>
        <PageHeader title="Room types" description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  if (!q.data) {
    return (
      <Page>
        <PageHeader title="Room types" />
        <EmptyState
          title="This property did not load"
          description="Nothing was changed."
        />
      </Page>
    );
  }

  const { types, rooms } = q.data;
  const dropOn = async (onto: string) => {
    if (!dragging || dragging === onto) return;
    const numbers = rooms.map((r) => r.number).filter((n) => n !== dragging);
    numbers.splice(numbers.indexOf(onto), 0, dragging);
    setDragging(null);
    const res = await orderRooms(hotelId, numbers);
    if (!res.ok) return toast.error("Not moved", res.reason);
    refresh();
  };
  const sellable = rooms.filter((r) => r.isActive).length;

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Room types"
        description={
          types.length === 0
            ? "Nothing is set up yet. Add a room type, then the rooms that are of it."
            : `${types.length} room ${types.length === 1 ? "type" : "types"} · `
              + `${rooms.length} rooms, ${sellable} sellable`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {/* A new property needs eighteen rooms before it can sell
                one, and eighteen visits to a dialog is how somebody
                gives up halfway and leaves a house half-entered. */}
            <Button variant="secondary"
                    onClick={() => setImporting("room-types")}>
              <Upload className="size-4" /> Import
            </Button>
            <Button variant="secondary"
                    onClick={() => setAddingType(true)}>
              <Layers className="size-4" /> Add a room type
            </Button>
            <Button disabled={types.length === 0}
                    onClick={() => setAddingRoom(true)}>
              <Plus className="size-4" /> Add a room
            </Button>
          </div>
        }
      />

      {/* The page's sections, 20px apart (the Rhythm Rule). What the
          property still needs, the front desk's hours and GST moved to
          Settings → Configuration (D27-194): this is the list of room
          types and their rooms. */}
      <div className="flex flex-col gap-5">

      {/* ── Types ────────────────────────────────────────────────── */}
      <section className="@container">
        <h2 className="text-md font-semibold text-ink-900 mb-3">Room types</h2>
        {types.length === 0 ? (
          <EmptyState
            title="No room types yet"
            description={
              "A room type is what the property sells - Standard, Deluxe, "
              + "Suite. Rooms are of a type, and rates are set against one."
            }
            action={
              <Button onClick={() => setAddingType(true)}>Add the first</Button>
            }
          />
        ) : (
          /* Each card spans three rows of the grid through subgrid, so a
             long name never pushes its figures below its neighbours'
             (the Level Rule). */
          <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
            {types.map((t) => (
              <Card key={t.id}
                    className="row-span-3 grid grid-rows-subgrid gap-y-2.5 px-4 py-3.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-md font-semibold text-ink-900">{t.name}</span>
                    <span className="text-sm tabular text-grey-500">{t.code}</span>
                    {!t.isActive && <StatusPill tone="neutral">Off</StatusPill>}
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-grey-100 pt-1.5 text-sm leading-[22px]">
                    <Line label="Sleeps" value={
                      t.baseOccupancy === t.maxOccupancy
                        ? String(t.baseOccupancy)
                        : `${t.baseOccupancy}, up to ${t.maxOccupancy}`} />
                    <Line label="Rooms" value={
                      t.rooms === t.sellable
                        ? String(t.rooms)
                        : `${t.sellable} of ${t.rooms}`} />
                  </dl>
                  <Button variant="secondary" className="w-full"
                          onClick={() => setEditingType(t)}>
                    Edit
                  </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Rooms ────────────────────────────────────────────────── */}
      {rooms.length > 0 && (
        <section className="@container">
          <h2 className="text-md font-semibold text-ink-900 mb-1">Rooms</h2>
          <p className="text-sm text-grey-600 mb-3">Drag a room to put the rooms in order.</p>
          <div className="grid gap-2 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                draggable
                onDragStart={() => setDragging(r.number)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void dropOn(r.number)}
                onClick={() => setEditingRoom(r)}
                className={cn(
                  /* A tile that opens something ends in an arrow (the
                     Tappable Rule). */
                  "w-full text-left rounded-lg border px-3.5 py-3 flex items-center gap-2",
                  "press-tile cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-brand-orange",
                  r.isActive
                    ? "border-grey-200 bg-white hover:border-grey-400"
                    : "border-dashed border-grey-300 bg-grey-50",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-xl font-semibold tabular",
                                        r.isActive ? "text-ink-900" : "text-grey-500")}>
                      {r.number}
                    </span>
                    {r.occupied && <BedDouble className="size-3.5 text-grey-400" />}
                    {r.smoking && <Cigarette className="size-3.5 text-grey-400" />}
                    {!r.isActive && <StatusPill tone="neutral">Off</StatusPill>}
                  </span>
                  <span className="block text-sm text-grey-500 mt-0.5 truncate">
                    {r.roomType}
                    {r.floor !== null ? ` · Floor ${r.floor}` : ""}
                  </span>
                </span>
                <GripVertical className="size-4 text-grey-300 shrink-0 cursor-grab" aria-hidden />
                <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}
      </div>

      {addingType && (
        <TypeDialog hotelId={hotelId} type={null}
          onClose={() => setAddingType(false)}
          onDone={() => { setAddingType(false); refresh(); }} />
      )}
      {editingType && (
        <TypeDialog hotelId={hotelId} type={editingType}
          onClose={() => setEditingType(null)}
          onDone={() => { setEditingType(null); refresh(); }} />
      )}
      {addingRoom && (
        <RoomDialog hotelId={hotelId} room={null} types={types}
          existing={rooms.map((r) => r.number)}
          onClose={() => setAddingRoom(false)}
          onDone={() => { setAddingRoom(false); refresh(); }} />
      )}
      {editingRoom && (
        <RoomDialog hotelId={hotelId} room={editingRoom} types={types}
          onClose={() => setEditingRoom(null)}
          onDone={() => { setEditingRoom(null); refresh(); }} />
      )}
      {importing && (
        <ImportDialog
          spec={importing === "room-types" ? ROOM_TYPE_SPEC : ROOM_SPEC}
          load={(rows, dry) => importSetup(hotelId, importing, rows, dry)}
          open
          onOpenChange={(o) => { if (!o) setImporting(null); }}
          onImported={() => {
            refresh();
            /* Room types first, then the rooms that are of them --
               that is the order the data has to arrive in, and it is
               the commonest thing to get wrong. Offering the second
               file straight after the first is cheaper than a note
               saying to come back. */
            if (importing === "room-types") setImporting("rooms");
            else setImporting(null);
          }}
        />
      )}
    </Page>
  );
}

function Line({ label, value, muted }: {
  label: string; value: string; muted?: boolean;
}) {
  return (
    <>
      <dt className="text-grey-500">{label}</dt>
      <dd className={cn("tabular text-right font-medium", muted ? "text-grey-500" : "text-grey-700")}>
        {value}
      </dd>
    </>
  );
}

function TypeDialog({
  hotelId, type, onClose, onDone,
}: {
  hotelId: string; type: RoomTypeSetup | null;
  onClose: () => void; onDone: () => void;
}) {
  const [tab, setTab] = useState<"basic" | "amenities" | "photos">("basic");
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [base, setBase] = useState(String(type?.baseOccupancy ?? 2));
  const [max, setMax] = useState(String(type?.maxOccupancy ?? 3));
  const [active, setActive] = useState(type?.isActive ?? true);
  /* The Settings console's room type (D27-258): empty = not said. */
  const [baseChildren, setBaseChildren] = useState(String(type?.baseChildren ?? 0));
  const [maxAdults, setMaxAdults] = useState(type?.maxAdults == null ? "" : String(type.maxAdults));
  const [maxChildren, setMaxChildren] = useState(type?.maxChildren == null ? "" : String(type.maxChildren));
  const [beds, setBeds] = useState(type?.beds ?? "");
  const [view, setView] = useState(type?.viewType ?? "");
  const [size, setSize] = useState(type?.sizeSqft == null ? "" : String(type.sizeSqft));
  const [colour, setColour] = useState(type?.colour ?? "");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const orNull = (v: string) => (v.trim() === "" ? null : Number(v));

  const submit = async () => {
    setBusy(true);
    let res = type
      ? await amendRoomType(hotelId, type.id, {
          name: name.trim(),
          baseOccupancy: Number(base), maxOccupancy: Number(max),
          isActive: active,
        })
      : await addRoomType(hotelId, {
          code: code.trim().toUpperCase(), name: name.trim(),
          baseOccupancy: Number(base), maxOccupancy: Number(max),
        });
    const id = type?.id ?? ("id" in res ? (res as { id?: string }).id : undefined);
    if (res.ok && id) {
      res = await amendRoomType(hotelId, id, {
        baseChildren: Number(baseChildren || 0), maxAdults: orNull(maxAdults), maxChildren: orNull(maxChildren),
        beds: beds.trim() || null, viewType: view.trim() || null, sizeSqft: orNull(size),
        colour: colour.trim() || null,
      });
    }
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(type ? "Saved" : "Room type added");
    onDone();
  };

  const remove = async () => {
    setBusy(true);
    const res = await removeRoomType(hotelId, type!.id);
    setBusy(false);
    if (!res.ok) { setRemoving(false); return toast.error("Not removed", res.reason); }
    toast.success("Room type removed", type!.name);
    onDone();
  };

  const ready = name.trim() && (type || /^[A-Za-z0-9]{2,10}$/.test(code.trim()))
    && Number(base) >= 1 && Number(max) >= Number(base);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={type ? `Edit ${type.name}` : "Add a room type"}
        description={
          type
            ? undefined
            : "What the property sells. The rate is set separately, on Rates."
        }
        footer={removing ? (
          <>
            <Button variant="secondary" onClick={() => setRemoving(false)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : `Remove ${type!.name}`}
            </Button>
          </>
        ) : (
          <>
            {type && (
              /* Only a type nothing uses (D27-263): the server says what does. */
              <Button variant="ghost" className="mr-auto" onClick={() => setRemoving(true)}>Remove</Button>
            )}
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            {tab === "basic" && (
              <Button variant="primary" disabled={!ready || busy}
                      onClick={() => void submit()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
          </>
        )}
      >
        {removing ? (
          <p className="text-sm text-grey-700">
            Remove {type!.name} for good? Only a room type with no rooms, bookings or prices can be
            removed; otherwise switch it off.
          </p>
        ) : (
        <div className="space-y-3">
          {type && (
            <Segmented<"basic" | "amenities" | "photos">
              value={tab} onChange={setTab}
              className="flex w-full [&>button]:flex-1"
              options={[
                { value: "basic", label: "Basic" },
                { value: "amenities", label: "Amenities" },
                { value: "photos", label: "Photos" },
              ]}
            />
          )}
          {tab === "amenities" && type && <TypeAmenities hotelId={hotelId} typeId={type.id} />}
          {tab === "photos" && type && <TypePhotos hotelId={hotelId} typeId={type.id} />}
          {tab === "basic" && (<>
          {!type && (
            <Field label="Code" required
                   hint="Two to ten letters or digits. It prints on the tape chart.">
              {(f) => (
                <Input {...fieldProps(f)} value={code} placeholder="DLX"
                       onChange={(e) => setCode(e.target.value.toUpperCase())} />
              )}
            </Field>
          )}
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Deluxe"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <div className="grid gap-3 grid-cols-2">
            <Field label="Adults the rate covers" required
                   hint="Before an extra-person charge."
                   error={base.trim() !== "" && !(Number(base) >= 1) ? "At least one person." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={base} inputMode="numeric"
                       onChange={(e) => setBase(e.target.value)} />
              )}
            </Field>
            <Field label="Children it covers">
              {(f) => (
                <Input {...fieldProps(f)} value={baseChildren} inputMode="numeric"
                       onChange={(e) => setBaseChildren(e.target.value)} />
              )}
            </Field>
            {/* Said, not only disabled (QA RT-6). */}
            <Field label="Sleeps at most" required
                   error={Number(base) >= 1 && max.trim() !== "" && !(Number(max) >= Number(base))
                     ? `At least what the rate covers (${Number(base)}).` : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={max} inputMode="numeric"
                       onChange={(e) => setMax(e.target.value)} />
              )}
            </Field>
            <Field label="Adults at most" hint="Empty: only the total.">
              {(f) => (
                <Input {...fieldProps(f)} value={maxAdults} inputMode="numeric" placeholder="-"
                       onChange={(e) => setMaxAdults(e.target.value)} />
              )}
            </Field>
            <Field label="Children at most" hint="Fewer than the total.">
              {(f) => (
                <Input {...fieldProps(f)} value={maxChildren} inputMode="numeric" placeholder="-"
                       onChange={(e) => setMaxChildren(e.target.value)} />
              )}
            </Field>
            <Field label="Size (sq ft)">
              {(f) => (
                <Input {...fieldProps(f)} value={size} inputMode="numeric" placeholder="-"
                       onChange={(e) => setSize(e.target.value)} />
              )}
            </Field>
            <Field label="Beds">
              {(f) => (
                <Input {...fieldProps(f)} value={beds} placeholder="1 King" maxLength={60}
                       onChange={(e) => setBeds(e.target.value)} />
              )}
            </Field>
            <Field label="View">
              {(f) => (
                <Input {...fieldProps(f)} value={view} placeholder="Garden" maxLength={60}
                       onChange={(e) => setView(e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="Colour" hint="On the Calendar and the rate plans.">
            {(f) => (
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick a colour" value={colour || "#67737e"}
                       onChange={(e) => setColour(e.target.value)}
                       className="size-10 rounded-md border border-grey-300 cursor-pointer" />
                <Input {...fieldProps(f)} value={colour} placeholder="-" className="flex-1"
                       onChange={(e) => setColour(e.target.value)} />
              </div>
            )}
          </Field>
          {type && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="mt-1 size-4 accent-brand-orange cursor-pointer"
              />
              <span className="text-sm">
                <span className="block text-ink-900">Sold at this property</span>
                <span className="block text-grey-500">
                  Switching it off refuses while rooms are still of this
                  type. Off keeps its bookings and prices.
                </span>
              </span>
            </label>
          )}
          </>)}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* A room type's amenities, from P2's one catalogue (D27-258). */
function TypeAmenities({ hotelId, typeId }: { hotelId: string; typeId: string }) {
  const all = useQuery({ queryKey: ["amenities", hotelId], queryFn: () => getAmenities(hotelId) });
  const mine = useQuery({ queryKey: ["type-amenities", typeId], queryFn: () => getTypeAmenities(hotelId, typeId) });
  const qc = useQueryClient();
  if (!all.data || !mine.data) return <Skeleton className="h-32" />;
  const on = new Set(mine.data.amenityIds);
  const offered = all.data.amenities.filter((a) => a.isActive);
  if (offered.length === 0) {
    return <p className="text-sm text-grey-600">No amenities yet. They are added under Property → Amenities.</p>;
  }
  const toggle = async (id: string) => {
    const next = on.has(id) ? [...on].filter((x) => x !== id) : [...on, id];
    const res = await setTypeAmenities(hotelId, typeId, next);
    if (!res.ok) return toast.error("Not saved", res.reason);
    void qc.invalidateQueries({ queryKey: ["type-amenities", typeId] });
  };
  return (
    <ul className="grid grid-cols-2 gap-2">
      {offered.map((a) => (
        <li key={a.id}>
          <label className="flex items-center gap-2 text-sm text-ink-900 cursor-pointer min-h-11">
            <input type="checkbox" checked={on.has(a.id)} onChange={() => void toggle(a.id)}
                   className="size-4 accent-brand-orange cursor-pointer" />
            {a.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

/* A room type's photos: ten, the gallery's rules (D27-258). */
function TypePhotos({ hotelId, typeId }: { hotelId: string; typeId: string }) {
  const q = useQuery({ queryKey: ["type-photos", typeId], queryFn: () => getTypePhotos(hotelId, typeId) });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["type-photos", typeId] });
  if (!q.data) return <Skeleton className="h-32" />;
  const { photos, most } = q.data;
  const add = async (file: File) => {
    setBusy(true);
    const blob = await shrinkPhoto(file);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const res = await addTypePhoto(hotelId, typeId, data);
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    void refresh();
  };
  const move = async (from: number, to: number) => {
    const ids = photos.map((p) => p.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    const res = await orderTypePhotos(hotelId, typeId, ids);
    if (!res.ok) return toast.error("Not moved", res.reason);
    void refresh();
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {photos.map((p, i) => (
          <figure key={p.id} className="rounded-lg border border-grey-200 overflow-hidden">
            <TypePhotoImage hotelId={hotelId} typeId={typeId} photoId={p.id} />
            <figcaption className="flex items-center justify-between gap-1 px-1.5 py-1">
              <Button variant="ghost" size="icon" aria-label="Earlier" disabled={i === 0}
                      onClick={() => void move(i, i - 1)}><ArrowLeft className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Delete this photo"
                      onClick={() => void removeTypePhoto(hotelId, typeId, p.id).then(refresh)}>
                <Trash2 className="size-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Later" disabled={i === photos.length - 1}
                      onClick={() => void move(i, i + 1)}><ArrowRight className="size-4" /></Button>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-sm text-grey-600">{photos.length} of {most}. The first is shown first.</p>
      {photos.length < most && (
        <label className={cn("inline-flex items-center gap-2 text-sm font-medium text-brand-orange-700 cursor-pointer",
                             busy && "opacity-50 pointer-events-none")}>
          <Upload className="size-4" /> {busy ? "Adding…" : "Add a photo"}
          <input type="file" accept="image/jpeg,image/png" className="sr-only"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void add(f); e.target.value = ""; }} />
        </label>
      )}
    </div>
  );
}

function TypePhotoImage({ hotelId, typeId, photoId }: { hotelId: string; typeId: string; photoId: string }) {
  const q = useQuery({ queryKey: ["type-photo", photoId],
    queryFn: () => getTypePhoto(hotelId, typeId, photoId), staleTime: Infinity });
  return q.data
    ? <img src={`data:${q.data.type};base64,${q.data.data}`} alt="" className="block w-full aspect-[4/3] object-cover" />
    : <div className="w-full aspect-[4/3] bg-grey-100" />;
}

/* SEVERAL ROOMS (the owner's D27-309, D27-335, D27-336 - loose, as it is
   per hotel): From and To are any room numbers the server takes (letters,
   digits and -, at most 10), the same except ONE number that counts up
   (101 to 109, A101 to A110, G01 to G12, VIL1 to VIL8, A-101 to A-110,
   101A to 109A) or the last letter (111A to 111D). Anything else is
   refused with its reason; at most 100 rooms at a time.
   Each number goes through the same one-room create, so the server keeps
   every check it has - a number it already has is refused there, and only
   named here. The floor typed is every room's floor, never worked out from
   the number. Zeros typed in From are kept (01 to 12 adds 01 ... 12).
   The numbers are made one at a time (nth), never all at once: a mistyped
   To of 10 digits must not build a list on every key. */
const ROOM_NO = /^[A-Za-z0-9-]{1,10}$/;   /* api/src/validate.ts roomNumberProblem */
const ROOM_NO_BAD = "At most 10 letters, digits and -, e.g. A101 or G01.";
const MOST = 100;
const runs = (s: string) => s.match(/\d+|\D+/g) ?? [];
const isDigits = (s = "") => /^\d+$/.test(s);
export function roomRange(from: string, to: string) {
  const fromBad = from && !ROOM_NO.test(from) ? ROOM_NO_BAD : undefined;
  let toBad = to && !ROOM_NO.test(to) ? ROOM_NO_BAD : undefined;
  let count = 0;
  let nth = (_i: number) => "";
  if (from && to && !fromBad && !toBad) {
    const f = runs(from), t = runs(to);
    const differ = f.flatMap((r, i) => (r === t[i] ? [] : [i]));
    const i = differ[0] ?? 0, fd = f[i] ?? "";
    const head = from.slice(0, -1), fl = from.charCodeAt(from.length - 1);
    if (from === to) {
      count = 1; nth = () => from;
    } else if (f.length === t.length && differ.length === 1 && isDigits(fd) && isDigits(t[i])) {
      count = Number(t[i]) - Number(fd) + 1;
      nth = (k) => [...f.slice(0, i), String(Number(fd) + k).padStart(fd.length, "0"), ...f.slice(i + 1)].join("");
    } else if (head === to.slice(0, -1) && /[A-Z]$/.test(from) && /[A-Z]$/.test(to)) {
      count = to.charCodeAt(to.length - 1) - fl + 1;
      nth = (k) => head + String.fromCharCode(fl + k);
    } else {
      toBad = "Only one number (or the last letter) may change between From and To.";
    }
    if (!toBad && count < 1) toBad = "To is below From.";
    else if (!toBad && count > MOST) toBad = `At most ${MOST} rooms at a time.`;
    else if (!toBad && nth(count - 1).length > 10) toBad = ROOM_NO_BAD;
    if (toBad) count = 0;
  }
  return { fromBad, toBad, count, nth };
}
const plural = (n: number) => `${n} room${n === 1 ? "" : "s"}`;

function RoomDialog({
  hotelId, room, types, existing = [], onClose, onDone,
}: {
  hotelId: string; room: Room | null; types: RoomTypeSetup[]; existing?: string[];
  onClose: () => void; onDone: () => void;
}) {
  const [several, setSeveral] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<{ added: string[]; skipped: string[]; refused: string[] } | null>(null);
  const [number, setNumber] = useState(room?.number ?? "");
  const [typeId, setTypeId] = useState(
    room?.roomTypeId ?? types.find((t) => t.isActive)?.id ?? "");
  const [floor, setFloor] = useState(
    room?.floor === null || room?.floor === undefined ? "" : String(room.floor));
  const [smoking, setSmoking] = useState(room?.smoking ?? false);
  const [active, setActive] = useState(room?.isActive ?? true);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const { fromBad, toBad, count, nth } = roomRange(from, to);

  /* D27-336: a room nothing has used (a mistake at creation); the server
     says what has used it, and a used room is switched off instead. */
  const remove = async () => {
    setBusy(true);
    const res = await removeRoom(hotelId, room!.number);
    setBusy(false);
    if (!res.ok) { setRemoving(false); return toast.error("Not removed", res.reason); }
    toast.success(`Room ${room!.number} removed`,
      res.unlinked ? `Its connecting door to room ${res.unlinked} was taken off.` : undefined);
    onDone();
  };

  const addSeveral = async () => {
    setBusy(true);
    const done = { added: [] as string[], skipped: [] as string[], refused: [] as string[] };
    for (let i = 0; i < count; i++) {
      const n = nth(i);
      const res = await addRoom(hotelId, {
        number: n, roomTypeId: typeId,
        floor: floor.trim() === "" ? null : Number(floor),
        smoking,
      });
      if (res.ok) done.added.push(n);
      else if (existing.includes(n)) done.skipped.push(n);
      else done.refused.push(`${n} not added: ${res.reason}`);
    }
    setBusy(false);
    setResult(done);
  };

  const submit = async () => {
    if (several) return addSeveral();
    setBusy(true);
    const res = room
      ? await amendRoom(hotelId, room.number, {
          roomTypeId: typeId,
          floor: floor.trim() === "" ? null : Number(floor),
          smoking, isActive: active,
        })
      : await addRoom(hotelId, {
          number: number.trim(), roomTypeId: typeId,
          floor: floor.trim() === "" ? null : Number(floor),
          smoking,
        });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(room ? "Saved" : `Room ${number.trim()} added`);
    onDone();
  };

  const ready = (several ? count > 0 : room || number.trim()) && typeId;

  return (
    /* Once rooms were added, closing the window shows them on the page. */
    <Dialog open onOpenChange={(o) => !o && (result ? onDone() : onClose())}>
      <DialogContent
        title={room ? `Room ${room.number}` : "Add a room"}
        footer={result ? (
          <Button variant="primary" onClick={onDone}>Done</Button>
        ) : removing ? (
          <>
            <Button variant="secondary" onClick={() => setRemoving(false)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : `Remove room ${room!.number}`}
            </Button>
          </>
        ) : (
          <>
            {room && (
              <Button variant="ghost" className="mr-auto" onClick={() => setRemoving(true)}>Remove</Button>
            )}
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : !several ? "Save" : count ? `Add ${plural(count)}` : "Add rooms"}
            </Button>
          </>
        )}
      >
        {result ? (
          <div role="status" className="space-y-1.5 text-sm">
            <p className="text-ink-900">
              {result.added.length
                ? `Added ${plural(result.added.length)}: ${result.added.join(", ")}`
                : "No room was added."}
            </p>
            {result.skipped.length > 0 && (
              <p className="text-grey-600">
                {`${result.skipped.join(", ")} already ${result.skipped.length === 1 ? "exists" : "exist"}, skipped`}
              </p>
            )}
            {result.refused.map((line) => <p key={line} className="text-brand-red">{line}</p>)}
          </div>
        ) : removing ? (
          <p className="text-sm text-grey-700">
            Remove room {room!.number} for good? Only a room nothing has used can be removed - no
            booking, stay, housekeeping, key card, block, work order, lost item, wake-up call,
            equipment or guest link; otherwise switch Sellable off.
          </p>
        ) : (
        <div className="space-y-3">
          {!room && <Switch checked={several} onCheckedChange={setSeveral} label="Several rooms" />}
          {!room && (several ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" required hint="e.g. 101 to 109, A101 to A110, G01 to G12, 111A to 111D." error={fromBad}>
                {(f) => (
                  <Input {...fieldProps(f)} value={from} placeholder="101" maxLength={10} autoCapitalize="characters"
                         onChange={(e) => setFrom(e.target.value.trim().toUpperCase())} />
                )}
              </Field>
              <Field label="To" required hint="At most 100 rooms at a time." error={toBad}>
                {(f) => (
                  <Input {...fieldProps(f)} value={to} placeholder="109" maxLength={10} autoCapitalize="characters"
                         onChange={(e) => setTo(e.target.value.trim().toUpperCase())} />
                )}
              </Field>
            </div>
          ) : (
            <Field label="Number" required hint="At most 10 letters, digits and -, saved in capitals.">
              {(f) => (
                <Input {...fieldProps(f)} value={number} placeholder="308" maxLength={10} autoCapitalize="characters"
                       onChange={(e) => setNumber(e.target.value.toUpperCase())} />
              )}
            </Field>
          ))}
          <Field label="Type" required>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={typeId}
                            onChange={(e) => setTypeId(e.target.value)}>
                {types.filter((t) => t.isActive || t.id === room?.roomTypeId)
                      .map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Floor" hint="0 (the ground floor) to 99. Leave blank if the property has one floor.">
            {(f) => (
              <Input {...fieldProps(f)} value={floor} inputMode="numeric"
                     placeholder="-"
                     onChange={(e) => setFloor(e.target.value)} />
            )}
          </Field>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={smoking}
                   onChange={(e) => setSmoking(e.target.checked)}
                   className="size-4 accent-brand-orange cursor-pointer" />
            <span className="text-sm text-ink-900">Smoking room</span>
          </label>

          {room && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={active}
                     onChange={(e) => setActive(e.target.checked)}
                     className="mt-1 size-4 accent-brand-orange cursor-pointer" />
              <span className="text-sm">
                <span className="block text-ink-900">Sellable</span>
                <span className="block text-grey-500">
                  {room.occupied
                    ? "Somebody is in this room, so it cannot be retired. "
                      + "Block it instead - a block carries dates and a reason."
                    : "Switching it off takes it out of the sellable house. "
                      + "For a fault with an end date, use a block."}
                </span>
              </span>
            </label>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
