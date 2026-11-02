import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { Plus, Trash2, AlertTriangle, ListPlus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useCurrentHotel, useRole, useSession } from "@/lib/session";
import { payingWays } from "@/lib/rules";
import { emailProblem, gstinProblem, phoneProblem } from "../../../../api/src/validate.ts";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, fieldProps,
  Input, NativeSelect, Skeleton, toast, Checkbox, Segmented, Switch, Textarea,
} from "@/components/ui";
import { listAllRooms, getModules } from "@/data/repositories";
import { getInventory, getTariff, type Tariff } from "@/modules/inventory";
import { createBooking } from "@/modules/reservations/data/groups";
import { listOf } from "@/modules/front-desk";
import {
  MARKET_SEGMENTS, TITLES, LIST_KEEPERS, FREEHAND_CAP,
  listSalesPeople, saveSalesPeople, listRoomPromotions,
} from "@/modules/reservations/data/booking";
import { fetchLeadForBooking } from "@/modules/leads";
import { BookedCard, type Booked } from "@/modules/reservations/flows/BookedCard";
import { KeepListDialog } from "@/modules/reservations/flows/KeepListDialog";
import {
  listCompanies, listBookingSources, ReturningGuest,
  GuestIdFields, guestIdState, guestIdPayload, deskGuestId, type GuestId,
} from "@/modules/guests";
import { getRateBeforeGst, getTaxRate, listBillingCompanies, settle } from "@/modules/finance";
import { getContractTariff, listCompanyRecords, type ContractTariff } from "@/modules/contracts";
import { can } from "@/lib/permissions";
import { assignRoom, assignableRooms, checkIn, earlyArrival } from "@/modules/front-desk";

/* ══════════════════════════════════════════════════════════════════
   ONE PAGE FOR BOOKING, GIVING A ROOM AND CHECKING IN (D27-158, D27-163)

   The owner, 29 September: guest, dates, room type, rate, room number
   (optional), ID and advance on one page, and three buttons at the bottom
   - "Save booking", "Save and assign room", "Check in now". A walk-in is
   this page opened from an empty room: that room, today, one night, the
   Walk-in source. Company (with its GSTIN) and Notes fold open, each
   switched on or off per hotel in Settings (159, on until turned off).
   Extras left the page (D27-187): they are added on the booking later.
   The owner's standing rule from now: nothing takes more than two pages
   or three clicks.

   A SCREEN CHANGE: every button uses a door that already exists, with
   every rule it holds. Save = the booking call (then a picked room through
   front desk's assign, D27-163: a picked room is kept). Check in now =
   the booking call, then front desk's own check-in (the room, the ID, Form
   III, the early-arrival reason). The advance = the bill's payment door,
   held as the guest's credit (D27-4), taken before the check-in (D27-328). When
   a later door refuses, the booking stands and the Booked card says which
   step and why.

   THE SUMMARY IS LIVE AND IT IS ALLOWED TO SAY "I DON'T KNOW". If the room
   type has no price for the party, the total is a refusal naming it, never
   a number that quietly charges for two. What the bill will carry is the
   first night's price for every night, as the night audit posts it (27
   Sep). AVAILABILITY IS SHOWN, NOT ENFORCED: the clerk decides.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

/* The code with its words, as every screen says it (the owner's D27-164). */
const PLANS = [
  { code: "EP", name: "EP · Room only" },
  { code: "CP", name: "CP · Room + breakfast" },
  { code: "MAP", name: "MAP · Room + breakfast + one meal" },
  { code: "AP", name: "AP · Room + all meals" },
  /* D17-50, 17 September (migration 105). */
  { code: "AI", name: "AI · Everything charged to the room" },
];


interface Line {
  key: number;
  roomTypeId: string;
  mealPlan: string;
  adults: number;
  children: number;
  rooms: number;
  /** Empty means "use the calendar". A number is a rate somebody agreed. */
  rate: string;
  /** D27-195: the typed rate includes GST; split before it is kept. Off by default. */
  inclusive: boolean;
  /** ₹0 and nothing posted (020). The owner, an administrator or the GM. */
  comp: boolean;
  /** A room number for a one-room line; empty is "later". */
  room: string;
}

/** What one line will cost, as the bill will carry it. */
interface Quote {
  nightly: number | null;
  unpriced: string | null;
  differs: boolean;
  /** The company's contract in force on arrival (D27-184), and, where it has
      no figure for this line, the sentence saying the day's price applies. */
  contract?: string | null;
  note?: string | null;
  taxRate: number | null | undefined;
  taxPerNight: number | null;
}

const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/* In whole paise, so a half rounds up as Postgres rounds it. */
const paise = (rupees: number) => Math.round(rupees * 100);
const afterDiscount = (rate: number, pct: number) =>
  Math.round(paise(rate) * (100 - pct) / 100) / 100;
const taxOn = (nightly: number, pct: number) =>
  Math.round(paise(nightly) * pct / 100) / 100;

const OTHER = "__other";
const ROOM_STATE: Record<string, string> = {
  clean: "clean", inspected: "inspected", dirty: "needs cleaning",
};

export default function BookingPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const role = useRole();
  const keeper = (LIST_KEEPERS as readonly string[]).includes(role);
  const hotel = useSession((s) => s.hotels.find((h) => h.code === hotelId) ?? null);
  /* Opened from an empty room on Rooms or the Calendar: that room and night.
     Tonight's is a walk-in; a later night's, a booking of that room. */
  const [search] = useSearchParams();
  const walkRoom = search.get("room");
  const walkDate = search.get("date");
  /* "Book this lead" (D27-170): the leads view opens this page with a token. */
  const leadToken = search.get("lead");
  const [campaign, setCampaign] = useState("");

  /* The hotel's defaults (the owner's D27-243 3.1, 3.6): the title, the ID
     and the way an advance is paid start on them. */
  const rules = useCurrentHotel()?.deskRules;
  const [title, setTitle] = useState(rules?.defaultTitle ?? "");
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [returning, setReturning] = useState<{ id: string; name: string } | null>(null);
  /* The guest's own company (D27-371), all optional: with a GSTIN the tax
     invoice is addressed to it, and the guest still pays. */
  const [companyName, setCompanyName] = useState("");
  const [companyGstin, setCompanyGstin] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  /* D27-392: Normal guest or Company guest (GST registered); a company guest
     needs the company's name and GSTIN. */
  const [companyGuest, setCompanyGuest] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [offersAgreed, setOffersAgreed] = useState(false);
  /* A safety practice, not a demographic note: placed away from stairwells
     and service corridors, never announced at the desk. */
  const [singleLady, setSingleLady] = useState(false);
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [country, setCountry] = useState("");
  const [guestId, setGuestId] = useState<GuestId>(() => deskGuestId(rules));
  /* ⚠ TWO QUESTIONS, TWO FIELDS: the CHANNEL (how it reached us, required -
     the owner, 8 September - and nothing pre-chosen except a walk-in's) and
     the ACCOUNT behind it (optional). */
  const [bookingSourceId, setBookingSourceId] = useState("");
  /* D27-246: a booking site's booking is prepaid there unless the desk
     unticks it (the guest pays at the hotel). */
  const [prepaid, setPrepaid] = useState(true);
  /* Null until picked: a company guest's is then that company (D27-392). */
  const [businessSource, setBusinessSource] = useState<string | null>(null);
  const [marketSegment, setMarketSegment] = useState("");
  const [salesPick, setSalesPick] = useState("");
  const [salesOther, setSalesOther] = useState("");
  /* The hotel's defaults (192, the owner's D27-260 Q1). */
  const [billTo, setBillTo] = useState<"guest" | "company">(rules?.defaultBillTo ?? "guest");
  const [companyId, setCompanyId] = useState("");
  /* OVER THE COMPANY'S CREDIT LIMIT (D27-275): the server's sentence, and
     which button was pressed; the owner, an administrator or the GM may
     allow it with a reason. */
  const [overLimit, setOverLimit] = useState<{ reason: string; now: boolean } | null>(null);
  const [allowReason, setAllowReason] = useState("");
  /* Waiting for the hotel holds the room and sends nothing (D27-35). */
  const [waiting, setWaiting] = useState(rules?.defaultGuarantee === "tentative");
  const [expected, setExpected] = useState("");
  const [expectedOut, setExpectedOut] = useState("");
  const [groupName, setGroupName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [discountMode, setDiscountMode] = useState<"none" | "hand" | "rupees" | "promotion">("none");
  const [discountPct, setDiscountPct] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [promotionId, setPromotionId] = useState("");
  const [notes, setNotes] = useState("");
  const [specialRequest, setSpecialRequest] = useState("");
  const [advance, setAdvance] = useState("");
  const [advanceBy, setAdvanceBy] = useState(rules?.defaultPaymentMethod ?? "Cash");
  const [earlyReason, setEarlyReason] = useState("");
  const [waiveEarly, setWaiveEarly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(1);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [keeping, setKeeping] = useState<"sales" | null>(null);

  const lead = useQuery({
    queryKey: ["lead-for-booking", hotelId, leadToken],
    queryFn: () => fetchLeadForBooking(hotelId, leadToken ?? ""),
    enabled: !!leadToken,
    staleTime: Infinity,
    /* A 404 is an answer (expired or erased), not a hiccup to retry. */
    retry: false,
  });
  /* The lead's name, phone, channel and campaign, once. A lead expired or
     erased (404) leaves the page blank, with its sentence above. */
  const [leadTaken, setLeadTaken] = useState(false);
  useEffect(() => {
    if (leadTaken || !lead.data) return;
    setGuestName(lead.data.name ?? "");
    setPhone(lead.data.phone ?? "");
    if (lead.data.bookingSourceId) setBookingSourceId(lead.data.bookingSourceId);
    setCampaign(lead.data.campaign ?? "");
    setLeadTaken(true);
  }, [lead.data, leadTaken]);

  const channels = useQuery({
    queryKey: ["booking-sources", hotelId],
    queryFn: () => listBookingSources(hotelId),
  });
  const segments = useQuery({
    queryKey: ["lists", hotelId, "market_segment"],
    queryFn: () => listOf(hotelId, "market_segment"),
  });
  const siteSource = (channels.data ?? []).find((s) => s.id === bookingSourceId)?.kind === "ota";
  const accounts = useQuery({
    queryKey: ["companies", hotelId],
    queryFn: () => listCompanies(hotelId),
  });
  /* The Settings switches (159). Unreadable is not off: {} shows them all. */
  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
  });
  const show = {
    company: modules.data?.["booking_company"] !== false,
    notes: modules.data?.["booking_notes"] !== false,
  };
  /* D27-392: Companies and agents, for the GSTIN typed and Business source. */
  const companyList = useQuery({
    queryKey: ["company-records", hotelId],
    queryFn: () => listCompanyRecords(hotelId),
    enabled: show.company,
  });
  const gstinTyped = companyGstin.trim().length === 15 && !gstinProblem(companyGstin);
  const byGstin = gstinTyped
    ? companyList.data?.find((c) => c.gstin?.toUpperCase() === companyGstin.trim()) : undefined;
  const byName = companyList.data?.find((c) => c.name.trim().toLowerCase() === companyName.trim().toLowerCase());
  const sourceChosen = businessSource ?? companyName.trim();
  const billable = useQuery({
    queryKey: ["billing-companies", hotelId],
    queryFn: () => listBillingCompanies(hotelId),
    enabled: show.company && billTo === "company",
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
  const inventory = useQuery({
    queryKey: ["inventory", hotelId, from, to],
    queryFn: () => getInventory(hotelId, from ?? undefined, to ?? undefined),
  });

  /* The hotel's operating day, not the browser's clock. */
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    if (!from && inventory.data) {
      const start = walkDate ?? inventory.data.from;
      setToday(inventory.data.from);
      setFrom(start);
      setTo(addDays(start, 1));
    }
  }, [from, inventory.data, walkDate]);

  const types = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const c of inventory.data?.cells ?? []) {
      if (!seen.has(c.roomTypeId)) seen.set(c.roomTypeId, { id: c.roomTypeId, name: c.roomType });
    }
    return [...seen.values()];
  }, [inventory.data]);

  const newLine = (roomTypeId: string, key: number, room = ""): Line => ({
    key, roomTypeId, mealPlan: "EP", adults: 2, children: 0, rooms: 1, rate: "", inclusive: false, comp: false, room,
  });

  /* THE FIRST ROOM IS ALREADY THERE - one click fewer than "Add". A walk-in's
     is the room it was opened from, and its channel the Walk-in source. */
  useEffect(() => {
    if (seeded || types.length === 0 || !today) return;
    if (walkRoom) {
      if (!rooms.data || !channels.data) return;
      const type = types.find((t) => t.name === rooms.data.find((r) => r.number === walkRoom)?.type);
      setLines([newLine(type?.id ?? types[0]!.id, 0, type ? walkRoom : "")]);
      /* The Walk-in source only for tonight (D27-163): a later night's
         booking came some other way, and nothing else is pre-chosen. */
      const walkIn = channels.data.find((s) => s.kind === "walk_in" && s.isActive);
      if (walkIn && walkDate === today) setBookingSourceId(walkIn.id);
    } else {
      setLines([newLine(types[0]!.id, 0)]);
    }
    setSeeded(true);
  }, [seeded, types, today, walkRoom, walkDate, rooms.data, channels.data]);

  const isWalkIn = !!walkRoom && walkDate === today;

  const leftFor = (roomTypeId: string) => {
    const cells = (inventory.data?.cells ?? []).filter((c) => c.roomTypeId === roomTypeId
      && c.date >= (from ?? "") && c.date < (to ?? ""));
    if (cells.length === 0) return null;
    return Math.min(...cells.map((c) => c.available));
  };

  const nights = from && to ? nightsBetween(from, to) : 0;
  /* A DAY USE (the owner's D27-227, D27-229): out the day it comes. Its price
     is typed on every booking - the night's tariff is never asked for it. */
  const dayUse = !!from && from === to;

  /* ── The discount in force ─────────────────────────────────────── */
  const promotion = (promotions.data ?? []).find((p) => p.id === promotionId) ?? null;
  const handPct = Number(discountPct);
  const pct = discountMode === "hand" && Number.isFinite(handPct) && handPct > 0
    ? handPct
    : discountMode === "promotion" && promotion ? promotion.percent ?? 0 : 0;
  /* ₹ OFF EACH NIGHT (191, the owner's D27-259 Q4): by hand up to the cap's
     share of the night with a reason, or a promotion in rupees. */
  const rupeesOff = discountMode === "rupees" && handPct > 0 ? handPct
    : discountMode === "promotion" && promotion ? promotion.amount ?? 0 : 0;
  const discounted = (rate: number) => Math.max(0, afterDiscount(rate, pct) - rupeesOff);
  const discountProblem =
    discountMode === "rupees" && discountPct.trim() !== ""
      ? !(handPct > 0) ? "A discount in rupees is above ₹0."
        : !discountReason.trim() ? "Say why the discount is given." : null
    : discountMode === "hand" && discountPct.trim() !== ""
      ? !(handPct > 0) ? "A discount is a percentage above 0."
        : handPct > FREEHAND_CAP
          ? `Over ${FREEHAND_CAP}% only through a named promotion.`
          : !discountReason.trim() ? "Say why the discount is given." : null
      : discountMode === "promotion" && !promotion ? "Choose the promotion." : null;

  /* ── What each line will cost ──────────────────────────────────── */
  /* A company named on the booking prices it by its contract in force on
     arrival (D27-184); with none, the same calendar price, asked there. */
  const contractOf = show.company && billTo === "company" ? companyId : "";
  const tariffs = useQueries({
    queries: lines.map((l) => ({
      queryKey: ["tariff", hotelId, l.roomTypeId, l.mealPlan, from, to, l.adults, l.children, contractOf],
      queryFn: (): Promise<Tariff | ContractTariff | null> => {
        const input = { roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
          from: from ?? "", to: to ?? "", adults: l.adults, children: l.children };
        return contractOf ? getContractTariff(hotelId, { ...input, companyId: contractOf })
          : getTariff(hotelId, input);
      },
      /* Never for a day use (D27-229): its price is typed, the contract's too. */
      enabled: !!from && !!to && !dayUse && !l.comp && l.rate.trim() === "",
    })),
  });

  /* A LINE THE CONTRACT PRICES (D27-233): no rate typed, and the contract has a
     figure for it (no "the day's price" note). Contract rates are before GST,
     so the tick neither applies nor is offered there. */
  const byContract = (l: Line, i: number): boolean => {
    const t = tariffs[i]?.data;
    return l.rate.trim() === "" && !!t && "contract" in t && !!t.contract && !t.note;
  };
  /* The tick as it counts: off on a contract-priced line. */
  const inclusive = (l: Line, i: number): boolean => l.inclusive && !byContract(l, i);

  /* A rate that includes GST, split by the server (D27-195): the typed rate,
     or with none typed the list price the calendar gives (D27-199). */
  const allIn = (l: Line, i: number): number | null =>
    l.rate.trim() !== "" ? Number(l.rate) : tariffs[i]?.data?.nights[0]?.total ?? null;
  const splits = useQueries({
    queries: lines.map((l, i) => ({
      queryKey: ["before-gst", hotelId, allIn(l, i)],
      queryFn: () => getRateBeforeGst(hotelId, allIn(l, i) ?? 0),
      enabled: inclusive(l, i) && !l.comp && (allIn(l, i) ?? 0) > 0,
    })),
  });
  const inclusiveNote = (l: Line, i: number): string | null => {
    const s = splits[i]?.data;
    const gross = allIn(l, i);
    if (!inclusive(l, i) || l.comp || gross === null || !(gross > 0) || !s) return null;
    if (!s.ok) return s.reason;
    return s.total < gross
      ? `${moneyPrecise(gross)} can't split exactly: the bill will say ${moneyPrecise(s.total)} a night.`
      : null;
  };

  const priced = lines.map((l, i): Omit<Quote, "taxRate" | "taxPerNight"> => {
    if (l.comp) return { nightly: 0, unpriced: null, differs: false };
    if (l.rate.trim() !== "") {
      const s = splits[i]?.data;
      const typed = !l.inclusive || !(Number(l.rate) > 0) ? Number(l.rate)
        : s?.ok ? s.pre : null;
      if (typed === null) return { nightly: null, unpriced: null, differs: false };
      return { nightly: typed > 0 ? discounted(typed) : typed, unpriced: null, differs: false };
    }
    const t = tariffs[i]?.data;
    if (!t) return { nightly: null, unpriced: null, differs: false };
    const terms = "contract" in t ? { contract: t.contract?.name ?? null, note: t.note } : {};
    const first = t.nights[0]?.total ?? null;
    if (first === null) {
      return { nightly: null, unpriced: t.nights[0]?.unpriced ?? t.unpriced ?? "this party", differs: false, ...terms };
    }
    /* The list price as the all-in figure: the rate before GST (D27-199). */
    const split = inclusive(l, i) ? splits[i]?.data : undefined;
    if (inclusive(l, i) && !split?.ok) return { nightly: null, unpriced: null, differs: false };
    return {
      nightly: discounted(split?.ok ? split.pre : first), unpriced: null,
      differs: t.nights.some((n) => n.total !== first), ...terms,
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
      ...p, taxRate,
      taxPerNight: p.nightly === null || taxRate === null || taxRate === undefined
        ? null : taxOn(p.nightly, taxRate),
    };
  });

  const addLine = () => {
    const first = types[0];
    if (!first) return;
    setLines((ls) => [...ls, newLine(first.id, nextKey)]);
    setNextKey((k) => k + 1);
  };

  const totalRooms = lines.reduce((n, l) => n + l.rooms, 0);
  const salesPerson = salesPick === OTHER ? salesOther.trim() : salesPick;
  const arrivesToday = from !== null && from === today;
  const idState = guestIdState(guestId, today ?? "");

  /* ── Check in now: asked of front desk's own doors ─────────────── */
  const first = lines[0];
  const firstType = types.find((t) => t.id === first?.roomTypeId)?.name ?? "";
  const oneToday = arrivesToday && totalRooms === 1 && !waiting;
  const checkRooms = useQuery({
    queryKey: ["assignable", hotelId, firstType, today],
    queryFn: () => assignableRooms(hotelId, firstType, today ?? ""),
    enabled: oneToday && !!firstType,
  });
  const early = useQuery({
    queryKey: ["early-checkin", hotelId],
    queryFn: () => earlyArrival(hotelId),
    enabled: oneToday,
  });
  const isEarly = oneToday && (early.data?.isEarly ?? false);
  const picked = checkRooms.data?.find((r) => r.number === first?.room);

  const advanceAmount = advance.trim() === "" ? null : Number(advance);
  /* No hold on cash (D27-200): the taker's drawer opens by itself on the
     first cash after the night audit, so the payment door never refuses it. */
  const advanceProblem = advanceAmount !== null && !(Number.isFinite(advanceAmount) && advanceAmount > 0)
    ? "An advance is an amount above 0." : null;

  /* RULE 6: a button that cannot be used says why, under it. */
  /* THE HOTEL'S REQUIRED FIELDS (192, D27-260 Q2), said before Save; the
     server refuses them too. */
  const required: Record<string, [string, string]> = {
    phone: ["The phone number", phone], email: ["The email", email],
    nationality: ["The nationality", guestId.nationality], address: ["The address", addressLine],
    expectedArrival: ["The expected arrival time", expected], marketSegment: ["The market segment", marketSegment],
    businessSource: ["The business source", sourceChosen], salesPerson: ["The sales person", salesPerson],
  };
  /* D27-392: a normal guest is never asked a business source. */
  const missing = (rules?.requiredBookingFields ?? [])
    .find((k) => !required[k]?.[1]?.trim() && (k !== "businessSource" || companyGuest));

  const saveReason =
    !guestName.trim() ? "Type the guest's name."
      /* X-2 (round D): the server's own phone and email rules, said first. */
      : (missing ? `${required[missing]![0]} is needed for a booking at this hotel.` : null)
      ?? phoneProblem(phone) ?? emailProblem(email)
      ?? (show.company && companyGuest
        ? (!companyName.trim() ? "Type the company's name."
          : !companyGstin.trim() ? "Type the company's GSTIN." : gstinProblem(companyGstin))
        : null)
      ?? (!bookingSourceId ? "Choose the booking source."
        : lines.length === 0 ? "Add a room."
          : (dayUse && lines.some((l) => !l.comp && !(Number(l.rate) > 0)) ? "Type the day-use price." : null)
            ?? discountProblem
            ?? (show.company && billTo === "company" && !companyId ? "Choose the company." : null)
            ?? (salesPick === OTHER && !salesOther.trim() ? "Type the sales person's name." : null)
            ?? lines.map((l, i) => {
              const s = splits[i]?.data;
              return inclusive(l, i) && !l.comp && s && !s.ok ? s.reason : null;
            }).find((r) => r !== null)
            ?? advanceProblem);
  const assignReason =
    waiting ? "A booking waiting for the hotel gets its room once it is confirmed."
      : !lines.some((l) => l.rooms === 1 && l.room) ? "Pick a room." : null;
  const checkInReason =
    waiting ? "A booking waiting for the hotel is checked in once it is confirmed."
      : !arrivesToday ? "Check in now is for an arrival today."
        : totalRooms !== 1
          ? "One room at a time: save the booking, then check each room in from Arrivals."
          : !first?.room ? "Pick a room."
            : checkRooms.isError ? "The rooms could not be read. Try again."
              : !picked ? "Checking the room…"
                : !picked.allowed ? `Room ${picked.number}: ${picked.reason}`
                  : idState.blocked
                    ?? (isEarly && !earlyReason.trim() ? "Say why the room is given early." : null);

  const reset = () => {
    setBooked(null);
    setTitle(rules?.defaultTitle ?? ""); setGuestName(""); setPhone(""); setEmail(""); setReturning(null);
    setCompanyName(""); setCompanyGstin(""); setCompanyAddress(""); setCompanyGuest(false);
    setWhatsapp(false); setOffersAgreed(false); setSingleLady(false);
    setAddressLine(""); setCity(""); setStateName(""); setPincode(""); setCountry("");
    setGuestId(deskGuestId(rules));
    setBookingSourceId(""); setBusinessSource(null); setMarketSegment("");
    setSalesPick(""); setSalesOther(""); setBillTo(rules?.defaultBillTo ?? "guest"); setCompanyId("");
    setWaiting(rules?.defaultGuarantee === "tentative"); setExpected(""); setExpectedOut(""); setGroupName("");
    setLines([]); setSeeded(false); setDiscountMode("none"); setDiscountPct(""); setDiscountReason("");
    setPromotionId(""); setNotes(""); setAdvance(""); setAdvanceBy(rules?.defaultPaymentMethod ?? "Cash"); setPrepaid(true);
    setEarlyReason(""); setWaiveEarly(false); setCampaign("");
    if (today) { setFrom(today); setTo(addDays(today, 1)); }
  };

  const submit = async (now: boolean, overLimitReason?: string) => {
    if (!from || !to || !today) return;
    setSaving(true);
    setOverLimit(null);
    const res = await createBooking(hotelId, {
      ...(overLimitReason ? { overLimitReason } : {}),
      guestName: guestName.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      bookingSourceId,
      ...(siteSource ? { prepaidOnSite: prepaid } : {}),
      ...(companyGuest && sourceChosen ? { businessSource: sourceChosen } : {}),
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
      ...(show.company && billTo === "company" && companyId ? { companyId } : {}),
      ...(discountMode === "hand" && discountPct.trim()
        ? { discount: { percent: handPct, reason: discountReason.trim() } } : {}),
      ...(discountMode === "rupees" && discountPct.trim()
        ? { discount: { amount: handPct, reason: discountReason.trim() } } : {}),
      ...(discountMode === "promotion" && promotionId ? { discount: { promotionId } } : {}),
      ...(title ? { title } : {}),
      ...(guestId.nationality.trim() ? { nationality: guestId.nationality.trim() } : {}),
      address: {
        addressLine: addressLine.trim(), city: city.trim(), state: stateName.trim(),
        pincode: pincode.trim(), country: country.trim(),
      },
      ...(show.notes && notes.trim() ? { notes: notes.trim() } : {}),
      ...(specialRequest.trim() ? { specialRequest: specialRequest.trim() } : {}),
      ...(singleLady ? { isSingleLady: true } : {}),
      ...(campaign ? { campaign } : {}),
      ...(show.company && companyGuest
        ? { guestCompany: { name: companyName.trim(), gstin: companyGstin.trim(), address: companyAddress.trim() } }
        : {}),
      lines: lines.map((l, i) => ({
        roomTypeId: l.roomTypeId, mealPlan: l.mealPlan,
        adults: l.adults, children: l.children, rooms: l.rooms,
        ...(l.comp ? { complimentary: true } : {}),
        ...(l.comp || l.rate.trim() === "" ? {} : { agreedRate: Number(l.rate) }),
        ...(!l.comp && inclusive(l, i) ? { rateIncludesGst: true } : {}),
      })),
    });

    if (!res.ok) {
      setSaving(false);
      /* Over the credit limit: said under the buttons, with the allow. */
      if (res.needs === "credit-limit") return setOverLimit({ reason: res.reason, now });
      /* The server's sentence: the unpriced party, the rule a gift or a
         discount broke. Nothing was written. */
      return toast.error("Not booked", res.reason);
    }

    const lead = res.bookings[0];
    const assigned: Booked["assigned"] = {};

    /* The advance on the first room's bill, held as credit. FIRST (the
       owner's D27-328 (3)): with "Advance before check-in" on, the check-in
       below refused a guest whose advance was typed here and not yet taken. */
    let advanceTaken: Booked["advance"];
    if (advanceAmount !== null && lead?.id) {
      const p = await settle(hotelId, lead.id, {
        method: advanceBy, amount: advanceAmount, businessDate: today, heldAsCredit: true,
      }, crypto.randomUUID());
      advanceTaken = p.ok ? { amount: advanceAmount } : { failed: p.reason ?? "Not taken." };
    }

    /* CHECK IN NOW goes through front desk's own check-in, which gives the
       room itself: the ID, Form III and the early arrival are asked there. */
    let checkedIn: Booked["checkedIn"];
    if (now && lead?.id && first) {
      const c = await checkIn(hotelId, lead.id, {
        roomNumber: first.room, adults: first.adults, children: first.children,
        ratePlan: first.mealPlan, ...guestIdPayload(guestId), businessDate: today,
        earlyReason, waiveEarly, offersAgreed,
      });
      checkedIn = c.ok ? { room: first.room } : { failed: c.reason ?? "Refused." };
      if (c.ok) assigned[lead.reference] = { room: first.room };
    }

    /* A PICKED ROOM IS KEPT (D27-163), through the assign the Calendar's
       Assign room uses - the same refusals, in its words. */
    let at = 0;
    for (const l of lines) {
      const made = res.bookings[at];
      if (l.rooms === 1 && l.room && !waiting && made?.id && !assigned[made.reference]) {
        const a = await assignRoom(hotelId, made.id, l.room);
        assigned[made.reference] = a.ok ? { room: a.room } : { failed: a.reason };
      }
      at += l.rooms;
    }

    setSaving(false);
    void qc.invalidateQueries();
    setBooked({
      guest: res.guest, groupId: res.groupId, bookings: res.bookings,
      waiting, assigned, arrivesToday, checkedIn, advance: advanceTaken,
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
          description="One guest, one set of nights. Save it, give it a room, or check them in." />
        <BookedCard hotelId={hotelId} booked={booked} today={today ?? ""} onAnother={reset} />
      </Page>
    );
  }

  const company = (billable.data ?? []).find((c) => c.id === companyId) ?? null;
  const setLine = (key: number, next: Line) =>
    setLines((ls) => ls.map((l) => (l.key === key ? next : l)));

  return (
    <Page>
      <PageHeader
        title="New booking"
        description={isWalkIn
          ? `A walk-in into room ${walkRoom}. Check them in, or save the booking.`
          : "One guest, one set of nights. Save it, give it a room, or check them in."}
      />
      {lead.error && (
        <p className="mb-3 text-sm text-warning-dark" data-lead-gone>{lead.error.message}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Card>
            <CardHeader title="Guest" />
            <CardBody className="space-y-4">
              {/* D27-371: Salutation beside Full name; the hotel's default
                  salutation fills in (D27-243). */}
              <div className="grid gap-3 grid-cols-[6.5rem_minmax(0,1fr)]">
                <Field label="Salutation">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={title}
                      onChange={(e) => setTitle(e.target.value)} className="h-12 text-base">
                      <option value="">None</option>
                      {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Full name" required>
                  {(f) => (
                    <Input {...fieldProps(f)} value={guestName} autoFocus={!!walkRoom}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="Anil Sharma" className="h-12 text-base" />
                  )}
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone" hint="Needed for online check-in and WhatsApp.">
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
                chosen={returning} onChoose={setReturning}
                {...(show.company ? { onUseCompany: (c: { name: string | null; gstin: string | null; address: string | null }) => {
                  setCompanyName(c.name ?? ""); setCompanyGstin(c.gstin ?? ""); setCompanyAddress(c.address ?? "");
                  setCompanyGuest(true);
                } } : {})} />
              {/* D27-371: the guest's own company. With a GSTIN the tax invoice
                  is made out to it; the guest still pays. D27-372: the Company
                  section switched off hides it too. D27-392: only for a company
                  guest, its name and GSTIN required; one not on Companies and
                  agents is added to it when the booking saves. */}
              {show.company && <>
              <Field label="The guest">
                {() => (
                  <Segmented value={companyGuest ? "company" : "normal"}
                    onChange={(v) => setCompanyGuest(v === "company")}
                    options={[
                      { value: "normal", label: "Normal guest" },
                      /* Short on a phone: the toggle does not wrap. */
                      { value: "company", label: <>Company guest<span className="max-sm:hidden"> (GST registered)</span></> },
                    ]} />
                )}
              </Field>
              {companyGuest && <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="GSTIN" required
                  hint="The tax invoice is made out to the company. The guest still pays."
                  error={companyGstin.trim().length === 15 ? gstinProblem(companyGstin) ?? undefined : undefined}>
                  {(f) => (
                    <Input {...fieldProps(f)} value={companyGstin} maxLength={15}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        setCompanyGstin(v);
                        const hit = v.length === 15 ? companyList.data?.find((c) => c.gstin?.toUpperCase() === v) : undefined;
                        if (hit) {
                          setCompanyName(hit.name);
                          setCompanyAddress([hit.addressLine, hit.city, hit.state, hit.pincode].filter(Boolean).join(", "));
                        }
                      }}
                      className="h-12 text-base tabular uppercase" data-guest-gstin />
                  )}
                </Field>
                <Field label="Company name" required>
                  {(f) => (
                    <Input {...fieldProps(f)} value={companyName} maxLength={120}
                      onChange={(e) => setCompanyName(e.target.value)} className="h-12 text-base" />
                  )}
                </Field>
              </div>
              <Field label="Company address">
                {(f) => (
                  <Input {...fieldProps(f)} value={companyAddress} maxLength={200}
                    onChange={(e) => setCompanyAddress(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
              {gstinTyped && companyList.data && (
                <p className="text-base text-grey-600" data-company-on-list>
                  {byGstin ? `Found: ${byGstin.name}, on Companies and agents.`
                    : byName ? `${byName.name} is on Companies and agents ${byName.gstin ? `with GSTIN ${byName.gstin}` : "without a GSTIN"}. This booking keeps the GSTIN typed here; the list is not changed.`
                      : can(role, "create", "company")
                        ? "This company is not on your list. Saving the booking adds it to Companies and agents."
                        : "This company is not on your list. It is kept on this booking; the GM can add it to Companies and agents."}
                </p>
              )}
              </>}
              </>}
              {/* D27-176: WhatsApp stays in sight (vouchers and the check-in
                  code need it); offers and the single-lady tick fold away. */}
              <Switch checked={whatsapp} onCheckedChange={setWhatsapp}
                label="Guest agreed to WhatsApp"
                description="Ask them. Unticked, messages go by email if there is one, else not at all." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Stay"
              actions={
                <Button variant="secondary" className="h-11" onClick={addLine}
                  disabled={types.length === 0}>
                  <Plus className="size-4" /> Another room
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Arrival">
                  {(f) => (
                    <Input {...fieldProps(f)} type="date" value={from}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFrom(v);
                        /* A day use moves with its day; a stay keeps a night. */
                        if (dayUse) setTo(v);
                        else if (to <= v) setTo(addDays(v, 1));
                      }}
                      className="h-12 text-base" />
                  )}
                </Field>
                <Field label="Departure"
                  hint={dayUse
                    ? `Day use - in and out on ${dateShort(from)}. Type the day's price; it is charged at check-in.`
                    : nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"}`
                    : "The night of departure is not charged."}>
                  {(f) => (
                    <Input {...fieldProps(f)} type="date" value={to} min={from}
                      onChange={(e) => setTo(e.target.value)} className="h-12 text-base" />
                  )}
                </Field>
              </div>
              <Field label="Booking source" required
                hint="How it reached us. It cannot be filled in later.">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={bookingSourceId}
                    onChange={(e) => setBookingSourceId(e.target.value)} className="h-12 text-base">
                    {/* The blank is not an answer: a list that opens on Agoda
                        gets Agoda on bookings from anywhere. */}
                    <option value="">Choose one…</option>
                    {(channels.data ?? []).filter((s) => s.isActive).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {siteSource && (
                <Switch checked={prepaid} onCheckedChange={setPrepaid}
                  label="Prepaid on the booking site"
                  description="Untick when the guest pays at the hotel: the advance before check-in is then asked." />
              )}
              {totalRooms > 1 && (
                <Field label="Group name"
                  hint="More than one room becomes a group. Left empty, it is named after the guest.">
                  {(f) => (
                    <Input {...fieldProps(f)} value={groupName} placeholder="Sharma Wedding, March"
                      onChange={(e) => setGroupName(e.target.value)} className="h-12 text-base" />
                  )}
                </Field>
              )}
              <div className="divide-y divide-grey-100">
                {lines.map((line, i) => (
                  <RoomLine
                    key={line.key}
                    line={line}
                    quote={quotes[i]!}
                    pricing={tariffs[i]?.isLoading ?? false}
                    nights={nights}
                    dayUse={dayUse}
                    types={types}
                    left={leftFor(line.roomTypeId)}
                    mayGive={keeper}
                    inclusiveNote={inclusiveNote(line, i)}
                    contractRate={byContract(line, i)}
                    waiting={waiting}
                    removable={lines.length > 1}
                    rooms={(rooms.data ?? []).filter((r) =>
                      r.type === types.find((t) => t.id === line.roomTypeId)?.name
                      && r.status !== "out-of-service")
                      .map((r) => {
                        /* The first room of an arrival today says what
                           check-in would say of it: who is still in it. */
                        const why = i === 0 ? checkRooms.data?.find((c) => c.number === r.number) : undefined;
                        return { number: r.number, state: !arrivesToday ? undefined
                          : why && !why.allowed ? why.reason : ROOM_STATE[r.status] };
                      })}
                    onChange={(next) => setLine(line.key, next)}
                    onRemove={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  />
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="ID"
              description={arrivesToday
                ? "Recorded by Check in now. Save booking keeps only the nationality."
                : "The document is taken when they check in."} />
            <CardBody className="space-y-4">
              <GuestIdFields value={guestId} onChange={setGuestId} today={today ?? ""}
                withDocument={arrivesToday} />
              {/* ARRIVING EARLY, by the property's clock, not the device's; the
                  server refuses without a reason either way. */}
              {isEarly && (
                <div className="rounded-lg border border-brand-yellow-100 bg-brand-yellow-50 p-3 space-y-2.5">
                  <p className="text-sm text-warning-dark">
                    Rooms are ready from {early.data?.checkInTime ?? "-"}.
                    {early.data?.charge == null
                      ? " This property does not charge for an early arrival."
                      : ` An early arrival is ${money(early.data.charge)}.`}
                  </p>
                  <Field label="Why the room is being given early" required>
                    {(f) => (
                      <Input {...fieldProps(f)} value={earlyReason}
                        placeholder="Overnight train, room vacant and clean"
                        onChange={(e) => setEarlyReason(e.target.value)} />
                    )}
                  </Field>
                  {early.data?.charge != null && early.data.mayWaive && (
                    <Checkbox checked={waiveEarly} onCheckedChange={setWaiveEarly}
                      label="Waive the charge. The reason is still recorded." />
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Advance"
              description="Held as the guest's credit until the nights are charged." />
            <CardBody>
              <div className="grid gap-3 grid-cols-2">
                <Field label="Amount">
                  {(f) => (
                    <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
                      value={advance} placeholder="-" onChange={(e) => setAdvance(e.target.value)}
                      className="h-12 text-base tabular" />
                  )}
                </Field>
                <Field label="Paid by">
                  {(f) => (
                    <NativeSelect {...fieldProps(f)} value={advanceBy}
                      onChange={(e) => setAdvanceBy(e.target.value)}
                      className="h-12 text-base">
                      {/* Money received at the desk; Bill to company is not an advance. */}
                      {payingWays(rules, false).map((m) => <option key={m} value={m}>{m}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              </div>
            </CardBody>
          </Card>

          <Fold title="More about the guest">
            <Switch checked={offersAgreed} onCheckedChange={setOffersAgreed}
              label="Guest agreed to offers"
              description="Ask them. Unticked, no offers are sent. Kept against this phone and email at every hotel of the group." />
            <Switch checked={singleLady} onCheckedChange={setSingleLady}
              label="Woman travelling alone"
              description="Placed away from stairwells and service corridors. Not announced at the desk." />
            <Field label="Address">
              {(f) => (
                <Input {...fieldProps(f)} value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)} className="h-12 text-base" />
              )}
            </Field>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <Field label="City">
                {(f) => (
                  <Input {...fieldProps(f)} value={city}
                    onChange={(e) => setCity(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
              <Field label="State">
                {(f) => (
                  <Input {...fieldProps(f)} value={stateName}
                    onChange={(e) => setStateName(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
              <Field label="PIN code">
                {(f) => (
                  <Input {...fieldProps(f)} value={pincode} inputMode="numeric"
                    onChange={(e) => setPincode(e.target.value)} className="h-12 text-base tabular" />
                )}
              </Field>
              <Field label="Country">
                {(f) => (
                  <Input {...fieldProps(f)} value={country}
                    onChange={(e) => setCountry(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
            </div>
          </Fold>

          <Fold title="Booking details">
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
              <Field label="Expected check-in"
                hint={`If they said. The hotel's check-in is ${hotel?.checkInTime ?? "-"}.`}>
                {(f) => (
                  <Input {...fieldProps(f)} type="time" value={expected}
                    onChange={(e) => setExpected(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
              <Field label="Expected check-out"
                hint={`If they said. The hotel's check-out is ${hotel?.checkOutTime ?? "-"}.`}>
                {(f) => (
                  <Input {...fieldProps(f)} type="time" value={expectedOut}
                    onChange={(e) => setExpectedOut(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* D27-392: a company guest's only, starting on that company; the
                  list is Companies and agents, then the names on past bookings. */}
              {companyGuest && (
              <Field label="Business source" hint="The company or agent behind the booking. It starts on the guest's company.">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={sourceChosen}
                    onChange={(e) => setBusinessSource(e.target.value)} className="h-12 text-base">
                    <option value="">None</option>
                    {/* Keyed by the name: the accounts report's id is a slug of
                        it, and two names can share one ("Walk-In", "Walk-in"). */}
                    {[...new Set([companyName.trim(), ...(companyList.data ?? []).map((c) => c.name),
                      ...(accounts.data ?? []).map((c) => c.name)].filter(Boolean))].map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              )}
              {/* Blank is "unknown", never "Other" - the walk-in's rule. */}
              <Field label="Market segment">
                {(f) => (
                  <NativeSelect {...fieldProps(f)} value={marketSegment}
                    onChange={(e) => setMarketSegment(e.target.value)} className="h-12 text-base">
                    <option value="">-</option>
                    {/* The hotel's own list (192, D27-260); the five built in until it loads. */}
                    {(segments.data?.filter((m) => m.active).map((m) => m.label) ?? [...MARKET_SEGMENTS])
                      .map((m) => <option key={m} value={m}>{m}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </div>
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
                      aria-label="Change the sales people list" onClick={() => setKeeping("sales")}>
                      <ListPlus className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </Field>
            {salesPick === OTHER && (
              <Field label="Sales person's name" required>
                {(f) => (
                  <Input {...fieldProps(f)} value={salesOther}
                    onChange={(e) => setSalesOther(e.target.value)} className="h-12 text-base" />
                )}
              </Field>
            )}
            <Discount
              mode={discountMode} onMode={setDiscountMode}
              pct={discountPct} onPct={setDiscountPct}
              reason={discountReason} onReason={setDiscountReason}
              promotionId={promotionId} onPromotion={setPromotionId}
              promotions={promotions.data ?? []}
              problem={discountProblem}
            />
          </Fold>

          {show.company && (
            <Fold title="Company">
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
                        onChange={(e) => setCompanyId(e.target.value)} className="h-12 text-base">
                        <option value="">Choose one…</option>
                        {(billable.data ?? []).map((cmp) => (
                          <option key={cmp.id} value={cmp.id}>{cmp.name}</option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              </div>
              {/* Its GSTIN, read-only (D27-163, D27-193): from the company's
                  record, which the tax invoice prints. Nothing is stored here. */}
              {billTo === "company" && company && (
                <p className="text-base text-grey-600" data-gstin>
                  {company.gstin
                    ? <>GSTIN <span className="tabular text-ink-900 font-medium">{company.gstin}</span>, from {company.name}'s record. The tax invoice prints it.</>
                    : `${company.name} has no GSTIN on its record.`}
                </p>
              )}
            </Fold>
          )}

          {/* D27-347: the guest's own request, printed on the voucher; Notes
              stay the hotel's own. */}
          <Fold title="Special request">
            <Field label="The guest's special request" hint="Printed on the booking voucher the guest receives.">
              {(f) => (
                <Textarea {...fieldProps(f)} value={specialRequest} rows={2} maxLength={500}
                  onChange={(e) => setSpecialRequest(e.target.value)} className="text-base" data-special-request />
              )}
            </Field>
          </Fold>

          {show.notes && (
            <Fold title="Notes">
              <Field label="Notes on the booking" hint="The hotel's own. Never on the voucher.">
                {(f) => (
                  <Textarea {...fieldProps(f)} value={notes} rows={3}
                    onChange={(e) => setNotes(e.target.value)} className="text-base" />
                )}
              </Field>
            </Fold>
          )}
        </div>

        <Summary nights={nights} dayUse={dayUse} lines={lines} quotes={quotes} types={types}
          advance={advanceProblem ? null : advanceAmount} />
      </div>

      {/* THE THREE BUTTONS, at the bottom (D27-158). The one filled button is
          the job the page was opened for: a walk-in's check-in, else saving. */}
      <div className="mt-3 space-y-2" data-booking-actions>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant={isWalkIn ? "secondary" : "primary"} className="h-12 text-base"
            loading={saving} disabled={saving || saveReason !== null}
            onClick={() => void submit(false)}>
            Save booking
          </Button>
          <Button variant="secondary" className="h-12 text-base"
            loading={saving} disabled={saving || saveReason !== null || assignReason !== null}
            onClick={() => void submit(false)}>
            Save and assign room
          </Button>
          <Button variant={isWalkIn ? "primary" : "secondary"} className="h-12 text-base"
            loading={saving} disabled={saving || saveReason !== null || checkInReason !== null}
            onClick={() => void submit(true)}>
            Check in now
          </Button>
        </div>
        <div className="text-sm text-grey-600 space-y-0.5" data-booking-reasons>
          {saveReason ? <p>{saveReason}</p> : (
            <>
              {assignReason && <p>Save and assign room: {assignReason}</p>}
              {checkInReason && <p>Check in now: {checkInReason}</p>}
            </>
          )}
        </div>
        {overLimit && (
          <OverLimit reason={overLimit.reason} mayAllow={keeper} allowReason={allowReason}
            onReason={setAllowReason} saving={saving}
            onAllow={() => void submit(overLimit.now, allowReason.trim())} />
        )}
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
    </Page>
  );
}

/* ── Over the company's credit limit (D27-275) ────────────────────
   The server's sentence. The owner, an administrator or the GM may book it
   anyway with a reason, which the activity log keeps; anybody else is told
   who can. */
function OverLimit({ reason, mayAllow, allowReason, onReason, saving, onAllow }: {
  reason: string; mayAllow: boolean; allowReason: string;
  onReason: (v: string) => void; saving: boolean; onAllow: () => void;
}) {
  return (
    <div className="rounded-lg border border-grey-200 bg-grey-50 p-3 space-y-2" data-over-limit>
      <p className="text-base text-ink-900">{reason}</p>
      {mayAllow ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Why it is allowed" placeholder="Why it is allowed"
            value={allowReason} onChange={(e) => onReason(e.target.value)} />
          <Button variant="secondary" loading={saving} disabled={saving || !allowReason.trim()}
            onClick={onAllow}>
            Allow, with reason
          </Button>
        </div>
      ) : (
        <p className="text-sm text-grey-600">
          The owner, an administrator or the general manager can allow it.
        </p>
      )}
    </div>
  );
}

/* ── A fold-open section (D27-158) ────────────────────────────────
   The browser's own <details>: keyboard, screen reader and the open state
   come with it. Closed until the clerk needs it. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group bg-white border border-grey-200 rounded-lg">
      <summary className="flex items-center gap-2 px-4 py-3.5 min-h-12 cursor-pointer list-none
        [&::-webkit-details-marker]:hidden">
        <span className="text-md font-semibold text-ink-900">{title}</span>
        <ChevronDown className="ml-auto size-4 text-grey-500 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 pt-0.5 space-y-4">{children}</div>
    </details>
  );
}

/* ── One room ─────────────────────────────────────────────────────
   The price sits beside the room, live: the question on the phone is
   "what will that cost". */
function RoomLine({
  line, quote, pricing, nights, dayUse, types, left, mayGive, inclusiveNote, contractRate, waiting, removable, rooms, onChange, onRemove,
}: {
  line: Line;
  quote: Quote;
  pricing: boolean;
  nights: number;
  /** A day use: its price is typed (D27-229). */
  dayUse: boolean;
  types: { id: string; name: string }[];
  left: number | null;
  mayGive: boolean;
  /** Why the inclusive rate is refused, or the paisa it cannot reach (D27-195). */
  inclusiveNote: string | null;
  /** Priced by the company's contract: its rates are before GST (D27-233). */
  contractRate: boolean;
  waiting: boolean;
  removable: boolean;
  /** Rooms of this type; `state` is today's cleaning, for an arrival today. */
  rooms: { number: string; state: string | undefined }[];
  onChange: (l: Line) => void;
  onRemove: () => void;
}) {
  const over = left !== null && line.rooms > left;

  return (
    <div className="py-3.5 first:pt-0 last:pb-0 space-y-3">
      <div className={cn("grid gap-2", removable
        ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]"
        : "sm:grid-cols-2")}>
        <Field label="Room type">
          {(f) => (
            <NativeSelect {...fieldProps(f)} value={line.roomTypeId}
              onChange={(e) => onChange({ ...line, roomTypeId: e.target.value, room: "" })}
              className="h-12 text-base">
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Meal plan" className={removable ? "order-3 col-span-2 sm:order-none sm:col-span-1" : undefined}>
          {(f) => (
            <NativeSelect {...fieldProps(f)} value={line.mealPlan}
              onChange={(e) => onChange({ ...line, mealPlan: e.target.value })}
              className="h-12 text-base">
              {PLANS.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </NativeSelect>
          )}
        </Field>
        {removable && (
          <Button variant="secondary" className="h-12 w-12 p-0 self-end"
            aria-label="Remove this room" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* The rate's column is wider: its tick sits on one line under it. */}
      <div className="grid grid-cols-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.8fr)] gap-2">
        <Counter label="Rooms" value={line.rooms} min={1}
          onChange={(n) => onChange({ ...line, rooms: n, room: n === 1 ? line.room : "" })} />
        <Counter label="Adults" value={line.adults} min={1}
          onChange={(adults) => onChange({ ...line, adults })} />
        <Counter label="Children" value={line.children} min={0}
          onChange={(children) => onChange({ ...line, children })} />
        <div data-inclusive>
          <Field label="Rate" hint={line.comp ? "Complimentary."
            : dayUse ? "Type the day's price." : "Empty uses the calendar."}>
            {(f) => (
              <Input {...fieldProps(f)} type="number" inputMode="decimal" min={0}
                value={line.comp ? "" : line.rate} placeholder="-" disabled={line.comp}
                onChange={(e) => onChange({ ...line, rate: e.target.value })}
                className="h-12 text-base tabular" />
            )}
          </Field>
          {/* A tick beside the rate (D27-199): the typed rate, or the list price
              with none typed, already includes GST and is split by the slab. */}
          {!line.comp && (
            <Checkbox checked={line.inclusive && !contractRate} disabled={contractRate}
              onCheckedChange={(inclusive) => onChange({ ...line, inclusive })}
              label="Rate includes GST" className="mt-2" />
          )}
          {!line.comp && contractRate && (
            <p className="text-xs text-grey-500 mt-1">Contract rates are before GST</p>
          )}
        </div>
      </div>

      {!line.comp && inclusiveNote && (
        <p className="text-sm text-warning-dark" data-inclusive-note>{inclusiveNote}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 items-end">
        {line.rooms === 1 && !waiting ? (
          <Field label="Room" hint="Optional. A room picked is kept.">
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={line.room}
                onChange={(e) => onChange({ ...line, room: e.target.value })}
                className="h-12 text-base">
                <option value="">Assign later</option>
                {rooms.map((r) => (
                  <option key={r.number} value={r.number}>
                    Room {r.number}{r.state ? ` · ${r.state}` : ""}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : <span />}
        <Checkbox
          checked={line.comp}
          disabled={!mayGive}
          onCheckedChange={(comp) => onChange({ ...line, comp })}
          label={mayGive ? "Complimentary" : "Complimentary (owner, admin or GM only)"}
          className="sm:mb-3.5"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
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
        <LinePrice line={line} quote={quote} pricing={pricing} nights={nights} dayUse={dayUse} />
      </div>
    </div>
  );
}

function LinePrice({ line, quote, pricing, nights, dayUse }: {
  line: Line; quote: Quote; pricing: boolean; nights: number; dayUse: boolean;
}) {
  if (line.comp) return <span className="text-grey-600">Complimentary: no charge, nothing posted</span>;
  if (quote.unpriced) {
    return (
      <span className="flex items-center gap-1.5 text-warning-dark font-medium">
        <AlertTriangle className="size-3.5" />
        No price for {quote.unpriced}
      </span>
    );
  }
  if (quote.nightly === null) return <span className="text-grey-500">{pricing ? "Pricing…" : "-"}</span>;
  return (
    <span className="text-grey-600">
      {moneyPrecise(quote.nightly)} {dayUse ? "for the day" : "a night"}
      {" + "}
      {quote.taxPerNight === null ? "-" : moneyPrecise(quote.taxPerNight)} tax
      {quote.taxRate !== null && quote.taxRate !== undefined && ` (${quote.taxRate}%)`}
      {line.rate.trim() !== "" && ", agreed"}
      {dayUse ? " · day use" : nights > 0 && ` · ${nights} ${nights === 1 ? "night" : "nights"}`}
      {quote.differs && (
        <span className="block text-warning-dark">
          The first night's price is kept for every night; the calendar differs later.
        </span>
      )}
      {quote.contract && line.rate.trim() === "" && (
        <span className="block" data-contract-line>
          Contract: {quote.contract}{quote.note && <span className="text-warning-dark">. {quote.note}</span>}
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

/* ── The discount (D27-36): up to the cap by hand with a reason; more only
   through a named promotion. The server decides. */
function Discount({
  mode, onMode, pct, onPct, reason, onReason, promotionId, onPromotion,
  promotions, problem,
}: {
  mode: "none" | "hand" | "rupees" | "promotion"; onMode: (m: "none" | "hand" | "rupees" | "promotion") => void;
  pct: string; onPct: (v: string) => void;
  reason: string; onReason: (v: string) => void;
  promotionId: string; onPromotion: (v: string) => void;
  promotions: { id: string; name: string; percent: number | null; amount: number | null }[];
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
              { value: "rupees", label: "₹ off" },
              { value: "promotion", label: "Promotion" },
            ]} />
        )}
      </Field>
      {(mode === "hand" || mode === "rupees") && (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
          <Input type="number" inputMode="decimal" min={0} max={mode === "hand" ? FREEHAND_CAP : undefined}
            aria-label={mode === "hand" ? "Discount percent" : "Rupees off each night"}
            placeholder={mode === "hand" ? "%" : "₹ a night"}
            value={pct} onChange={(e) => onPct(e.target.value)} className="h-11 text-base tabular" />
          <Input aria-label="Why" placeholder="Why"
            value={reason} onChange={(e) => onReason(e.target.value)} className="h-11 text-base" />
        </div>
      )}
      {mode === "promotion" && (
        <div className="flex gap-2">
          <NativeSelect value={promotionId} aria-label="Promotion"
            onChange={(e) => onPromotion(e.target.value)} className="h-11 text-base flex-1 min-w-0">
            <option value="">{promotions.length ? "Choose one…" : "No promotions yet"}</option>
            {promotions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.percent !== null ? `${p.percent}%` : `₹${p.amount} a night`})
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {problem && <p className="text-sm text-warning-dark">{problem}</p>}
    </div>
  );
}

/* ── The figures ──────────────────────────────────────────────────
   It refuses to show a total it cannot stand behind: a dash before any
   price is known, and while any part is unpriced or its tax unknown. */
function Summary({ nights, dayUse, lines, quotes, types, advance }: {
  nights: number; dayUse: boolean; lines: Line[]; quotes: Quote[];
  types: { id: string; name: string }[];
  /** A valid advance typed on the page; null when none. */
  advance: number | null;
}) {
  const rooms = lines.reduce((n, l) => n + l.rooms, 0);
  /* What is charged: each night, or a day use's one day (D27-227). */
  const units = dayUse ? 1 : nights;
  const priced = lines.length > 0 && quotes.every((q) => q.nightly !== null);
  const taxed = priced && quotes.every((q) => q.taxPerNight !== null);
  const sum = (each: (q: Quote, l: Line) => number) =>
    lines.reduce((p, l, i) => p + paise(each(quotes[i]!, l)) * l.rooms * units, 0) / 100;
  const charges = priced ? sum((q) => q.nightly ?? 0) : null;
  const tax = taxed ? sum((q) => q.taxPerNight ?? 0) : null;
  const bill = charges !== null && tax !== null ? charges + tax : null;
  const due = bill === null ? null : Math.round((bill - (advance ?? 0)) * 100) / 100;
  const unpriced = quotes.filter((q) => q.unpriced).map((q) => q.unpriced);
  const noRule = priced && !taxed && quotes.some((q) => q.taxRate === null);

  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardHeader title="The booking" />
      <CardBody className="space-y-3">
        <dl className="divide-y divide-grey-200">
          <Row label="Nights" value={dayUse ? "Day use" : String(nights)} />
          <Row label="Rooms" value={String(rooms)} />
        </dl>
        {lines.length > 0 && (
          <ul className="text-sm text-grey-600 space-y-1">
            {lines.map((l, i) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="truncate">
                  {l.rooms} × {types.find((t) => t.id === l.roomTypeId)?.name ?? "-"}
                  {l.comp && ", complimentary"}
                </span>
                <span className="tabular shrink-0">
                  {quotes[i]?.nightly === null || quotes[i]?.nightly === undefined
                    ? "-" : money(quotes[i]!.nightly! * units * l.rooms)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <dl className="pt-3 border-t border-grey-200 divide-y divide-grey-200">
          <Row label="Room charges" value={charges === null ? "-" : moneyPrecise(charges)} />
          <Row label="GST" value={tax === null ? "-" : moneyPrecise(tax)} />
          {advance !== null && <Row label="Advance" value={`- ${moneyPrecise(advance)}`} />}
          <div className="flex items-baseline justify-between py-2">
            <dt className="text-base font-medium text-ink-900">Due</dt>
            <dd className={cn("text-2xl font-semibold tabular", due === null && "text-grey-500")}>
              {due === null ? "-" : moneyPrecise(due)}
            </dd>
          </div>
        </dl>
        {unpriced.length > 0 ? (
          <p className="text-sm text-warning-dark">
            No price for {unpriced.join(", ")}. Set it on Rates, or type a rate on the line.
          </p>
        ) : noRule ? (
          <p className="text-sm text-warning-dark">
            The tax card has no rule for this rate. Set it before the night audit posts it.
          </p>
        ) : (
          <p className="text-sm text-grey-500">
            As the bill will carry it.{advance === null ? " Nothing is paid at booking." : ""}
          </p>
        )}
        {rooms > 1 && (
          <p className="text-sm text-grey-500">{rooms} rooms are booked as one group.</p>
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
