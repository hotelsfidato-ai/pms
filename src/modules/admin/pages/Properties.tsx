import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Page, PageHeader, Card, CardBody, StatusPill, Skeleton, ErrorState, Button, Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, toast } from "@/components/ui";
import { listProperties } from "@/data/repositories";
import { useSession } from "@/lib/session";
import {
  listAdminProperties, amendProperty, setPropertyOpen, PROPERTY_TYPES,
  type AdminProperty, type PropertyProfile,
} from "@/modules/admin/data/admin";
import { NewProperty } from "@/modules/admin/flows/StaffAdmin";
import { TestHotelControls, type TestHotelOf } from "@/modules/admin/components/TestHotelControls";
import { plainName } from "@/lib/testHotel";
import { TestTag } from "@/components/app/TestHotel";
import { TaxInUseRows } from "@/modules/admin/components/TaxInUse";
import { placeLine } from "@/modules/finance";

/* Split out of Directory.tsx on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Service: admin. Unchanged. */

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

  /* The session says who is a group admin. The admin list alone cannot:
     it is empty for anybody else AND for a group admin before the first
     property exists - a fresh system (D27-248) - and the form to add one
     must show then above all. */
  const groupAdmin = useSession((s) => s.scope?.isGroupAdmin ?? false);
  const isAdmin = groupAdmin || (admin.data ?? []).length > 0;
  /* TEST HOTELS (the owner's D27-296) are not properties of their own
     here: each is under its real hotel, on that hotel's card, for a group
     administrator. Which hotels are test ones, and whose: GET /api/hotels's
     `testOf` (the session), or the admin list's where it says. */
  const sessionHotels = useSession((s) => s.hotels);
  const scope = useSession((s) => s.scope);
  /* Runs this property: owner, GM or Admin AT it - who the server lets
     open its page (app.manages_hotel, migration 133). */
  const runs = (code: string) => {
    const id = sessionHotels.find((h) => h.code === code)?.id;
    return !!scope?.hotels.some((g) => g.hotelId === id && ["owner", "gm", "admin"].includes(g.role));
  };
  const all = admin.data;
  const testOf = useMemo(() => {
    const byReal = new Map<string, TestHotelOf>();
    for (const h of sessionHotels) {
      if (h.testOf) byReal.set(h.testOf, { code: h.code, name: h.name, id: h.id });
    }
    for (const h of all ?? []) {
      if (h.testOf) byReal.set(h.testOf, { code: h.code, name: h.name, id: h.id });
    }
    return byReal;
  }, [sessionHotels, all]);
  const testCodes = new Set([...testOf.values()].map((t) => t.code));
  const rows = (all ?? []).filter((h) => !testCodes.has(h.code));
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
          {/* Cards 12px apart, sections 20px (the Rhythm Rule). */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((h) => (
              <AdminPropertyCard key={h.id} hotel={h}
                                 onEdit={() => setEditing(h)}
                                 onToggle={() => void toggle(h)}
                                 test={groupAdmin ? { of: testOf.get(h.code) ?? null, onChanged: refresh } : undefined} />
            ))}
          </div>

          {closed.length > 0 && (
            <section className="mt-5">
              <h2 className="text-md font-semibold text-ink-900 mb-3">
                Closed
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(plain.data ?? []).map((p) => (
            <Card key={p.id}>
              <CardBody>
                {/* A test hotel this person also works in, with TEST (D27-296 (9)). */}
                {testCodes.has(p.id) ? (
                  <p className="flex items-center gap-2 text-md font-semibold text-ink-900">
                    {plainName({ name: p.name, testOf: p.id })}<TestTag />
                  </p>
                ) : (
                  <p className="text-md font-semibold text-ink-900">{p.name}</p>
                )}
                <p className="text-sm text-grey-500 mt-0.5">{p.address}</p>
                <dl className="mt-3 border-t border-grey-100 pt-1.5">
                  {/* GET /api/hotels/:code counts app.sellable_rooms today:
                      the rooms less the blocked ones (D27-308). */}
                  <Line label="Rooms sellable today" value={String(p.rooms)} />
                  <Line label="Types" value={p.roomTypes.join(" · ")} />
                  <Line label="Check in / out" value={`${p.checkInTime} / ${p.checkOutTime}`} />
                  {/* ADM-2, D17-37. This printed `p.tax` — the flat CGST +
                      SGST pair migration 067 replaced — as "CGST 2.5% + SGST
                      2.5%" at every property, whatever it charged. */}
                  <TaxInUseRows hotelCode={p.id} row={(label, value, key) => (
                    <Line key={key} label={label} value={value} wrap />
                  )} />
                </dl>
                <div className="flex items-center gap-x-3 flex-wrap mt-2">
                  {/* D27-308 (1e): the property's own page, for whoever runs
                      it - the server's app.manages_hotel. */}
                  {runs(p.id) && (
                    <Link to={`/properties/${p.id}`} className={LINK}>
                      Open
                      <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                  {/* The Calendar (D27-82), not Rooms (D27-308). */}
                  <Link to={`/h/${p.id}/calendar`} className={LINK}>
                    Open the Calendar
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <div className="mt-5">
            <NewProperty onDone={refresh} />
          </div>

          <p className="flex items-start gap-2 text-xs text-grey-500 mt-3 leading-relaxed">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            <span>
              Creating a property makes the hotel and its invoice series; add
              its room types and rooms in Set up this hotel. <strong>The code appears in every URL and every
              invoice number and cannot be changed afterwards.</strong>
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

function AdminPropertyCard({ hotel, onEdit, onToggle, test }: {
  hotel: AdminProperty; onEdit: () => void; onToggle: () => void;
  /** Its test hotel's controls: an open hotel's card, for a group
      administrator only (D27-296 (10)). Absent, none are drawn. */
  test?: { of: TestHotelOf | null; onChanged: () => void };
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
        <p className="text-sm text-grey-500 mt-0.5">
          {placeLine(hotel.addressLine, hotel.city, hotel.state) || "-"}
        </p>

        <dl className="mt-3 border-t border-grey-100 pt-1.5">
          {/* Every active room, blocked or not (D27-308): the other card
              counts today's sellable ones. */}
          <Line label="All rooms" value={hotel.rooms === 0 ? "-" : String(hotel.rooms)} />
          <Line label="Types"
                value={hotel.roomTypes.length ? hotel.roomTypes.join(" · ") : "-"} />
          {/* The GSTIN prints on every invoice this property issues, so
              it belongs where somebody will notice it is wrong. */}
          <Line label="GSTIN" value={hotel.gstin ?? "-"} />
          {/* ADM-2, D17-37: the owner's cards showed no tax at all. The
              same rows as every other card and as Settings, from one
              reader. */}
          <TaxInUseRows hotelCode={hotel.code} row={(label, value, key) => (
            <Line key={key} label={label} value={value} wrap />
          )} />
        </dl>

        {hotel.isActive && hotel.checkedIn > 0 && (
          /* ⚠ SAID BEFORE THE BUTTON IS PRESSED. The server refuses to
             close a property with guests in it, and a refusal a person
             reads only after trying is a refusal they did not need. */
          <p className="text-sm text-grey-500 mt-3">
            {hotel.checkedIn} booking{hotel.checkedIn === 1 ? "" : "s"} checked in
            - it cannot be closed until they check out.
          </p>
        )}

        {/* The links are orange text and the actions capsules (the
            Tappable Rule), under a hairline as the card's rows are. */}
        <div className="flex items-center gap-x-3 gap-y-2 mt-3 pt-3 border-t border-grey-100 flex-wrap">
          {/* ⚠ THE CARD HAD NOWHERE TO GO EXCEPT THE TAPE CHART. The
              property's own numbers and its team now live one click
              away, which is what the owner asked for on 9 September —
              "the property view will show data and statistics about the
              property and will be used to add property staff". */}
          <Link to={`/properties/${hotel.code}`} className={LINK}>
            Open
            <ArrowRight className="size-3.5" />
          </Link>
          {hotel.isActive && (
            <Link to={`/h/${hotel.code}/calendar`} className={LINK}>
              Calendar
            </Link>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onEdit}>Edit</Button>
          <Button variant="secondary"
                  disabled={hotel.isActive && hotel.checkedIn > 0}
                  onClick={onToggle}>
            {hotel.isActive ? "Close" : "Reopen"}
          </Button>
        </div>

        {test && (
          <TestHotelControls real={{ code: hotel.code, name: hotel.name }}
                             test={test.of} onChanged={test.onChanged} />
        )}
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
export function EditPropertyDialog({ hotel, nameLocked = false, onClose, onSaved }: {
  /** With the profile (Settings' Property tab reads it), its fields are
      drawn and saved too. Without (the Properties cards), they are neither
      shown nor sent, so they stay as they are. */
  hotel: Pick<AdminProperty, "code" | "name" | "city" | "state" | "gstin" | "phone" | "email" | "addressLine">
    & Partial<PropertyProfile>;
  /** The name is a group administrator's to change (D27-214, D27-308): a GM
      or Admin sees it, locked. */
  nameLocked?: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const withProfile = hotel.pin !== undefined;
  const [more, setMore] = useState<Record<keyof PropertyProfile, string>>({
    addressLine2: hotel.addressLine2 ?? "", pin: hotel.pin ?? "", website: hotel.website ?? "",
    pan: hotel.pan ?? "", reservationsPhone: hotel.reservationsPhone ?? "",
    propertyType: hotel.propertyType ?? "", starRating: hotel.starRating?.toString() ?? "",
    latitude: hotel.latitude ?? "", longitude: hotel.longitude ?? "",
    reservationsContact: hotel.reservationsContact ?? "",
  });
  const put = (key: keyof PropertyProfile, upper = false) =>
    (e: { target: { value: string } }) =>
      setMore((m) => ({ ...m, [key]: upper ? e.target.value.toUpperCase() : e.target.value }));
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
      ...(withProfile ? more : {}),
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
          <Field label="Name" required
                 {...(nameLocked ? { hint: "A group administrator changes the name." } : {})}>
            {(f) => (
              <Input {...fieldProps(f)} value={name} autoFocus={!nameLocked} disabled={nameLocked}
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
          {withProfile && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address line 2">
                {(f) => <Input {...fieldProps(f)} value={more.addressLine2} onChange={put("addressLine2")} />}
              </Field>
              <Field label="PIN code" hint="Six digits.">
                {(f) => (
                  <Input {...fieldProps(f)} value={more.pin} inputMode="numeric" maxLength={6}
                         className="tabular" onChange={put("pin")} />
                )}
              </Field>
            </div>
          )}
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
          {withProfile && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Property type">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={more.propertyType} onChange={put("propertyType")}>
                      <option value="">Not set</option>
                      {PROPERTY_TYPES.map(([word, label]) => <option key={word} value={word}>{label}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Stars">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={more.starRating} onChange={put("starRating")}>
                      <option value="">Not set</option>
                      {["1", "2", "3", "4", "5"].map((n) => <option key={n} value={n}>{n}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Latitude" hint="The map point: both, or neither.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={more.latitude} inputMode="decimal"
                           className="tabular" onChange={put("latitude")} />
                  )}
                </Field>
                <Field label="Longitude">
                  {(f) => (
                    <Input {...fieldProps(f)} value={more.longitude} inputMode="decimal"
                           className="tabular" onChange={put("longitude")} />
                  )}
                </Field>
              </div>
              <Field label="Reservations contact" hint={'The person a guest asks for. Printed on the booking voucher as "Contact".'}>
                {(f) => (
                  <Input {...fieldProps(f)} value={more.reservationsContact} maxLength={80}
                         onChange={put("reservationsContact")} />
                )}
              </Field>
              {/* Stored, and printed on no document until the owner says where (D27-214). */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Reservations phone" hint="Kept here. It prints on no document.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={more.reservationsPhone} type="tel"
                           onChange={put("reservationsPhone")} />
                  )}
                </Field>
                <Field label="Website" hint="Kept here. It prints on no document.">
                  {(f) => <Input {...fieldProps(f)} value={more.website} onChange={put("website")} />}
                </Field>
              </div>
              <Field label="PAN" hint="Ten characters. Kept here; it prints on no document.">
                {(f) => (
                  <Input {...fieldProps(f)} value={more.pan} maxLength={10} className="tabular"
                         onChange={put("pan", true)} />
                )}
              </Field>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* A card's links: orange text (the Tappable Rule). */
const LINK = "inline-flex items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4";

/* `wrap` for a value that must be read whole. A tax line cut to
   "5% up to ₹7,500 · 18% abo…" hides the rate a room above ₹7,500 is
   charged — found opening the card on 17 September. */
function Line({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm leading-[22px]">
      <span className="text-grey-500 shrink-0">{label}</span>
      <span className={cn(
        "font-medium text-grey-700 tabular text-right min-w-0",
        wrap ? "break-words" : "truncate",
      )}>
        {/* Break between rates, never inside one: "18% above" on one line
            and "₹7,500" on the next reads as two figures. */}
        {wrap
          ? value.split(" · ").map((part, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">{part}</span>
              </span>
            ))
          : value}
      </span>
    </div>
  );
}
