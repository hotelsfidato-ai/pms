import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { AlertTriangle, ArrowRight, Bell, Building2, Info, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort, relative } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill, Skeleton,
  Avatar, ErrorState, Button, Dialog, DialogContent, Field, fieldProps,
  Input, toast, EmptyState, type Column, type Tone,
} from "@/components/ui";
import {
  listGuests, listCompanies, listProperties, notificationsRepo,
  listRoomTypes, listRatePlans,
  listAdminProperties, amendProperty, setPropertyOpen,
  type GuestRecord, type CompanyRecord, type RoomTypeRecord, type RatePlanRecord,
  type AdminProperty,
} from "@/data/repositories";
import { NewProperty } from "@/components/flows/StaffAdmin";

/* ══════════════════════════════════════════════════════════════════
   GUESTS · COMPANIES · PROPERTIES · NOTIFICATIONS
   ROOM TYPES · RATE PLANS

   All derived. A guest is not a separate record in Stage 1 — it is
   what you get when you group stays by name, and duplicates are shown
   rather than silently merged, because the merge rules are not
   decided and a wrong merge is far harder to undo than a visible one.
   ══════════════════════════════════════════════════════════════════ */

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Guests ──────────────────────────────────────────────────────── */

const GUEST_COLUMNS: Column<GuestRecord>[] = [
  {
    key: "name", header: "Guest",
    cell: (g) => (
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar name={g.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate">{g.name}</p>
          {g.possibleDuplicate && (
            <p className="text-2xs text-brand-yellow flex items-center gap-1 mt-0.5">
              <AlertTriangle className="size-3" />
              overlapping stays
            </p>
          )}
        </div>
      </div>
    ),
  },
  { key: "stays", header: "Stays", numeric: true, cell: (g) => <span className="tabular">{g.stays}</span> },
  { key: "nights", header: "Nights", numeric: true, hideBelow: "sm", cell: (g) => <span className="tabular">{g.nights}</span> },
  {
    key: "last", header: "Last stay", hideBelow: "md",
    cell: (g) => (
      <div>
        <p className="tabular text-grey-600">
          {g.lastStay ? dateShort(g.lastStay) : <span className="text-grey-400">first visit</span>}
        </p>
        {g.nextStay && (
          <p className="text-2xs text-info tabular mt-0.5">back {dateShort(g.nextStay)}</p>
        )}
      </div>
    ),
  },
  {
    key: "sources", header: "Booked via", hideBelow: "lg",
    cell: (g) => <span className="text-grey-600 truncate">{g.sources.join(", ")}</span>,
  },
  { key: "spend", header: "Total spend", numeric: true, cell: (g) => <span className="tabular">{money(g.totalSpend)}</span> },
  {
    key: "balance", header: "Balance", numeric: true,
    cell: (g) => (
      <span className={cn("tabular font-medium", g.openBalance > 0 ? "text-brand-red" : g.openBalance < 0 ? "text-info" : "text-grey-400")}>
        {g.openBalance === 0 ? "—" : money(Math.abs(g.openBalance))}
      </span>
    ),
  },
];

export function GuestsPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["guests", hotelId],
    queryFn: () => listGuests(hotelId),
  });

  const dupes = (data ?? []).filter((g) => g.possibleDuplicate);

  return (
    <Page>
      <PageHeader
        title="Guests"
        description="Grouped by name from every stay. Repeat guests rise to the top."
        badge={data ? <StatusPill tone="neutral">{data.length} guests</StatusPill> : undefined}
      />

      {dupes.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-brand-yellow-100 bg-brand-yellow-50 p-3.5 mb-4">
          <AlertTriangle className="size-4 text-brand-yellow shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-900">
              {dupes.length} name{dupes.length === 1 ? " has" : "s have"} stays that overlap
            </p>
            <p className="text-sm text-grey-600 mt-0.5">
              One person cannot be in two rooms on the same night, so either these are
              two people sharing a name or something was entered twice. Shown, not
              merged — a wrong merge is far harder to undo than a visible duplicate.
            </p>
          </div>
        </div>
      )}

      <Card>
        <DataTable<GuestRecord>
          rows={data ?? []}
          columns={GUEST_COLUMNS}
          rowKey={(g) => g.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={
            <EmptyState compact icon={<Users />} title="No guests yet"
              description="A guest is added here the first time they are booked." />
          }
        />
      </Card>
    </Page>
  );
}

/* ── Booking sources ─────────────────────────────────────────────
   CALLED "COMPANIES" UNTIL SOMEBODY LOOKED AT IT. In hotel software a
   company is a corporate account — a firm that books rooms for its own
   staff and settles monthly on the city ledger. This screen is not that.
   It is where the business came FROM: Agoda, Expedia, Booking.com,
   go-MMT, the walk-in, the property's own site.

   The data was always right; `kind` has carried OTA / Direct /
   Corporate from the start. The NAME was wrong, and a wrong name on a
   screen is not cosmetic — it is what somebody looking for their OTA
   performance reads and moves past.

   GROUPED BY CHANNEL, because the question this screen exists to
   answer is "which OTA sent what", and that cannot be read off a list
   sorted by revenue with the channels interleaved.
   ──────────────────────────────────────────────────────────────── */

const KIND_TONE: Record<CompanyRecord["kind"], Tone> = {
  OTA: "accent",
  Direct: "info",
  Corporate: "neutral",
};

/* Order matters: OTAs first, because they are the ones with a
   commission against them and the ones somebody is checking. */
const KIND_ORDER: CompanyRecord["kind"][] = ["OTA", "Direct", "Corporate"];

const KIND_COPY: Record<CompanyRecord["kind"], { title: string; blurb: string }> = {
  OTA: {
    title: "Travel agents",
    blurb: "Booked through a channel, and charged a commission for it.",
  },
  Direct: {
    title: "Direct",
    blurb: "Straight to the property. No commission on any of it.",
  },
  Corporate: {
    title: "Corporate accounts",
    blurb: "A firm booking for its own people, settled on the city ledger.",
  },
};

const SOURCE_COLUMNS: Column<CompanyRecord>[] = [
  { key: "name", header: "Source", cell: (c) => <span className="font-medium">{c.name}</span> },
  { key: "bookings", header: "Bookings", numeric: true, cell: (c) => <span className="tabular">{c.bookings}</span> },
  { key: "nights", header: "Room nights", numeric: true, hideBelow: "sm", cell: (c) => <span className="tabular">{c.roomNights}</span> },
  { key: "revenue", header: "Revenue", numeric: true, cell: (c) => <span className="tabular">{money(c.revenue)}</span> },
  {
    key: "commission", header: "Commission", numeric: true, hideBelow: "lg",
    cell: (c) => <span className="text-grey-400">{c.commissionPct === null ? "—" : `${c.commissionPct}%`}</span>,
  },
  {
    key: "balance", header: "Owed", numeric: true,
    cell: (c) => (
      <span className={cn("tabular font-medium", c.openBalance > 0 ? "text-brand-red" : c.openBalance < 0 ? "text-info" : "text-grey-400")}>
        {c.openBalance === 0 ? "—" : money(Math.abs(c.openBalance))}
      </span>
    ),
  },
];

export function CompaniesPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["companies", hotelId],
    queryFn: () => listCompanies(hotelId),
  });

  const rows = data ?? [];
  const groups = KIND_ORDER
    .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  const sum = (rs: CompanyRecord[], f: (r: CompanyRecord) => number) =>
    rs.reduce((n, r) => n + f(r), 0);

  const otaRevenue = sum(rows.filter((r) => r.kind === "OTA"), (r) => r.revenue);
  const directRevenue = sum(rows.filter((r) => r.kind === "Direct"), (r) => r.revenue);
  const total = otaRevenue + directRevenue
    + sum(rows.filter((r) => r.kind === "Corporate"), (r) => r.revenue);

  return (
    <Page>
      <PageHeader
        title="Booking sources"
        description="Where the business came from, and what each channel is worth."
      />

      {/* THE SPLIT, before the detail. "How much of this did we pay
          commission on" is the first question, and reading it off six
          rows of a table is arithmetic somebody should not have to do.
          Percentages are of revenue that HAS a source; nothing is
          invented when the list is empty. */}
      {!isLoading && !error && total > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Through an agent</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(otaRevenue)}
              </p>
              <p className="text-sm text-grey-500 mt-0.5 tabular">
                {Math.round((otaRevenue / total) * 100)}% of the revenue
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Direct</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(directRevenue)}
              </p>
              <p className="text-sm text-grey-500 mt-0.5 tabular">
                {Math.round((directRevenue / total) * 100)}% of the revenue
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-grey-500">Owed to the property</p>
              <p className="text-xl font-semibold tabular text-ink-900 mt-1">
                {money(sum(rows, (r) => Math.max(r.openBalance, 0)))}
              </p>
              <p className="text-sm text-grey-500 mt-0.5">
                Across every source that owes anything
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {error || isLoading || groups.length === 0 ? (
        <Card>
          <DataTable<CompanyRecord>
            rows={rows}
            columns={SOURCE_COLUMNS}
            rowKey={(c) => c.id}
            loading={isLoading}
            error={error}
            onRetry={() => refetch()}
            empty={
              <EmptyState compact icon={<Building2 />} title="No bookings yet"
                description="Each company, agent and booking site shows here once a booking comes through it." />
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.kind}>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-2.5">
                <h2 className="text-md font-semibold text-ink-900">
                  {KIND_COPY[g.kind].title}
                </h2>
                <StatusPill tone={KIND_TONE[g.kind]}>{g.rows.length}</StatusPill>
                <span className="text-sm text-grey-500">
                  {KIND_COPY[g.kind].blurb}
                </span>
                <span className="ml-auto text-sm text-grey-600 tabular">
                  {money(sum(g.rows, (r) => r.revenue))}
                  {" · "}
                  {sum(g.rows, (r) => r.bookings)} bookings
                </span>
              </div>
              <Card>
                <DataTable<CompanyRecord>
                  rows={g.rows}
                  columns={SOURCE_COLUMNS}
                  rowKey={(c) => c.id}
                />
              </Card>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        Commission is charged outside this system today and prints as a dash rather
        than a zero. It fills when the channel bridge lands at Stage 9.
      </p>
    </Page>
  );
}

/* ── Properties ──────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
   PROPERTIES — one screen, and it can now change something

   ⚠ THERE WERE TWO OF THESE. `/properties` listed them and offered
   nothing; `/admin/properties` had the create form and a shorter list.
   Two screens for one noun is how they drift, and the one in the
   navigation was the one that could do least.

   ⚠ AND SIX OF THE CARDS WERE FICTION. This screen drew six dashed
   "Property 2 — awaiting confirmation" placeholders, hardcoded. That
   was honest when nothing could create a property. Since the create
   form landed it has been a screen telling you six properties are
   pending while standing next to the button that would add them.
   `listProperties()` is the truth; a constant six is not.

   WHAT A GROUP ADMIN SEES IS DIFFERENT, AND FROM A DIFFERENT SOURCE.
   `/api/hotels` ends `where is_active`, so a closed property is
   invisible to it — including to the Reopen button. The admin list
   returns every property with its editable details; everyone else
   gets the ordinary cards. One card component, two sources, and the
   sets they cover cannot overlap.
   ══════════════════════════════════════════════════════════════════ */
export function PropertiesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminProperty | null>(null);

  const plain = useQuery({
    queryKey: ["properties"], queryFn: listProperties,
  });
  /* Empty for anybody who is not a group admin — the repository
     swallows the refusal rather than turning it into an error state.
     A clerk is not being blocked; they are seeing the ordinary
     screen. */
  const admin = useQuery({
    queryKey: ["admin-properties"], queryFn: listAdminProperties,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["properties"] });
    void qc.invalidateQueries({ queryKey: ["admin-properties"] });
  };

  const isAdmin = (admin.data ?? []).length > 0;
  const rows = admin.data ?? [];
  const open = rows.filter((h) => h.isActive);
  const closed = rows.filter((h) => !h.isActive);

  const toggle = async (h: AdminProperty) => {
    const res = await setPropertyOpen(h.code, !h.isActive);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(h.isActive ? `${h.name} is closed` : `${h.name} is open`);
    refresh();
  };

  return (
    <Page>
      <PageHeader
        title="Properties"
        description={
          isAdmin
            ? `${open.length} open${closed.length ? ` · ${closed.length} closed` : ""}`
            : "The properties you can reach."
        }
      />

      {plain.error && !isAdmin ? (
        <Card>
          <ErrorState
            title="The property list did not load"
            description="Nothing was changed. Try again."
            error={plain.error}
            onRetry={() => plain.refetch()}
          />
        </Card>
      ) : plain.isLoading && admin.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isAdmin ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((h) => (
              <AdminPropertyCard key={h.id} hotel={h}
                                 onEdit={() => setEditing(h)}
                                 onToggle={() => void toggle(h)} />
            ))}
          </div>

          {closed.length > 0 && (
            <section className="mt-6">
              <h2 className="text-2xs font-semibold uppercase tracking-wide text-grey-400 mb-2.5">
                Closed
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {closed.map((h) => (
                  <AdminPropertyCard key={h.id} hotel={h}
                                     onEdit={() => setEditing(h)}
                                     onToggle={() => void toggle(h)} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(plain.data ?? []).map((p) => (
            <Card key={p.id}>
              <CardBody>
                <p className="text-md font-semibold text-ink-900">{p.name}</p>
                <p className="text-sm text-grey-500 mt-1">{p.address}</p>
                <dl className="mt-3 space-y-1">
                  <Line label="Rooms" value={String(p.rooms)} />
                  <Line label="Types" value={p.roomTypes.join(" · ")} />
                  <Line label="Check in / out" value={`${p.checkInTime} / ${p.checkOutTime}`} />
                  <Line label="Tax" value={`CGST ${p.tax.cgst}% + SGST ${p.tax.sgst}%`} />
                </dl>
                <Link
                  to={`/h/${p.id}/stay`}
                  className="inline-flex items-center gap-1.5 text-sm text-brand-orange hover:underline mt-3.5"
                >
                  Open stay view
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <div className="mt-6">
            <NewProperty onDone={refresh} />
          </div>

          <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Creating a property mints its rooms, its invoice series and its
              folio namespace — <strong>the code appears in every URL and
              every invoice number and cannot be changed afterwards.</strong>
            </span>
          </p>
        </>
      )}

      {editing && (
        <EditPropertyDialog hotel={editing} onClose={() => setEditing(null)}
                            onSaved={refresh} />
      )}
    </Page>
  );
}

function AdminPropertyCard({ hotel, onEdit, onToggle }: {
  hotel: AdminProperty; onEdit: () => void; onToggle: () => void;
}) {
  return (
    <Card className={cn(!hotel.isActive && "opacity-60")}>
      <CardBody>
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-md font-semibold text-ink-900">{hotel.name}</p>
          <span className="tabular text-sm text-grey-500">{hotel.code}</span>
          {!hotel.isActive && (
            <StatusPill tone="neutral">Closed</StatusPill>
          )}
        </div>
        <p className="text-sm text-grey-500 mt-1">
          {[hotel.addressLine, hotel.city, hotel.state]
            .filter(Boolean).join(", ") || "—"}
        </p>

        <dl className="mt-3 space-y-1">
          <Line label="Rooms" value={hotel.rooms === 0 ? "—" : String(hotel.rooms)} />
          <Line label="Types"
                value={hotel.roomTypes.length ? hotel.roomTypes.join(" · ") : "—"} />
          {/* The GSTIN prints on every invoice this property issues, so
              it belongs where somebody will notice it is wrong. */}
          <Line label="GSTIN" value={hotel.gstin ?? "—"} />
        </dl>

        {hotel.isActive && hotel.checkedIn > 0 && (
          /* ⚠ SAID BEFORE THE BUTTON IS PRESSED. The server refuses to
             close a property with guests in it, and a refusal a person
             reads only after trying is a refusal they did not need. */
          <p className="text-sm text-grey-500 mt-2.5">
            {hotel.checkedIn} guest{hotel.checkedIn === 1 ? "" : "s"} in house
            — it cannot be closed until they check out.
          </p>
        )}

        <div className="flex items-center gap-2 mt-3.5 flex-wrap">
          {/* ⚠ THE CARD HAD NOWHERE TO GO EXCEPT THE TAPE CHART. The
              property's own numbers and its team now live one click
              away, which is what the owner asked for on 9 September —
              "the property view will show data and statistics about the
              property and will be used to add property staff". */}
          <Link
            to={`/properties/${hotel.code}`}
            className="inline-flex items-center gap-1.5 text-sm text-brand-orange hover:underline"
          >
            Open
            <ArrowRight className="size-3.5" />
          </Link>
          {hotel.isActive && (
            <Link
              to={`/h/${hotel.code}/stay`}
              className="inline-flex items-center gap-1.5 text-sm text-grey-600 hover:underline"
            >
              Stay view
            </Link>
          )}
          <div className="flex-1" />
          <Button variant="ghost" className="h-11" onClick={onEdit}>Edit</Button>
          <Button variant="secondary" className="h-11"
                  disabled={hotel.isActive && hotel.checkedIn > 0}
                  onClick={onToggle}>
            {hotel.isActive ? "Close" : "Reopen"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── A property's own details ──────────────────────────────────────
   ⚠ THE CODE IS NOT HERE. It is in every URL this property has ever
   appeared in and every invoice number it has ever issued, and the
   endpoint refuses to change it for that reason. Showing a greyed-out
   box says so better than leaving it out.
   ═══════════════════════════════════════════════════════════════════ */
function EditPropertyDialog({ hotel, onClose, onSaved }: {
  hotel: AdminProperty; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(hotel.name);
  const [city, setCity] = useState(hotel.city ?? "");
  const [state, setState] = useState(hotel.state ?? "");
  const [gstin, setGstin] = useState(hotel.gstin ?? "");
  const [phone, setPhone] = useState(hotel.phone ?? "");
  const [email, setEmail] = useState(hotel.email ?? "");
  const [line, setLine] = useState(hotel.addressLine ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await amendProperty(hotel.code, {
      name: name.trim(), city: city.trim(), state: state.trim(),
      gstin: gstin.trim(), phone: phone.trim(), email: email.trim(),
      addressLine: line.trim(),
    });
    setBusy(false);
    /* The server's sentence. It is the one that knows what a GSTIN has
       to look like, and it explains why it cares. */
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success(`${name.trim()} saved`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Edit ${hotel.name}`}
        description="These print on this property's invoices."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!name.trim()}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Code"
                 hint="In every URL and every invoice number. It cannot be changed.">
            {(f) => (
              <Input {...fieldProps(f)} value={hotel.code} disabled
                     className="tabular" />
            )}
          </Field>
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} autoFocus
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              {(f) => (
                <Input {...fieldProps(f)} value={city}
                       onChange={(e) => setCity(e.target.value)} />
              )}
            </Field>
            <Field label="State">
              {(f) => (
                <Input {...fieldProps(f)} value={state}
                       onChange={(e) => setState(e.target.value)} />
              )}
            </Field>
          </div>
          <Field label="Address">
            {(f) => (
              <Input {...fieldProps(f)} value={line}
                     onChange={(e) => setLine(e.target.value)} />
            )}
          </Field>
          <Field label="GSTIN"
                 hint="Fifteen characters, the two-digit state code first. It prints on every invoice.">
            {(f) => (
              <Input {...fieldProps(f)} value={gstin} className="tabular"
                     onChange={(e) => setGstin(e.target.value.toUpperCase())} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone">
              {(f) => (
                <Input {...fieldProps(f)} value={phone} type="tel"
                       onChange={(e) => setPhone(e.target.value)} />
              )}
            </Field>
            <Field label="Email">
              {(f) => (
                <Input {...fieldProps(f)} value={email} type="email"
                       onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Notifications ───────────────────────────────────────────────── */

const NOTE_TONE: Record<string, Tone> = {
  approval: "warning",
  reservation: "info",
  payment: "danger",
  automation: "accent",
  customer: "info",
  system: "neutral",
};

export function NotificationsPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", hotelId],
    queryFn: () => notificationsRepo.list(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Notifications"
        description="Derived, never stored — so nothing here can go stale while the thing it describes changes."
        badge={data ? <StatusPill tone={data.length ? "warning" : "success"}>{data.length}</StatusPill> : undefined}
      />
      {error ? (
        <Card>
          <ErrorState
            title="Could not work out what needs attention"
            description="These are derived from the day's stays and postings. Nothing is lost — try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (data ?? []).length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10">
              <Bell className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">Nothing needs attention</p>
              <p className="text-base text-grey-500 mt-1.5">
                No arrivals outstanding, no balances carrying into departure, no refunds due.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {(data ?? []).map((n) => (
            <Card key={n.id}>
              <CardBody className="flex items-start gap-3">
                <StatusPill tone={NOTE_TONE[n.category] ?? "neutral"} dot>
                  {n.category}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-ink-900">{n.title}</p>
                  <p className="text-sm text-grey-600 mt-0.5">{n.body}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xs text-grey-400 tabular">{relative(n.at)}</p>
                  {n.link && (
                    <Link to={n.link} className="text-sm text-brand-orange hover:underline">
                      Open
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ── Room types ──────────────────────────────────────────────────── */

const TYPE_COLUMNS: Column<RoomTypeRecord>[] = [
  { key: "type", header: "Room type", cell: (t) => <span className="font-medium">{t.type}</span> },
  { key: "rooms", header: "Rooms", numeric: true, cell: (t) => <span className="tabular">{t.rooms}</span> },
  {
    key: "sellable", header: "Sellable", numeric: true,
    cell: (t) => (
      <span className={cn("tabular", t.sellable < t.rooms && "text-brand-yellow font-medium")}>
        {t.sellable}
      </span>
    ),
  },
  { key: "occ", header: "Max occupancy", numeric: true, hideBelow: "sm", cell: (t) => <span className="tabular">{t.maxOccupancy}</span> },
  { key: "rack", header: "Rack rate", numeric: true, cell: (t) => <span className="tabular">{money(t.rackRate)}</span> },
  {
    key: "numbers", header: "Room numbers", hideBelow: "lg",
    cell: (t) => <span className="tabular text-grey-600 text-sm">{t.numbers.join(", ")}</span>,
  },
];

export function RoomTypesPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["room-types", hotelId],
    queryFn: () => listRoomTypes(hotelId),
  });

  const held = (data ?? []).reduce((t, r) => t + (r.rooms - r.sellable), 0);

  return (
    <Page>
      <PageHeader
        title="Room types"
        description="What the property sells, and how much of it is actually sellable today."
      />
      <Card>
        <DataTable<RoomTypeRecord>
          rows={data ?? []}
          columns={TYPE_COLUMNS}
          rowKey={(t) => t.type}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      {held > 0 && (
        <p className="text-xs text-grey-500 mt-4 leading-relaxed">
          {held} room{held === 1 ? " is" : "s are"} held out of service, which is why
          the sellable house is smaller than the physical one. Occupancy divides by the
          sellable count, never the physical one.
        </p>
      )}
    </Page>
  );
}

/* ── Rate plans ──────────────────────────────────────────────────── */

const PLAN_COLUMNS: Column<RatePlanRecord>[] = [
  { key: "code", header: "Code", width: "w-[110px]", cell: (p) => <span className="tabular font-medium">{p.code}</span> },
  { key: "name", header: "Plan", cell: (p) => p.name },
  { key: "includes", header: "Includes", cell: (p) => <span className="text-grey-600">{p.includes}</span> },
  {
    key: "seen", header: "In the live system", hideBelow: "md",
    cell: (p) => p.seenAs ? <span className="tabular text-grey-600">{p.seenAs}</span> : <span className="text-grey-400">—</span>,
  },
];

export function RatePlansPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["rate-plans"], queryFn: listRatePlans });

  return (
    <Page>
      <PageHeader
        title="Rate plans"
        description="What a rate includes. Taken from the plans the live system actually uses."
      />
      <Card>
        <DataTable<RatePlanRecord>
          rows={data ?? []}
          columns={PLAN_COLUMNS}
          rowKey={(p) => p.code}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        The live Night Audit shows plans as <span className="tabular">Deluxe CP</span> —
        room type and meal plan together. A published rate calendar arrives at Stage 9;
        until then the rack rate is what a room type carries.
      </p>
    </Page>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-grey-500">{label}</span>
      <span className="text-ink-900 tabular text-right min-w-0 truncate">{value}</span>
    </div>
  );
}
