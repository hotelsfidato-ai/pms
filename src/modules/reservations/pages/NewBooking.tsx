import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router";
import { Plus, Trash2, AlertTriangle, ListPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole, useSession } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, fieldProps,
  Input, NativeSelect, Skeleton, toast, Checkbox, Segmented, Term,
} from "@/components/ui";
import { listAllRooms } from "@/data/repositories";
import { getInventory, getTariff, type Tariff } from "@/modules/inventory";
import { createBooking } from "@/modules/reservations/data/groups";
import {
  MARKET_SEGMENTS, TITLES, LIST_KEEPERS, FREEHAND_CAP,
  listSalesPeople, saveSalesPeople, listRoomPromotions, saveRoomPromotions,
} from "@/modules/reservations/data/booking";
import { BookedCard, type Booked } from "@/modules/reservations/flows/BookedCard";
import { KeepListDialog } from "@/modules/reservations/flows/KeepListDialog";
import {
  listCompanies, listBookingSources, ReturningGuest, ConsentTicks,
} from "@/modules/guests";
import { getTaxRate, listBillingCompanies } from "@/modules/finance";
import { assignRoom } from "@/modules/front-desk";

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

   PHASE 1 (D27-33): every field of the owner's Add Reservation screen
   that changes what a booking records, in this layout. The money in it
   (a complimentary room, the discount, the tax) is decided on the
   server; this screen shows what the bill WILL carry - the first night's
   price for every night, as the night audit posts it (the owner, 27 Sep)
   - with the tax from finance's tax card, the audit's own rounding.
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
  /* D17-50, 17 September (migration 105). */
  { code: "AI", name: "All inclusive" },
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
  /** ₹0 and nothing posted (020). The owner, an administrator or the GM. */
  comp: boolean;
  /** A room number, picked now for a one-room line; empty is "later". */
  room: string;
}

/** What one line will cost, as the bill will carry it. */
interface Quote {
  /** The nightly rate the booking keeps, after the discount. Null while it
      is being priced, or when it cannot be (see `unpriced`). */
  nightly: number | null;
  unpriced: string | null;
  /** The calendar's later nights are not the first night's price. */
  differs: boolean;
  /** The tax card's rate for that nightly figure: null where no rule is
      set, undefined while it is being asked. */
  taxRate: number | null | undefined;
  /** round(nightly x rate / 100, 2), the night audit's own sum. */
  taxPerNight: number | null;
}

const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`))
    / 86_400_000);

/* In whole paise, so a half rounds up as Postgres rounds it. The server's
   figure is the one kept; these only show it before it exists. */
const paise = (rupees: number) => Math.round(rupees * 100);
const afterDiscount = (rate: number, pct: number) =>
  Math.round(paise(rate) * (100 - pct) / 100) / 100;
const taxOn = (nightly: number, pct: number) =>
  Math.round(paise(nightly) * pct / 100) / 100;

const OTHER = "__other";

export default function NewBookingPage() {
  const hotelId = useHotel();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useRole();
  const keeper = (LIST_KEEPERS as readonly string[]).includes(role);
  const hotel = useSession((s) => s.hotels.find((h) => h.code === hotelId) ?? null);

  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  /* The returning guest the clerk confirmed (D21-20), and the two ticks the
     desk asks on a phone booking (D21-72, D21-22). Typing the phone or the
     email again clears the choice: it was made about what was typed. */
  const [returning, setReturning] = useState<{ id: string; name: string } | null>(null);
  const [whatsapp, setWhatsapp] = useState(false);
  const [offersAgreed, setOffersAgreed] = useState(false);
  /* Where they live and where they are from (plan § 3 rows 22-29). The
     nationality tells the desk a foreigner's form is due at check-in. */
  const [nationality, setNationality] = useState("IN");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("");
  /* ⚠ TWO QUESTIONS, TWO FIELDS, because the database has always asked
     two and this form asked one.

       the CHANNEL   how it reached us — Agoda, walk-in, our own site.
                     `reservations.booking_source_id`, required.
       the ACCOUNT   who sent it — a company, an agent, a planner.
                     `reservations.business_source`, optional.

     The channel is REQUIRED — the owner's decision on 8 September. An
     unrecorded channel is a lead nobody can trace back, and it cannot
     be filled in afterwards. */
  const [bookingSourceId, setBookingSourceId] = useState("");
  const [businessSource, setBusinessSource] = useState("");
  const [marketSegment, setMarketSegment] = useState("");
  const [salesPick, setSalesPick] = useState("");
  const [salesOther, setSalesOther] = useState("");
  const [billTo, setBillTo] = useState<"guest" | "company">("guest");
  const [companyId, setCompanyId] = useState("");
  /* Waiting for the hotel holds the room and sends the guest nothing until
     somebody confirms it (D27-35). */
  const [waiting, setWaiting] = useState(false);
  /* The hours they said they would arrive and leave. Blank is the ordinary
     case and stays blank — a form that demanded an hour would get a
     made-up one, and somebody would then hold a room against it. */
  const [expected, setExpected] = useState("");
  const [expectedOut, setExpectedOut] = useState("");
  const [groupName, setGroupName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [discountMode, setDiscountMode] = useState<"none" | "hand" | "promotion">("none");
  const [discountPct, setDiscountPct] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [promotionId, setPromotionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(1);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [keeping, setKeeping] = useState<"sales" | "promotions" | null>(null);

  /* Every channel this group books through. Switched-off sources are
     filtered out here rather than in the query: they stay readable on old
     bookings and stop being offered on new ones. */
  const channels = useQuery({
    queryKey: ["booking-sources", hotelId],
    queryFn: () => listBookingSources(hotelId),
  });
  /* The corporate accounts and agents the property invoices. A different
     question from the channel. */
  const accounts = useQuery({
    queryKey: ["companies", hotelId],
    queryFn: () => listCompanies(hotelId),
  });
  /* Real companies, with their ids: who a bill can be addressed to. */
  const billable = useQuery({
    queryKey: ["billing-companies", hotelId],
    queryFn: () => listBillingCompanies(hotelId),
    enabled: billTo === "company",
  });
  const salesPeople = useQuery({
    queryKey: ["sales-people", hotelId],
    queryFn: () => listSalesPeople(hotelId),
  });
  const promotions = useQuery({
    queryKey: ["room-promotions", hotelId],
    queryFn: () => listRoomPromotions(hotelId),
  });
  const rooms = useQuery({
    queryKey: ["rooms", hotelId],
    queryFn: () => listAllRooms(hotelId),
  });

  /* The inventory answers two things at once: which room types exist,
     with their ids, and how many are left on the chosen nights. */
  const inventory = useQuery({
    queryKey: ["inventory", hotelId, from, to],
    queryFn: () => getInventory(hotelId, from ?? undefined, to ?? undefined),
  });

  /* The hotel's operating day, not the browser's clock — a property whose
     audit has not run is still on yesterday. */
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    if (!from && inventory.data) {
      setToday(inventory.data.from);
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

  /* ── The discount in force ─────────────────────────────────────── */
  const promotion = (promotions.data ?? []).find((p) => p.id === promotionId) ?? null;
  const handPct = Number(discountPct);
  const pct = discountMode === "hand" && Number.isFinite(handPct) && handPct > 0
    ? handPct
    : discountMode === "promotion" && promotion ? promotion.percent : 0;
  const discountProblem =
    discountMode === "hand" && discountPct.trim() !== ""
      ? !(handPct > 0) ? "A discount is a percentage above 0."
        : handPct > FREEHAND_CAP
          ? `Over ${FREEHAND_CAP}% only through a named promotion.`
          : !discountReason.trim() ? "Say why the discount is given." : null
      : discountMode === "promotion" && !promotion ? "Choose the promotion." : null;

  /* ── What each line will cost ──────────────────────────────────── */
  const tariffs = useQueries({
    queries: lines.map((l) => ({
      queryKey: ["tariff", hotelId, l.roomTypeId, l.mealPlan, from, to, l.adults, l.children],
      queryFn: () => getTariff(hotelId, {
        roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
        from: from ?? "", to: to ?? "", adults: l.adults, children: l.children,
      }),
      enabled: !!from && !!to && !l.comp && l.rate.trim() === "",
    })),
  });

  const priced = lines.map((l, i): Omit<Quote, "taxRate" | "taxPerNight"> => {
    if (l.comp) return { nightly: 0, unpriced: null, differs: false };
    if (l.rate.trim() !== "") {
      const typed = Number(l.rate);
      return { nightly: typed > 0 ? afterDiscount(typed, pct) : typed, unpriced: null, differs: false };
    }
    const t: Tariff | null | undefined = tariffs[i]?.data;
    if (!t) return { nightly: null, unpriced: null, differs: false };
    /* THE FIRST NIGHT'S PRICE IS THE ONE KEPT, for every night (book.ts).
       A later night the calendar prices differently - or not at all - is
       said beside the line, not added in. */
    const first = t.nights[0]?.total ?? null;
    if (first === null) {
      return { nightly: null, unpriced: t.nights[0]?.unpriced ?? t.unpriced ?? "this party", differs: false };
    }
    return {
      nightly: afterDiscount(first, pct),
      unpriced: null,
      differs: t.nights.some((n) => n.total !== first),
    };
  });

  const taxes = useQueries({
    queries: priced.map((p) => ({
      queryKey: ["tax-rate", hotelId, "room", p.nightly],
      queryFn: () => getTaxRate(hotelId, "room", p.nightly ?? 0),
      enabled: p.nightly !== null && p.nightly > 0,
    })),
  });

  const quotes: Quote[] = priced.map((p, i) => {
    const taxRate = p.nightly === 0 ? 0 : taxes[i]?.data?.rate;
    return {
      ...p,
      taxRate,
      taxPerNight: p.nightly === null || taxRate === null || taxRate === undefined
        ? null : taxOn(p.nightly, taxRate),
    };
  });

  const addLine = () => {
    const first = types[0];
    if (!first) return;
    setLines((ls) => [...ls, {
      key: nextKey, roomTypeId: first.id, mealPlan: "EP",
      adults: 2, children: 0, rooms: 1, rate: "", comp: false, room: "",
    }]);
    setNextKey((k) => k + 1);
  };

  const totalRooms = lines.reduce((n, l) => n + l.rooms, 0);
  const salesPerson = salesPick === OTHER ? salesOther.trim() : salesPick;
  /* Book and check in: one room, arriving on the hotel's own today, and
     confirmed - a waiting booking cannot be checked in. */
  const mayCheckInNow = from === today && totalRooms === 1 && !waiting;

  const reset = () => {
    setBooked(null);
    setTitle(""); setGuestName(""); setPhone(""); setEmail(""); setReturning(null);
    setWhatsapp(false); setOffersAgreed(false); setNationality("IN");
    setAddressLine(""); setCity(""); setStateName(""); setPincode(""); setCountry("");
    setBookingSourceId(""); setBusinessSource(""); setMarketSegment("");
    setSalesPick(""); setSalesOther(""); setBillTo("guest"); setCompanyId("");
    setWaiting(false); setExpected(""); setExpectedOut(""); setGroupName("");
    setLines([]); setDiscountMode("none"); setDiscountPct(""); setDiscountReason("");
    setPromotionId("");
  };

  const submit = async (checkInNow: boolean) => {
    if (!from || !to) return;
    setSaving(true);
    const res = await createBooking(hotelId, {
      guestName: guestName.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      bookingSourceId,
      ...(businessSource ? { businessSource } : {}),
      ...(marketSegment ? { marketSegment } : {}),
      ...(salesPerson ? { salesPerson } : {}),
      ...(expected ? { expectedArrival: expected } : {}),
      ...(expectedOut ? { expectedDeparture: expectedOut } : {}),
      checkIn: from, checkOut: to,
      ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
      ...(returning ? { guestId: returning.id } : {}),
      whatsappAgreed: whatsapp,
      offersAgreed,
      tentative: waiting,
      ...(billTo === "company" && companyId ? { companyId } : {}),
      ...(discountMode === "hand" && discountPct.trim()
        ? { discount: { percent: handPct, reason: discountReason.trim() } } : {}),
      ...(discountMode === "promotion" && promotionId
        ? { discount: { promotionId } } : {}),
      ...(title ? { title } : {}),
      ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
      address: {
        addressLine: addressLine.trim(), city: city.trim(), state: stateName.trim(),
        pincode: pincode.trim(), country: country.trim(),
      },
      lines: lines.map((l) => ({
        roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
        adults: l.adults, children: l.children, rooms: l.rooms,
        ...(l.comp ? { complimentary: true } : {}),
        ...(l.comp || l.rate.trim() === "" ? {} : { agreedRate: Number(l.rate) }),
      })),
    });

    if (!res.ok) {
      setSaving(false);
      /* The server's sentence. It names the unpriced party, the room type
         that cannot sleep them, or the rule a gift or a discount broke. */
      return toast.error("Not booked", res.reason);
    }

    /* A ROOM PICKED NOW goes through front desk's own door, the one the
       tape chart's Assign room uses: the same refusals, in its words. The
       booking stands either way; a room it could not have is said on the
       Booked card, to be assigned from Arrivals. */
    const assigned: Booked["assigned"] = {};
    let at = 0;
    for (const l of lines) {
      const made = res.bookings[at];
      if (l.rooms === 1 && l.room && !waiting && made?.id) {
        const a = await assignRoom(hotelId, made.id, l.room);
        assigned[made.reference] = a.ok ? { room: a.room } : { failed: a.reason };
      }
      at += l.rooms;
    }
    setSaving(false);
    void qc.invalidateQueries();

    const lead = res.bookings[0]?.id;
    if (checkInNow && lead) {
      /* THROUGH FRONT DESK'S CHECK-IN, not a copy of it: the ID, the
         foreigner's form and the early-arrival rule all live there. */
      toast.success("Booked", "Check them in from their booking.");
      navigate(`/h/${hotelId}/arrivals?res=${lead}`);
      return;
    }
    setBooked({
      guest: res.guest, groupId: res.groupId, bookings: res.bookings,
      waiting, assigned, arrivesToday: from === today,
    });
  };

  if (inventory.isLoading || !from || !to) {
    return (
      <Page>
        <PageHeader title="New booking" description="Loading…" />
        <Skeleton className="h-80" />
      </Page>
    );
  }

  if (booked) {
    return (
      <Page>
        <PageHeader title="New booking"
          description="One guest, one set of nights, as many rooms as they need." />
        <BookedCard hotelId={hotelId} booked={booked} onAnother={reset} />
      </Page>
    );
  }

  const blocked = saving || !guestName.trim() || lines.length === 0
    || !bookingSourceId || discountProblem !== null
    || (billTo === "company" && !companyId)
    || (salesPick === OTHER && !salesOther.trim());

  return (
    <Page>
      <PageHeader
        title="New booking"
        description="One guest, one set of nights, as many rooms as they need."
      />

      {/* Cards 12px apart (the Rhythm Rule); the booking's summary beside
          them on a desk, under them on a phone. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Card>
            <CardHeader title="Who" />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <Field label="Title">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="h-12 text-base">
                      <option value="">None</option>
                      {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Guest or company" required>
                  {(f) => (
                    <Input {...fieldProps(f)} value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Sharma family" className="h-12 text-base" />
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  {(f) => (
                    <Input {...fieldProps(f)} value={phone} type="tel"
                      onChange={(e) => { setPhone(e.target.value); setReturning(null); }}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="Email">
                  {(f) => (
                    <Input {...fieldProps(f)} value={email} type="email"
                      onChange={(e) => { setEmail(e.target.value); setReturning(null); }}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>

              <ReturningGuest hotelId={hotelId} phone={phone} email={email}
                chosen={returning} onChoose={setReturning} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Address">
                  {(f) => (
                    <Input {...fieldProps(f)} value={addressLine}
                      onChange={(e) => setAddressLine(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="City">
                  {(f) => (
                    <Input {...fieldProps(f)} value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <Field label="State">
                  {(f) => (
                    <Input {...fieldProps(f)} value={stateName}
                      onChange={(e) => setStateName(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="PIN code">
                  {(f) => (
                    <Input {...fieldProps(f)} value={pincode} inputMode="numeric"
                      onChange={(e) => setPincode(e.target.value)}
                      className="h-12 text-base tabular" />
                  )}
                </Field>
                <Field label="Country">
                  {(f) => (
                    <Input {...fieldProps(f)} value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="Nationality" hint="Two letters: IN for India.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={nationality} maxLength={2}
                      onChange={(e) => setNationality(e.target.value.toUpperCase())}
                      className="h-12 text-base uppercase" />
                  )}
                </Field>
              </div>
              {/^[A-Z]{2}$/.test(nationality) && nationality !== "IN" && (
                <p className="text-sm text-warning-dark">
                  A foreign guest: their <Term name="formC" /> is due at check-in.
                </p>
              )}

              <ConsentTicks whatsapp={whatsapp} onWhatsapp={setWhatsapp}
                offersAgreed={offersAgreed} onOffersAgreed={setOffersAgreed} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="When" />
            <CardBody className="space-y-4">
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
                <Field label="Expected check-in"
                       hint={`If they said. The hotel's check-in is ${hotel?.checkInTime ?? "-"}.`}>
                  {(f) => (
                    <Input {...fieldProps(f)} type="time" value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
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
                <Field label="Expected check-out"
                       hint={`If they said. The hotel's check-out is ${hotel?.checkOutTime ?? "-"}.`}>
                  {(f) => (
                    <Input {...fieldProps(f)} type="time" value={expectedOut}
                      onChange={(e) => setExpectedOut(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="How it came, and who pays" />
            <CardBody className="space-y-4">
              <Field label="The booking"
                     hint={waiting
                       ? "Waiting holds the room and sends the guest nothing until it is confirmed."
                       : "Confirmed: the guest's voucher can go."}>
                {() => (
                  <Segmented value={waiting ? "waiting" : "confirmed"}
                    onChange={(v) => setWaiting(v === "waiting")}
                    options={[
                      { value: "confirmed", label: "Confirmed" },
                      { value: "waiting", label: "Waiting for the hotel" },
                    ]} />
                )}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Booking source" required
                       hint="How it reached us. It cannot be filled in later.">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={bookingSourceId}
                      onChange={(e) => setBookingSourceId(e.target.value)}
                      className="h-12 text-base">
                      {/* ⚠ THE BLANK STAYS, AND IT IS NOT AN ANSWER. It
                          is here so nothing is pre-selected — a list
                          that opens on "Agoda" gets Agoda on bookings
                          that came from anywhere. Confirm is disabled
                          until something is chosen, and the server
                          refuses it too. */}
                      <option value="">Choose one…</option>
                      {(channels.data ?? [])
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </NativeSelect>
                  )}
                </Field>
                {/* ⚠ THE SECOND QUESTION, and it IS optional. Most
                    bookings have no account behind them. */}
                <Field label="Business source"
                       hint="The account or agent behind it, if there is one.">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={businessSource}
                      onChange={(e) => setBusinessSource(e.target.value)}
                      className="h-12 text-base">
                      <option value="">None</option>
                      {(accounts.data ?? []).map((cmp) => (
                        <option key={cmp.id} value={cmp.name}>{cmp.name}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Blank is "unknown", never "Other" - the walk-in's rule. */}
                <Field label="Market segment">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={marketSegment}
                      onChange={(e) => setMarketSegment(e.target.value)}
                      className="h-12 text-base">
                      <option value="">-</option>
                      {MARKET_SEGMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Sales person">
                  {(f) => (
                    <div className="flex gap-2">
                      <NativeSelect {...fieldProps(f)} value={salesPick}
                        onChange={(e) => setSalesPick(e.target.value)}
                        className="h-12 text-base flex-1 min-w-0">
                        <option value="">None</option>
                        {(salesPeople.data ?? []).map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                        <option value={OTHER}>Other…</option>
                      </NativeSelect>
                      {keeper && (
                        <Button variant="secondary" className="h-12 w-12 p-0 shrink-0"
                          aria-label="Change the sales people list"
                          onClick={() => setKeeping("sales")}>
                          <ListPlus className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </Field>
              </div>
              {salesPick === OTHER && (
                <Field label="Sales person's name" required>
                  {(f) => (
                    <Input {...fieldProps(f)} value={salesOther}
                      onChange={(e) => setSalesOther(e.target.value)}
                      className="h-12 text-base" />
                  )}
                </Field>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bill to">
                  {() => (
                    <Segmented value={billTo} onChange={setBillTo}
                      options={[
                        { value: "guest", label: "Guest" },
                        { value: "company", label: "Company" },
                      ]} />
                  )}
                </Field>
                {billTo === "company" && (
                  <Field label="Company" required>
                    {(f) => (
                      <NativeSelect {...fieldProps(f)} value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        className="h-12 text-base">
                        <option value="">Choose one…</option>
                        {(billable.data ?? []).map((cmp) => (
                          <option key={cmp.id} value={cmp.id}>{cmp.name}</option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              </div>
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
              {/* Each room a section of this card, a hairline between -
                  never a box inside the card. */}
              {lines.length > 0 && (
              <div className="divide-y divide-grey-100">
              {lines.map((line, i) => (
                <RoomLine
                  key={line.key}
                  line={line}
                  quote={quotes[i]!}
                  pricing={tariffs[i]?.isLoading ?? false}
                  nights={nights}
                  types={types}
                  left={leftFor(line.roomTypeId)}
                  mayGive={keeper}
                  waiting={waiting}
                  rooms={(rooms.data ?? []).filter((r) =>
                    r.type === types.find((t) => t.id === line.roomTypeId)?.name
                    && r.status !== "out-of-service").map((r) => r.number)}
                  onChange={(next) => setLines((ls) =>
                    ls.map((l) => (l.key === line.key ? next : l)))}
                  onRemove={() => setLines((ls) =>
                    ls.filter((l) => l.key !== line.key))}
                />
              ))}
              </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Summary
          nights={nights} lines={lines} quotes={quotes} types={types}
          discount={
            <Discount
              mode={discountMode} onMode={setDiscountMode}
              pct={discountPct} onPct={setDiscountPct}
              reason={discountReason} onReason={setDiscountReason}
              promotionId={promotionId} onPromotion={setPromotionId}
              promotions={promotions.data ?? []}
              keeper={keeper} onKeep={() => setKeeping("promotions")}
              problem={discountProblem}
            />
          }
          /* ⚠ AND THE CHANNEL. Greyed out here so a clerk is not sent to
             the server to be told; refused there too, because a browser
             that has not reloaded still posts. Rule 6 both ends. */
          disabled={blocked}
          checkInNow={mayCheckInNow}
          waiting={waiting}
          onSubmit={(now) => void submit(now)}
        />
      </div>

      <KeepListDialog
        open={keeping === "sales"} onOpenChange={(o) => setKeeping(o ? "sales" : null)}
        title="Sales people"
        description="One list for every hotel of the group. A name taken off stays on the bookings that have it."
        items={(salesPeople.data ?? []).map((p) => ({ name: p.name }))}
        onSave={async (items) => {
          const r = await saveSalesPeople(hotelId, items.map((i) => i.name));
          if (r.ok) void qc.invalidateQueries({ queryKey: ["sales-people", hotelId] });
          return r;
        }}
      />
      <KeepListDialog
        open={keeping === "promotions"} onOpenChange={(o) => setKeeping(o ? "promotions" : null)}
        title="Room promotions"
        description={`This hotel's named discounts. Over ${FREEHAND_CAP}% a discount is only ever one of these.`}
        withPercent
        items={(promotions.data ?? []).map((p) => ({ name: p.name, percent: p.percent }))}
        onSave={async (items) => {
          const r = await saveRoomPromotions(hotelId,
            items.map((i) => ({ name: i.name, percent: i.percent ?? 0 })));
          if (r.ok) void qc.invalidateQueries({ queryKey: ["room-promotions", hotelId] });
          return r;
        }}
      />
    </Page>
  );
}

/* ── One line ─────────────────────────────────────────────────────
   The price sits beside the room, live, because the question a clerk
   is answering on the phone is "what will that cost" and walking to a
   different screen to find out loses the guest. */
function RoomLine({
  line, quote, pricing, nights, types, left, mayGive, waiting, rooms, onChange, onRemove,
}: {
  line: Line;
  quote: Quote;
  pricing: boolean;
  nights: number;
  types: { id: string; name: string }[];
  left: number | null;
  mayGive: boolean;
  waiting: boolean;
  rooms: string[];
  onChange: (l: Line) => void;
  onRemove: () => void;
}) {
  const over = left !== null && line.rooms > left;

  return (
    <div className="py-3.5 first:pt-0 last:pb-0 space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
        <NativeSelect
          value={line.roomTypeId} aria-label="Room type"
          onChange={(e) => onChange({ ...line, roomTypeId: e.target.value, room: "" })}
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
                 onChange={(n) => onChange({ ...line, rooms: n, room: n === 1 ? line.room : "" })} />
        <Counter label="Adults" value={line.adults} min={1}
                 onChange={(adults) => onChange({ ...line, adults })} />
        <Counter label="Children" value={line.children} min={0}
                 onChange={(children) => onChange({ ...line, children })} />
        <Field label="Rate" hint={line.comp ? "Complimentary." : "Empty uses the calendar."}>
          {(f) => (
            <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
              value={line.comp ? "" : line.rate} placeholder="-" disabled={line.comp}
              onChange={(e) => onChange({ ...line, rate: e.target.value })}
              className="h-12 text-base tabular" />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Checkbox
          checked={line.comp}
          disabled={!mayGive}
          onCheckedChange={(comp) => onChange({ ...line, comp })}
          label={mayGive ? "Complimentary" : "Complimentary (owner, admin or GM only)"}
        />
        {line.rooms === 1 && !waiting && (
          <NativeSelect
            value={line.room} aria-label="Room"
            onChange={(e) => onChange({ ...line, room: e.target.value })}
            className="h-10 text-sm w-auto"
          >
            <option value="">Room: assign later</option>
            {rooms.map((n) => <option key={n} value={n}>Room {n}</option>)}
          </NativeSelect>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {/* Availability, reported. A reservation is for a room TYPE, and
            deliberate overbooking is something every hotel does. */}
        <span className={cn(over ? "text-warning-dark font-medium" : "text-grey-600")}>
          {left === null ? "-" : `${left} left`}
          {over && " · this books more than that"}
        </span>
        {left !== null && left > 1 && line.rooms !== left && (
          <Button variant="ghost" size="sm"
                  onClick={() => onChange({ ...line, rooms: left, room: "" })}>
            All {left} left
          </Button>
        )}
        <LinePrice line={line} quote={quote} pricing={pricing} nights={nights} />
      </div>
    </div>
  );
}

function LinePrice({ line, quote, pricing, nights }: {
  line: Line; quote: Quote; pricing: boolean; nights: number;
}) {
  if (line.comp) {
    return <span className="text-grey-600">Complimentary: no charge, nothing posted</span>;
  }
  if (quote.unpriced) {
    /* The whole point. A number here that quietly charged for two would
       not be discovered until check-out. */
    return (
      <span className="flex items-center gap-1.5 text-warning-dark font-medium">
        <AlertTriangle className="size-3.5" />
        No price for {quote.unpriced}
      </span>
    );
  }
  if (quote.nightly === null) {
    return <span className="text-grey-500">{pricing ? "Pricing…" : "-"}</span>;
  }
  return (
    <span className="text-grey-600">
      {moneyPrecise(quote.nightly)} a night
      {" + "}
      {quote.taxPerNight === null ? "-" : moneyPrecise(quote.taxPerNight)} tax
      {quote.taxRate !== null && quote.taxRate !== undefined && ` (${quote.taxRate}%)`}
      {line.rate.trim() !== "" && ", agreed"}
      {nights > 0 && ` · ${nights} ${nights === 1 ? "night" : "nights"}`}
      {quote.differs && (
        <span className="block text-warning-dark">
          The first night's price is kept for every night; the calendar differs later.
        </span>
      )}
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

/* ── The discount (D27-36) ─────────────────────────────────────────
   The restaurant's rule: up to the cap by hand, with a reason; more only
   through a named promotion. The server decides; this says the rule
   before the clerk meets its refusal. */
function Discount({
  mode, onMode, pct, onPct, reason, onReason, promotionId, onPromotion,
  promotions, keeper, onKeep, problem,
}: {
  mode: "none" | "hand" | "promotion"; onMode: (m: "none" | "hand" | "promotion") => void;
  pct: string; onPct: (v: string) => void;
  reason: string; onReason: (v: string) => void;
  promotionId: string; onPromotion: (v: string) => void;
  promotions: { id: string; name: string; percent: number }[];
  keeper: boolean; onKeep: () => void;
  problem: string | null;
}) {
  return (
    <div className="space-y-2">
      <Field label="Discount">
        {() => (
          <Segmented value={mode} onChange={onMode}
            options={[
              { value: "none", label: "None" },
              { value: "hand", label: `Up to ${FREEHAND_CAP}%` },
              { value: "promotion", label: "Promotion" },
            ]} />
        )}
      </Field>
      {mode === "hand" && (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
          <Input type="number" inputMode="decimal" min={0} max={FREEHAND_CAP}
            aria-label="Discount percent" placeholder="%"
            value={pct} onChange={(e) => onPct(e.target.value)}
            className="h-11 text-base tabular" />
          <Input aria-label="Why" placeholder="Why"
            value={reason} onChange={(e) => onReason(e.target.value)}
            className="h-11 text-base" />
        </div>
      )}
      {mode === "promotion" && (
        <div className="flex gap-2">
          <NativeSelect value={promotionId} aria-label="Promotion"
            onChange={(e) => onPromotion(e.target.value)}
            className="h-11 text-base flex-1 min-w-0">
            <option value="">{promotions.length ? "Choose one…" : "No promotions yet"}</option>
            {promotions.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.percent}%)</option>
            ))}
          </NativeSelect>
          {keeper && (
            <Button variant="secondary" className="h-11 w-11 p-0 shrink-0"
              aria-label="Change the promotions list" onClick={onKeep}>
              <ListPlus className="size-4" />
            </Button>
          )}
        </div>
      )}
      {problem && <p className="text-sm text-warning-dark">{problem}</p>}
    </div>
  );
}

/* ── The summary ──────────────────────────────────────────────────
   It refuses to show a total it cannot stand behind. The figures are
   what the bill will carry (finance's app.stay_bill: charges, their tax,
   minus what was paid - nothing, at booking). */
function Summary({
  nights, lines, quotes, types, discount, disabled, checkInNow, waiting, onSubmit,
}: {
  nights: number; lines: Line[]; quotes: Quote[];
  types: { id: string; name: string }[];
  discount: ReactNode;
  disabled: boolean; checkInNow: boolean; waiting: boolean;
  onSubmit: (checkInNow: boolean) => void;
}) {
  const rooms = lines.reduce((n, l) => n + l.rooms, 0);
  /* A DASH BEFORE ANY ROOM IS ADDED, and while any part is unpriced or its
     tax unknown. `reduce` over an empty list gives 0, and ₹0 on this card
     reads as "this booking is free". */
  const priced = lines.length > 0 && quotes.every((q) => q.nightly !== null);
  const taxed = priced && quotes.every((q) => q.taxPerNight !== null);
  const sum = (each: (q: Quote, l: Line) => number) =>
    lines.reduce((p, l, i) => p + paise(each(quotes[i]!, l)) * l.rooms * nights, 0) / 100;
  const charges = priced ? sum((q) => q.nightly ?? 0) : null;
  const tax = taxed ? sum((q) => q.taxPerNight ?? 0) : null;
  const due = charges !== null && tax !== null ? charges + tax : null;
  const unpriced = quotes.filter((q) => q.unpriced).map((q) => q.unpriced);
  const noRule = priced && !taxed && quotes.some((q) => q.taxRate === null);

  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader title="The booking" />
      <CardBody className="space-y-3">
        <dl className="divide-y divide-grey-200">
          <Row label="Nights" value={String(nights)} />
          <Row label="Rooms" value={String(rooms)} />
        </dl>

        {lines.length > 0 && (
          <ul className="text-sm text-grey-600 space-y-1">
            {lines.map((l, i) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="truncate">
                  {l.rooms} ×{" "}
                  {types.find((t) => t.id === l.roomTypeId)?.name ?? "-"}
                  {l.comp && ", complimentary"}
                </span>
                <span className="tabular shrink-0">
                  {quotes[i]?.nightly === null || quotes[i]?.nightly === undefined
                    ? "-" : money(quotes[i]!.nightly! * nights * l.rooms)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-3 border-t border-grey-200">{discount}</div>

        <dl className="pt-3 border-t border-grey-200 divide-y divide-grey-200">
          <Row label="Room charges" value={charges === null ? "-" : moneyPrecise(charges)} />
          <Row label="Taxes" value={tax === null ? "-" : moneyPrecise(tax)} />
          <div className="flex items-baseline justify-between py-2">
            <dt className="text-base font-medium text-ink-900">Due</dt>
            <dd className={cn("text-2xl font-semibold tabular", due === null && "text-grey-500")}>
              {due === null ? "-" : moneyPrecise(due)}
            </dd>
          </div>
        </dl>
        {lines.length === 0 ? (
          <p className="text-sm text-grey-500">Add a room and the figures appear here.</p>
        ) : unpriced.length > 0 ? (
          /* A total that omitted the unpriced part would be short by
             exactly the amount nobody checks. */
          <p className="text-sm text-warning-dark">
            No price for {unpriced.join(", ")}. Set it on the rate calendar,
            or type a rate on the line.
          </p>
        ) : noRule ? (
          <p className="text-sm text-warning-dark">
            The tax card has no rule for this rate. Set it before the night audit posts it.
          </p>
        ) : (
          <p className="text-sm text-grey-500">
            As the bill will carry it. Nothing is paid at booking.
          </p>
        )}

        <Button variant="primary" className="h-12 w-full text-base"
                disabled={disabled} onClick={() => onSubmit(false)}>
          {waiting ? "Hold it, waiting for the hotel" : "Confirm the booking"}
        </Button>
        {checkInNow && (
          <Button variant="secondary" className="h-12 w-full text-base"
                  disabled={disabled} onClick={() => onSubmit(true)}>
            Book and check in
          </Button>
        )}
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
