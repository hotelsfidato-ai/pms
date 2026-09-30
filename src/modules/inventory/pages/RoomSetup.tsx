import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Plus, Layers, BedDouble, Cigarette, Upload, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input,
  NativeSelect, StatusPill,
} from "@/components/ui";
import { getRoomSetup, addRoomType, amendRoomType, addRoom, amendRoom, importSetup, type RoomTypeSetup, type RoomSetup as Room } from "@/modules/inventory/data/roomSetup";
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

   NOTHING IS DELETED. A room type is pointed at by reservations, rates
   and a year of folio history; a room is pointed at by every stay that
   was ever in it. Both switch off instead, and both refuse to switch
   off while something real still depends on them.
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
          <h2 className="text-md font-semibold text-ink-900 mb-3">Rooms</h2>
          <div className="grid gap-2 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
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
  const [code, setCode] = useState(type?.code ?? "");
  const [name, setName] = useState(type?.name ?? "");
  const [base, setBase] = useState(String(type?.baseOccupancy ?? 2));
  const [max, setMax] = useState(String(type?.maxOccupancy ?? 3));
  const [active, setActive] = useState(type?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = type
      ? await amendRoomType(hotelId, type.id, {
          name: name.trim(),
          baseOccupancy: Number(base), maxOccupancy: Number(max),
          isActive: active,
        })
      : await addRoomType(hotelId, {
          code: code.trim().toUpperCase(), name: name.trim(),
          baseOccupancy: Number(base), maxOccupancy: Number(max),
        });
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(type ? "Saved" : "Room type added");
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
            : "What the property sells. The rate is set separately, on the rate calendar."
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="The rate covers" required
                   hint="People included before an extra-person charge."
                   error={base.trim() !== "" && !(Number(base) >= 1) ? "At least one person." : undefined}>
              {(f) => (
                <Input {...fieldProps(f)} value={base} inputMode="numeric"
                       onChange={(e) => setBase(e.target.value)} />
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
          </div>
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
                  type. Nothing is deleted - a year of bookings points here.
                </span>
              </span>
            </label>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({
  hotelId, room, types, onClose, onDone,
}: {
  hotelId: string; room: Room | null; types: RoomTypeSetup[];
  onClose: () => void; onDone: () => void;
}) {
  const [number, setNumber] = useState(room?.number ?? "");
  const [typeId, setTypeId] = useState(
    room?.roomTypeId ?? types.find((t) => t.isActive)?.id ?? "");
  const [floor, setFloor] = useState(
    room?.floor === null || room?.floor === undefined ? "" : String(room.floor));
  const [smoking, setSmoking] = useState(room?.smoking ?? false);
  const [active, setActive] = useState(room?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
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

  const ready = (room || number.trim()) && typeId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={room ? `Room ${room.number}` : "Add a room"}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!room && (
            <Field label="Number" required hint="At most 10 letters and digits.">
              {(f) => (
                <Input {...fieldProps(f)} value={number} placeholder="308" maxLength={10}
                       onChange={(e) => setNumber(e.target.value)} />
              )}
            </Field>
          )}
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
      </DialogContent>
    </Dialog>
  );
}
