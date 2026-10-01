import { useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { CheckCircle2, Circle, Plus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { mayReach } from "@/components/app/navigation";
import {
  Page, PageHeader, Section, Card, CardBody, Button, Skeleton, toast,
  Dialog, DialogContent, Field, fieldProps, Input, Segmented, ReadFailed,
} from "@/components/ui";
import {
  getTillSetup, getMenu, nameRestaurant, addSection, renameSection, takeSectionAway,
  addTables, changeTable, takeTableAway, type TillSetup, type SetupTable, type MenuCategory,
} from "@/modules/pos/data/till";
import { getTableHours, setTableHours, type TableHours } from "@/modules/pos/data/tableBookings";

/* ══════════════════════════════════════════════════════════════════
   RESTAURANT SETUP (D22-6, the owner's answers of 25 September)

   A new hotel's restaurant, without a developer's command: its name
   (printed on every bill), its sections and its tables - one, or a
   numbered run - and a ready-to-open list of the six things a first order
   needs, each opening the screen that does it. For the owner, an
   administrator and the GM. Nothing is deleted: taking a table or a
   section away switches it off, and the server refuses it while a bill
   sits on it.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

type Done = { ok: boolean; reason?: string };

export default function SetupPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  /* ASKED AGAIN EVERY TIME THE PAGE OPENS. The app keeps a read until told
     otherwise (staleTime Infinity) and keeps the menu on the device, so a
     dish added on another screen or device left "Dishes on the menu" at
     "None yet" - and a ready-to-open list that is not current is worse than
     none. */
  const setup = useQuery({
    queryKey: ["till-setup", hotelId],
    queryFn: () => getTillSetup(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 0,
  });
  const menu = useQuery({
    queryKey: ["till-menu", hotelId],
    queryFn: () => getMenu(hotelId),
    staleTime: 0,
  });

  /** Every write: the server's sentence on a refusal, and a fresh read -
      Tables reads the same rows, so its cached floor goes stale too. */
  const run = async (write: Promise<Done>, done: string) => {
    const res = await write;
    if (!res.ok) {
      toast.error("Not saved", res.reason);
      return false;
    }
    toast.success(done);
    void qc.invalidateQueries({ queryKey: ["till-setup", hotelId] });
    void qc.invalidateQueries({ queryKey: ["floor", hotelId] });
    return true;
  };

  return (
    <Page>
      <PageHeader
        title="Restaurant setup"
        description="Name the restaurant, lay out its sections and tables, and see what is left before its first order."
      />

      {setup.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : setup.error || !setup.data ? (
        <Card>
          <ReadFailed error={setup.error} what="the restaurant's setup"
                      onRetry={() => void setup.refetch()} />
        </Card>
      ) : (
        <>
          <ReadyToOpen hotelId={hotelId} setup={setup.data} menu={menu} />
          <Restaurant hotelId={hotelId} setup={setup.data} run={run} />
          <Sections hotelId={hotelId} setup={setup.data} run={run} />
          <TableBookingHours hotelId={hotelId} />
        </>
      )}
    </Page>
  );
}

type Run = (write: Promise<Done>, done: string) => Promise<boolean>;

/* ── Table booking hours (D27-224) ─────────────────────────────────── */

/* When hotel guests may ask for a table, per restaurant: lunch and dinner,
   in half-hour slots, the last half an hour before each ends. The owner's
   default is lunch 12:30-15:00 and dinner 19:30-23:00; an empty meal is not
   offered, and both empty means no table booking here. */
function TableBookingHours({ hotelId }: { hotelId: string }) {
  const q = useQuery({
    queryKey: ["table-hours", hotelId],
    queryFn: () => getTableHours(hotelId),
    enabled: Boolean(hotelId),
  });
  return (
    <Section title="Table booking hours"
             description="When hotel guests may ask for a table from their own page. Somebody at the restaurant confirms each request.">
      {q.isLoading ? <Skeleton className="h-24 w-full" />
        : q.isError || !q.data ? <ReadFailed compact error={q.error} what="the table booking hours" onRetry={() => void q.refetch()} />
        : q.data.restaurants.map((r) => <HoursCard key={r.code} hotelId={hotelId} restaurant={r} />)}
    </Section>
  );
}

function HoursCard({ hotelId, restaurant: r }: { hotelId: string; restaurant: TableHours }) {
  const qc = useQueryClient();
  const [lunch, setLunch] = useState(r.lunch);
  const [dinner, setDinner] = useState(r.dinner);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await setTableHours(hotelId, r.code, lunch, dinner);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Hours saved", "Guests are offered these from now on.");
    void qc.invalidateQueries({ queryKey: ["table-hours", hotelId] });
  };
  return (
    <Card>
      <CardBody className="space-y-3">
        <p className="text-base font-medium text-ink-900">{r.name}</p>
        <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
          <Field label="Lunch" hint="Such as 12:30-15:00. Empty: no lunch bookings.">
            {(f) => <Input {...fieldProps(f)} value={lunch} className="tabular" onChange={(e) => setLunch(e.target.value)} />}
          </Field>
          <Field label="Dinner" hint="Such as 19:30-23:00. Empty: no dinner bookings.">
            {(f) => <Input {...fieldProps(f)} value={dinner} className="tabular" onChange={(e) => setDinner(e.target.value)} />}
          </Field>
        </div>
        <p className="text-sm text-grey-600 break-words">
          {r.slots.length ? `Slots: ${r.slots.join(", ")}` : "No table booking at this restaurant."}
        </p>
        <Button variant="secondary" loading={busy} onClick={() => void save()}>Save hours</Button>
      </CardBody>
    </Card>
  );
}

/* ── Ready to open: the six ticks the owner chose ─────────────────── */

function ReadyToOpen({ hotelId, setup, menu }: {
  hotelId: string;
  setup: TillSetup;
  menu: UseQueryResult<MenuCategory[]>;
}) {
  const role = useRole();
  const tables = setup.sections.reduce((n, s) => n + s.tables.length, 0);
  const dishes = (menu.data ?? []).flatMap((c) => c.items).filter((i) => i.isActive);
  const noRate = dishes.filter((i) => i.taxRate === null).length;
  const menuSaid = (text: string) =>
    menu.error ? "The menu could not be read" : menu.isLoading ? "Reading the menu" : text;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /* `asks`: the menu entry that decides who is offered the link, where `to`
     is a tab of it and not an entry of its own. */
  const ticks: { done: boolean; label: string; detail: string; to?: string; asks?: string; open?: string }[] = [
    { done: setup.restaurant !== null, label: "Restaurant named",
      detail: setup.restaurant?.name ?? "Not named yet - below" },
    { done: tables > 0, label: "Tables laid out",
      detail: tables
        ? `${plural(tables, "table", "tables")} in ${plural(setup.sections.length, "section", "sections")}`
        : "None yet - below" },
    { done: dishes.length > 0, label: "Dishes on the menu",
      detail: menuSaid(dishes.length ? plural(dishes.length, "dish", "dishes") : "None yet"),
      to: "/h/:code/menu", open: "Open Menu" },
    { done: dishes.length > 0 && noRate === 0, label: "A GST rate for every dish",
      detail: menuSaid(!dishes.length ? "Checked once there are dishes"
        : noRate ? `${plural(noRate, "dish has", "dishes have")} none - they cannot be rung`
        : "Every dish has one"),
      to: "/settings/taxes-and-billing", open: "Open Settings" },
    { done: setup.waiters > 0, label: "A waiter",
      detail: setup.waiters ? plural(setup.waiters, "person", "people") + " with the Waiter role"
        : "Nobody has the Waiter role yet",
      to: "/people", open: "Open People" },
    /* Always ticked: this screen, like the till, does not open where the
       restaurant is switched off (the owner kept it on the list). */
    { done: true, label: "Restaurant switched on",
      detail: "On - this screen opens only when it is",
      to: "/settings/modules-and-connections", asks: "/settings", open: "Open Settings" },
  ];

  return (
    <Section title="Ready to open" description="What a first order needs. Each line opens the screen that does it.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ticks.map((t) => (
          <Card key={t.label}>
            <CardBody className="flex items-start gap-3">
              {t.done
                ? <CheckCircle2 aria-label="Done" className="size-5 text-success-600 shrink-0 mt-0.5" />
                : <Circle aria-label="Not yet" className="size-5 text-grey-400 shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-ink-900">{t.label}</p>
                <p className="text-sm text-grey-600 mt-0.5">{t.detail}</p>
                {t.to && t.open && mayReach(role, t.asks ?? t.to) && (
                  <Link to={t.to.replace(":code", hotelId)}
                        className="inline-block mt-1.5 text-sm font-medium text-brand-orange-700 hover:underline">
                    {t.open}
                  </Link>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ── The restaurant's name ────────────────────────────────────────── */

function Restaurant({ hotelId, setup, run }: { hotelId: string; setup: TillSetup; run: Run }) {
  const [name, setName] = useState(setup.restaurant?.name ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    await run(nameRestaurant(hotelId, name), setup.restaurant ? "Name changed" : "Restaurant named");
    setBusy(false);
  };

  return (
    <Section title="The restaurant" description="Its name is printed on every bill and shown on the till.">
      <Card>
        <CardBody>
          <form className="flex flex-col sm:flex-row sm:items-end gap-3"
                onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Name" className="flex-1 max-w-md">
              {(f) => <Input {...fieldProps(f)} value={name} placeholder="Main Restaurant"
                             onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" loading={busy} disabled={!name.trim()}
                    variant={setup.restaurant ? "secondary" : "primary"}>
              {setup.restaurant ? "Save name" : "Name the restaurant"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </Section>
  );
}

/* ── Sections and their tables ────────────────────────────────────── */

function Sections({ hotelId, setup, run }: { hotelId: string; setup: TillSetup; run: Run }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    if (await run(addSection(hotelId, name), `${name.trim()} added`)) setName("");
    setBusy(false);
  };

  return (
    <Section title="Sections and tables"
             description="A section is a part of the room - A/C, Non A/C, the bar - and tables sit inside one, four to a row, in the order they are added.">
      {!setup.restaurant ? (
        <Card><CardBody>
          <p className="text-sm text-grey-600">Name the restaurant first - its sections sit inside it.</p>
        </CardBody></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {setup.sections.map((s) => (
            <SectionCard key={s.id} hotelId={hotelId} section={s} run={run} />
          ))}
          <Card>
            <CardBody>
              <form className="flex flex-col sm:flex-row sm:items-end gap-3"
                    onSubmit={(e) => { e.preventDefault(); void add(); }}>
                <Field label="New section" className="flex-1 max-w-md">
                  {(f) => <Input {...fieldProps(f)} value={name} placeholder="A/C"
                                 onChange={(e) => setName(e.target.value)} />}
                </Field>
                <Button type="submit" loading={busy} disabled={!name.trim()}>
                  <Plus className="size-4" /> Add section
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      )}
    </Section>
  );
}

function SectionCard({ hotelId, section, run }: {
  hotelId: string; section: TillSetup["sections"][number]; run: Run;
}) {
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [table, setTable] = useState<SetupTable | null>(null);
  const busyTables = section.tables.filter((t) => t.busy).map((t) => t.label);

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-md font-semibold text-ink-900">{section.name}</h3>
            <p className="text-sm text-grey-600">
              {section.tables.length === 1 ? "1 table" : `${section.tables.length} tables`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>Rename</Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(true)}>Take away</Button>
          </div>
        </div>

        {section.tables.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {section.tables.map((t) => (
              <button key={t.id} type="button" onClick={() => setTable(t)}
                      className={cn(
                        "press-tile text-left rounded-lg ring-1 ring-inset ring-grey-200 bg-white px-3.5 py-3 min-h-11",
                        "hover:ring-grey-400 cursor-pointer",
                      )}>
                <span className="block text-base font-semibold text-ink-900">{t.label}</span>
                {/* It opens the table: its last line ends in the arrow. */}
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm text-grey-600 tabular">
                    {t.seats === null ? "-" : `${t.seats} seats`}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-grey-400" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        )}

        <AddTables hotelId={hotelId} section={section} run={run} />
      </CardBody>

      {renaming && (
        <NameDialog onClose={() => setRenaming(false)}
                    title={`Rename ${section.name}`} initial={section.name}
                    save={(n) => run(renameSection(hotelId, section.id, n), "Section renamed")} />
      )}

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent
          title={`Take away ${section.name}`}
          description="Its tables leave the Tables screen. Old bills keep their table names, and adding a section of the same name brings it back."
          footer={<>
            <Button variant="secondary" onClick={() => setRemoving(false)}>Cancel</Button>
            <Button variant="primary" disabled={busyTables.length > 0}
                    onClick={async () => {
                      if (await run(takeSectionAway(hotelId, section.id), `${section.name} taken away`)) {
                        setRemoving(false);
                      }
                    }}>
              Take away
            </Button>
          </>}
        >
          <p className="text-sm text-grey-600">
            {busyTables.length
              ? `A bill still sits on ${busyTables.join(", ")}. Settle or clear those tables first.`
              : `${section.name} has no bill on any table.`}
          </p>
        </DialogContent>
      </Dialog>

      {table && (
        <TableDialog hotelId={hotelId} table={table} run={run} onClose={() => setTable(null)} />
      )}
    </Card>
  );
}

function AddTables({ hotelId, section, run }: {
  hotelId: string; section: TillSetup["sections"][number]; run: Run;
}) {
  const [mode, setMode] = useState<"one" | "run">("one");
  const [label, setLabel] = useState("");
  const [prefix, setPrefix] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [seats, setSeats] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    const ok = mode === "one"
      ? await run(addTables(hotelId, section.id, { label }, seats), `${label.trim()} added`)
      : await run(addTables(hotelId, section.id, { prefix, from, to }, seats),
          `${prefix.trim()}${from.trim()} to ${prefix.trim()}${to.trim()} added`);
    if (ok) { setLabel(""); setFrom(""); setTo(""); }
    setBusy(false);
  };
  const ready = mode === "one" ? label.trim() !== "" : from.trim() !== "" && to.trim() !== "";

  return (
    <form className="flex flex-col gap-3 pt-3.5 border-t border-grey-100"
          onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <Segmented value={mode} onChange={setMode} className="self-start"
                 options={[{ value: "one", label: "One table" }, { value: "run", label: "A numbered run" }]} />
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        {mode === "one" ? (
          <Field label="Table" className="sm:w-40">
            {(f) => <Input {...fieldProps(f)} value={label} placeholder="12"
                           onChange={(e) => setLabel(e.target.value)} />}
          </Field>
        ) : (
          <>
            <Field label="Starts with (optional)" className="sm:w-44">
              {(f) => <Input {...fieldProps(f)} value={prefix} placeholder="AC"
                             onChange={(e) => setPrefix(e.target.value)} />}
            </Field>
            <Field label="From" className="sm:w-24">
              {(f) => <Input {...fieldProps(f)} value={from} inputMode="numeric" numeric
                             placeholder="1" onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label="To" className="sm:w-24">
              {(f) => <Input {...fieldProps(f)} value={to} inputMode="numeric" numeric
                             placeholder="10" onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </>
        )}
        <Field label="Seats (optional)" className="sm:w-36">
          {(f) => <Input {...fieldProps(f)} value={seats} inputMode="numeric" numeric
                         onChange={(e) => setSeats(e.target.value)} />}
        </Field>
        <Button type="submit" loading={busy} disabled={!ready}>
          <Plus className="size-4" /> {mode === "one" ? "Add table" : "Add tables"}
        </Button>
      </div>
    </form>
  );
}

function TableDialog({ hotelId, table, run, onClose }: {
  hotelId: string; table: SetupTable; run: Run; onClose: () => void;
}) {
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(table.seats === null ? "" : String(table.seats));
  const [busy, setBusy] = useState(false);
  const act = async (write: Promise<Done>, done: string) => {
    setBusy(true);
    if (await run(write, done)) onClose();
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        size="sm"
        title={`Table ${table.label}`}
        description={table.busy
          ? "A bill sits on this table. It can be renamed; it can be taken away once it is settled or cleared."
          : "Its name as painted on it, and its seats."}
        footer={<>
          <Button variant="secondary" disabled={busy || table.busy}
                  onClick={() => void act(takeTableAway(hotelId, table.id), `${table.label} taken away`)}>
            Take away
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!label.trim()}
                  onClick={() => void act(changeTable(hotelId, table.id, label, seats), "Table saved")}>
            Save
          </Button>
        </>}
      >
        <div className="flex flex-col gap-3">
          <Field label="Table">
            {(f) => <Input {...fieldProps(f)} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label="Seats" hint="Optional - left blank it shows a dash">
            {(f) => <Input {...fieldProps(f)} value={seats} inputMode="numeric" numeric
                           onChange={(e) => setSeats(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ onClose, title, initial, save }: {
  onClose: () => void; title: string; initial: string;
  save: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        size="sm" title={title}
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()}
                  onClick={async () => {
                    setBusy(true);
                    if (await save(name)) onClose();
                    setBusy(false);
                  }}>
            Save
          </Button>
        </>}
      >
        <Field label="Name">
          {(f) => <Input {...fieldProps(f)} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
