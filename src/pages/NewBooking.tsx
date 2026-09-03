import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, fieldProps,
  Input, NativeSelect, Skeleton, toast,
} from "@/components/ui";
import {
  getInventory, getTariff, createBooking, type Tariff,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   BOOKING SEVERAL ROOMS

   Four Deluxes and two Superiors for the same three nights. Typed one
   at a time that is six chances to mistype a date, and nothing
   afterwards says they belong together.

   THE SUMMARY IS LIVE AND IT IS ALLOWED TO SAY "I DON'T KNOW". If the
   room type has no price for a party of three, the total is not a
   number that quietly charges for two — it is a refusal naming the
   extra adult. An unpriced person is not a free person, and the
   alternative is discovering it at check-out with the guest standing
   there.

   AVAILABILITY IS SHOWN, NOT ENFORCED. A reservation is for a room
   TYPE; deliberate overbooking is something every hotel does, and the
   model separates type from room precisely so it stays possible. The
   line says how many are left and goes amber when the booking exceeds
   it. The clerk decides.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

const PLANS = [
  { code: "EP", name: "Room only" },
  { code: "CP", name: "With breakfast" },
  { code: "MAP", name: "Breakfast and one meal" },
  { code: "AP", name: "All meals" },
];

interface Line {
  key: number;
  roomTypeId: string;
  mealPlan: string;
  adults: number;
  children: number;
  rooms: number;
  /** Empty means "use the calendar". A number is a rate somebody
      negotiated, which is what a block usually is. */
  rate: string;
}

const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`))
    / 86_400_000);

export default function NewBookingPage() {
  const hotelId = useHotel();
  const navigate = useNavigate();

  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupName, setGroupName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(1);

  /* The inventory answers two things at once: which room types exist,
     with their ids, and how many are left on the chosen nights. */
  const inventory = useQuery({
    queryKey: ["inventory", hotelId, from, to],
    queryFn: () => getInventory(hotelId, from ?? undefined, to ?? undefined),
  });

  /* The hotel's operating day, not the browser's clock — a property whose
     audit has not run is still on yesterday. */
  useEffect(() => {
    if (!from && inventory.data) {
      setFrom(inventory.data.from);
      setTo(addDays(inventory.data.from, 1));
    }
  }, [from, inventory.data]);

  const types = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const c of inventory.data?.cells ?? []) {
      if (!seen.has(c.roomTypeId)) {
        seen.set(c.roomTypeId, { id: c.roomTypeId, name: c.roomType });
      }
    }
    return [...seen.values()];
  }, [inventory.data]);

  /* The fewest left on any night of the stay — the number that decides
     whether the booking fits, not the first night's. */
  const leftFor = (roomTypeId: string) => {
    const cells = (inventory.data?.cells ?? [])
      .filter((c) => c.roomTypeId === roomTypeId
        && c.date >= (from ?? "") && c.date < (to ?? ""));
    if (cells.length === 0) return null;
    return Math.min(...cells.map((c) => c.available));
  };

  const nights = from && to ? nightsBetween(from, to) : 0;

  const addLine = () => {
    const first = types[0];
    if (!first) return;
    setLines((ls) => [...ls, {
      key: nextKey, roomTypeId: first.id, mealPlan: "EP",
      adults: 2, children: 0, rooms: 1, rate: "",
    }]);
    setNextKey((k) => k + 1);
  };

  const totalRooms = lines.reduce((n, l) => n + l.rooms, 0);

  const submit = async () => {
    if (!from || !to) return;
    setSaving(true);
    const res = await createBooking(hotelId, {
      guestName: guestName.trim(),
      phone: phone.trim(),
      checkIn: from, checkOut: to,
      ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
      lines: lines.map((l) => ({
        roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
        adults: l.adults, children: l.children, rooms: l.rooms,
        ...(l.rate.trim() === "" ? {} : { agreedRate: Number(l.rate) }),
      })),
    });
    setSaving(false);

    if (!res.ok) {
      /* The server's sentence. It names the unpriced party or the room
         type that cannot sleep them — neither of which this screen can
         work out on its own. */
      return toast.error("Not booked", res.reason);
    }

    toast.success(
      `${res.rooms} ${res.rooms === 1 ? "room" : "rooms"} booked`,
      res.groupId ? `${res.guest}, as one group.` : res.guest);
    navigate(res.groupId
      ? `/h/${hotelId}/groups/${res.groupId}`
      : `/h/${hotelId}/reservations`);
  };

  if (inventory.isLoading || !from || !to) {
    return (
      <Page>
        <PageHeader title="New booking" description="Loading…" />
        <Skeleton className="h-80" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="New booking"
        description="One guest, one set of nights, as many rooms as they need."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Who, and when" />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Guest or company" required>
                  {(f) => (
                    <Input {...fieldProps(f)} value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Sharma family" className="h-12 text-base" />
                  )}
                </Field>
                <Field label="Phone">
                  {(f) => (
                    <Input {...fieldProps(f)} value={phone} type="tel"
                      onChange={(e) => setPhone(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Arrival">
                  {(f) => (
                    <Input {...fieldProps(f)} type="date" value={from}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        if (to <= e.target.value) setTo(addDays(e.target.value, 1));
                      }}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="Departure"
                       hint={nights > 0
                         ? `${nights} ${nights === 1 ? "night" : "nights"}`
                         : "The night of departure is not charged."}>
                  {(f) => (
                    <Input {...fieldProps(f)} type="date" value={to} min={addDays(from, 1)}
                      onChange={(e) => setTo(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>

              {totalRooms > 1 && (
                <Field label="Group name"
                       hint="More than one room becomes a group. Left empty, it is named after the guest.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Sharma Wedding, March"
                      className="h-12 text-base" />
                  )}
                </Field>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Rooms"
              actions={
                <Button variant="secondary" className="h-11" onClick={addLine}
                        disabled={types.length === 0}>
                  <Plus className="size-4" /> Add
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {lines.length === 0 && (
                <p className="text-grey-500">
                  No rooms yet. Add one, and the price appears beside it.
                </p>
              )}
              {lines.map((line) => (
                <RoomLine
                  key={line.key}
                  line={line}
                  types={types}
                  left={leftFor(line.roomTypeId)}
                  hotelId={hotelId}
                  from={from} to={to}
                  onChange={(next) => setLines((ls) =>
                    ls.map((l) => (l.key === line.key ? next : l)))}
                  onRemove={() => setLines((ls) =>
                    ls.filter((l) => l.key !== line.key))}
                />
              ))}
            </CardBody>
          </Card>
        </div>

        <Summary
          hotelId={hotelId} from={from} to={to} nights={nights}
          lines={lines} types={types}
          disabled={saving || !guestName.trim() || lines.length === 0}
          onSubmit={() => void submit()}
        />
      </div>
    </Page>
  );
}

/* ── One line ─────────────────────────────────────────────────────
   The price sits beside the room, live, because the question a clerk
   is answering on the phone is "what will that cost" and walking to a
   different screen to find out loses the guest. */
function RoomLine({ line, types, left, hotelId, from, to, onChange, onRemove }: {
  line: Line;
  types: { id: string; name: string }[];
  left: number | null;
  hotelId: string; from: string; to: string;
  onChange: (l: Line) => void;
  onRemove: () => void;
}) {
  const tariff = useQuery({
    queryKey: ["tariff", hotelId, line.roomTypeId, line.mealPlan,
               from, to, line.adults, line.children],
    queryFn: () => getTariff(hotelId, {
      roomTypeId: line.roomTypeId, mealPlan: line.mealPlan,
      from, to, adults: line.adults, children: line.children,
    }),
  });

  const over = left !== null && line.rooms > left;

  return (
    <div className="rounded-lg border border-grey-200 p-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
        <NativeSelect
          value={line.roomTypeId} aria-label="Room type"
          onChange={(e) => onChange({ ...line, roomTypeId: e.target.value })}
          className="h-12 text-base"
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={line.mealPlan} aria-label="Meal plan"
          onChange={(e) => onChange({ ...line, mealPlan: e.target.value })}
          className="h-12 text-base"
        >
          {PLANS.map((p) => (
            <option key={p.code} value={p.code}>{p.name}</option>
          ))}
        </NativeSelect>
        <Button variant="secondary" className="h-12 w-12 p-0"
                aria-label="Remove this room" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Counter label="Rooms" value={line.rooms} min={1}
                 onChange={(rooms) => onChange({ ...line, rooms })} />
        <Counter label="Adults" value={line.adults} min={1}
                 onChange={(adults) => onChange({ ...line, adults })} />
        <Counter label="Children" value={line.children} min={0}
                 onChange={(children) => onChange({ ...line, children })} />
        <Field label="Rate" hint="Empty uses the calendar.">
          {(f) => (
            <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
              value={line.rate} placeholder="—"
              onChange={(e) => onChange({ ...line, rate: e.target.value })}
              className="h-12 text-base tabular" />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {/* Availability, reported. A reservation is for a room TYPE, and
            deliberate overbooking is something every hotel does. */}
        <span className={cn(over ? "text-warning-dark font-medium" : "text-grey-600")}>
          {left === null ? "—" : `${left} left`}
          {over && " · this books more than that"}
        </span>
        <LinePrice line={line} tariff={tariff.data ?? null}
                   loading={tariff.isLoading} />
      </div>
    </div>
  );
}

function LinePrice({ line, tariff, loading }: {
  line: Line; tariff: Tariff | null; loading: boolean;
}) {
  if (line.rate.trim() !== "") {
    return (
      <span className="text-grey-600">
        {money(Number(line.rate))} a night, agreed
      </span>
    );
  }
  if (loading) return <span className="text-grey-400">Pricing…</span>;
  if (!tariff) return <span className="text-grey-400">—</span>;

  if (tariff.total === null) {
    /* The whole point. A number here that quietly charged for two would
       not be discovered until check-out. */
    return (
      <span className="flex items-center gap-1.5 text-warning-dark font-medium">
        <AlertTriangle className="size-3.5" />
        No price for {tariff.unpriced}
      </span>
    );
  }
  return (
    <span className="text-grey-600">
      {money(tariff.total)} for the stay, per room
    </span>
  );
}

function Counter({ label, value, min, onChange }: {
  label: string; value: number; min: number; onChange: (n: number) => void;
}) {
  return (
    <Field label={label}>
      {(f) => (
        <Input {...fieldProps(f)} type="number" inputMode="numeric" min={min}
          value={String(value)}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
          className="h-12 text-base tabular" />
      )}
    </Field>
  );
}

/* ── The summary ──────────────────────────────────────────────────
   It refuses to show a total it cannot stand behind. */
function Summary({ hotelId, from, to, nights, lines, types, disabled, onSubmit }: {
  hotelId: string; from: string; to: string; nights: number;
  lines: Line[]; types: { id: string; name: string }[];
  disabled: boolean; onSubmit: () => void;
}) {
  const quotes = useQuery({
    queryKey: ["tariffs", hotelId, from, to, JSON.stringify(lines.map((l) =>
      [l.roomTypeId, l.mealPlan, l.adults, l.children, l.rooms, l.rate]))],
    queryFn: async () => Promise.all(lines.map(async (l) => ({
      line: l,
      tariff: l.rate.trim() !== "" ? null : await getTariff(hotelId, {
        roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
        from, to, adults: l.adults, children: l.children,
      }),
    }))),
    enabled: lines.length > 0,
  });

  const rows = quotes.data ?? [];
  const unpriced = rows.filter((r) =>
    r.line.rate.trim() === "" && r.tariff?.total === null);

  /* A DASH BEFORE ANY ROOM IS ADDED. `reduce` over an empty list gives 0,
     and ₹0 on this card reads as "this booking is free" rather than
     "nothing has been chosen yet" — the same reason an unpriced cell on the
     rate calendar is a dash. */
  const total = lines.length === 0 || unpriced.length ? null : rows.reduce((sum, r) => {
    const each = r.line.rate.trim() !== ""
      ? Number(r.line.rate) * nights
      : (r.tariff?.total ?? 0);
    return sum + each * r.line.rooms;
  }, 0);

  const rooms = lines.reduce((n, l) => n + l.rooms, 0);

  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader title="The booking" />
      <CardBody className="space-y-3">
        <dl className="divide-y divide-grey-200">
          <Row label="Nights" value={String(nights)} />
          <Row label="Rooms" value={String(rooms)} />
        </dl>

        {rows.length > 0 && (
          <ul className="text-sm text-grey-600 space-y-1">
            {rows.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">
                  {r.line.rooms} ×{" "}
                  {types.find((t) => t.id === r.line.roomTypeId)?.name ?? "—"}
                </span>
                <span className="tabular shrink-0">
                  {r.line.rate.trim() !== ""
                    ? money(Number(r.line.rate) * nights * r.line.rooms)
                    : r.tariff?.total === null || r.tariff === null
                      ? "—"
                      : money(r.tariff.total * r.line.rooms)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-3 border-t border-grey-200">
          {total === null ? (
            <>
              {/* A total that omitted the unpriced part would be short by
                  exactly the amount nobody checks. */}
              <p className="text-2xl font-semibold text-grey-300">—</p>
              {lines.length === 0 ? (
                <p className="mt-1 text-sm text-grey-500">
                  Add a room and the total appears here.
                </p>
              ) : (
                <p className="mt-1 text-sm text-warning-dark">
                  No price for {unpriced.map((u) => u.tariff?.unpriced)
                    .filter(Boolean).join(", ")}. Set it on the rate calendar,
                  or type a rate on the line.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold tabular">{money(total)}</p>
              <p className="mt-0.5 text-sm text-grey-500">
                Accommodation for the whole stay, before tax.
              </p>
            </>
          )}
        </div>

        <Button className="h-12 w-full text-base"
                disabled={disabled} onClick={onSubmit}>
          Confirm the booking
        </Button>
        {rooms > 1 && (
          <p className="text-sm text-grey-500 text-center">
            {rooms} rooms are booked as one group.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <dt className="text-base text-grey-600">{label}</dt>
      <dd className="text-base tabular">{value}</dd>
    </div>
  );
}
