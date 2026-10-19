import { createHash } from "node:crypto";
import type { Client } from "../../db.ts";
import { countProblem, countryProblem, dateProblem, MAX_NIGHTS } from "../../validate.ts";
import { roomRateBeforeGst, overCreditLimit } from "../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   MAKING A BOOKING - the one place a reservation is created

   Moved out of the HTTP route on 18 September, unchanged, so that a machine
   can make a booking IN PROCESS, inside the caller's own transaction: the
   channel manager turns a booking SU pushed into a real one, and it must be
   the same act with the same refusals, never a second implementation that
   drifts (D17-79, the channel manager's request 6).

   A person's booking arrives through `groups.post("/:code/bookings")`, which
   reads and checks a request body and then calls this. A machine's arrives
   through `createChannelBooking` in channel.ts. Both end here.

   What this holds, with the reasons in the comments below: every refusal
   above the first write (RES-1), one reference from one place (RES-2), a
   booking sent twice answered with the first (RES-3), no price invented -
   and, for a machine only, never an overbooking (D17-43, D17-80).
   ══════════════════════════════════════════════════════════════════ */

export interface BookingLineInput {
  roomTypeId?: string;
  mealPlan?: string;
  adults?: number;
  children?: number;
  rooms?: number;
  agreedRate?: number;
  /** D27-195: agreedRate includes GST; it is split before it is kept. */
  rateIncludesGst?: boolean;
  /** A complimentary room (020): booked at ₹0, and the night audit posts
      nothing for it. Only COMP_ROLES may give one (the owner, 27 Sep). */
  complimentary?: boolean;
}

/** Who may give a complimentary room (the owner, 27 September). A group
    administrator is the owner everywhere, as throughout this system. */
export const COMP_ROLES = ["owner", "admin", "gm"] as const;

/** The guest's title (the owner, 27 September). 146 holds the same list. */
export const TITLES = ["Mr", "Ms", "Mrs", "Dr"] as const;

/** A discount on every night of the booking (D27-36, the restaurant's rule):
    up to the free-hand cap with a reason, or a named promotion. */
export interface BookingDiscount {
  percent?: number;
  /** ₹ off each night instead of a percent (191, the owner's D27-259 Q4). */
  amount?: number;
  reason?: string;
  promotionId?: string;
}

/** Where the guest lives, at booking (plan § 3 rows 25-28). */
export interface BookingAddress {
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface BookingRequest {
  hotelId: string;
  guestName: string;
  phone?: string;
  email?: string;
  checkIn: string;
  checkOut: string;
  groupName?: string;
  blockCode?: string;
  bookingSourceId?: string;
  source?: string;
  businessSource?: string;
  marketSegment?: string;
  expectedArrival?: string;
  /** The sender's own reference (RES-3). Null for the desk, which has none. */
  externalRef?: string | null;
  lines: BookingLineInput[];
  /** A MACHINE MAY NOT OVERBOOK (D17-43, D17-80). A person may: deliberate
      overbooking is something every hotel does, and the desk decides. */
  refuseWhenFull?: boolean;
  /** THE RETURNING GUEST THE CLERK CONFIRMED (D21-20): "same person? - yes".
      Only the desk sends it; a machine never does, so a channel booking
      still makes its own guest. Checked again here against the phone and
      email typed - never trusted from the browser. Left out of the
      fingerprint on purpose: it is the desk's, and the fingerprint is a
      sender's (RES-3). */
  guestId?: string | null;
  /** "Guest agreed to WhatsApp" (D21-72). A booking from a channel arrives
      unticked; the desk asks on phone and walk-in bookings. */
  whatsappAgreed?: boolean;
  /** D27-246: a booking-site booking prepaid there (absent = yes, 187's default). */
  prepaidOnSite?: boolean;

  /* ── The desk's, from Phase 1 (D27-33). Left out of the fingerprint like
     guestId: a sender's retry is judged on what a sender sends. ── */
  /** Waiting for the hotel: status 'tentative'. Holds a room of its type
      (044) and is sent nothing (126, 131) until somebody confirms it. */
  tentative?: boolean;
  /** The hour they said they would leave. Absent is "did not say". */
  expectedDeparture?: string;
  /** A name from the owner's list, or one typed under "Other" (D27-37). */
  salesPerson?: string;
  /** Bill to a company: reservations.company_id (CRS-12). */
  companyId?: string;
  /** Allowed over the company's credit limit, and why (D27-275): the owner,
      an administrator or the GM only. */
  overLimitReason?: string;
  discount?: BookingDiscount;
  title?: string;
  /** Two letters, IN for India - the check-in's own shape. */
  nationality?: string;
  address?: BookingAddress;
  /** The desk's note on the booking (D27-163), kept on reservations.notes. */
  notes?: string;
  /** The guest's special request (D27-347), printed on the voucher. */
  specialRequest?: string;
  /** "Woman travelling alone" (D27-163): the walk-in's tick, now the booking's. */
  isSingleLady?: boolean;
  /** The lead's campaign, from "Book this lead" (D27-170): reservations.campaign. */
  campaign?: string;
}

export interface BookingMade {
  ok: true;
  duplicate: boolean;
  groupId: string | null;
  rooms: number;
  guest: string;
  /** `id` is the stay's: New booking hands it to front desk's doors (Phase 1).
      A repeat answers the same ids as the first time (RES-3). */
  bookings: Array<{ id: string; reference: string; roomType: string; rate: number }>;
  nightly: number;
  /** 'tentative' when the desk booked it as Waiting. */
  status: "confirmed" | "tentative";
  /** The rows, for a caller in process. Empty on a repeat: nothing was made
      this time, and the references above say which booking it already is. */
  reservationIds: string[];
  folioIds: string[];
  guestId: string | null;
}

export interface BookingRefused {
  ok: false;
  /** "no_room": a machine's booking past a full house, or the desk's where
      the hotel says the desk may not overbook (187, D27-243). */
  kind: "refused" | "no_room" | "unpriced";
  reason: string;
  /** "credit-limit": the company is over its limit; a GM may allow it (D27-275). */
  needs?: "credit-limit";
}

export type BookingResult = BookingMade | BookingRefused;

const refuse = (reason: string): BookingRefused => ({ ok: false, kind: "refused", reason });

/* ── A booking this channel already sent (RES-3) ──────────────────── */

type Received = {
  id: string;
  reference: string;
  room_type: string;
  agreed_rate: string;
  group_id: string | null;
  guest: string;
  ota_fingerprint: string | null;
  status: string;
};

export async function alreadyReceived(
  client: Client, hotelId: string, sourceId: string | undefined,
  externalRef: string,
): Promise<Received[]> {
  const { rows } = await client.query<Received>(
    `select r.id::text, r.reference, rt.name as room_type, r.agreed_rate::text,
            r.group_id::text, g.full_name as guest, r.ota_fingerprint, r.status
       from reservations r
       join room_types rt on rt.id = r.room_type_id
       join guests g on g.id = r.guest_id
      where r.hotel_id = $1 and r.booking_source_id = $2
        and r.ota_reference = $3 and r.ota_line is not null
      order by r.ota_line`,
    [hotelId, sourceId, externalRef]);
  return rows;
}

/* A second copy of a booking already received is answered with the FIRST
   one: not refused, and not booked again. A same-reference booking whose
   fingerprint differs is not a retry - it is the booking CHANGED, and this
   door does not take changes (amendments are `amendChannelBooking`, or the
   desk). Nothing is written either way. */
export function answerRepeat(
  earlier: Received[], externalRef: string, fingerprint: string,
): BookingResult {
  const references = earlier.map((r) => r.reference);
  if (earlier[0]!.ota_fingerprint !== fingerprint) {
    return refuse(
      `Booking ${externalRef} was already received from this channel as `
      + `${references.join(", ")}, with different details. A change to a `
      + "booking is not taken this way - it is made on the booking, at the desk.");
  }
  const bookings = earlier.map((r) => ({
    id: r.id, reference: r.reference, roomType: r.room_type, rate: Number(r.agreed_rate),
  }));
  return {
    ok: true,
    duplicate: true,
    groupId: earlier[0]!.group_id,
    rooms: bookings.length,
    guest: earlier[0]!.guest,
    bookings,
    nightly: bookings.reduce((sum, b) => sum + b.rate, 0),
    status: earlier[0]!.status === "tentative" ? "tentative" : "confirmed",
    reservationIds: [],
    folioIds: [],
    guestId: null,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: string }).code === "23505";
}

/* ── What makes two requests THE SAME booking (RES-3) ──────────────
   Everything the sender said about it, after the defaults applied here - so
   a line sent with `adults` left out and the same line sent with `adults: 1`
   are one booking, as they would make one. Not the reference itself; that is
   the key the fingerprint sits under. Keys in a fixed order, because the
   hash is of the text. */
export function fingerprintOf(request: BookingRequest): string {
  const text = (v: string | undefined) => v?.trim() || null;
  const canonical = {
    guestName: request.guestName,
    phone: text(request.phone), email: text(request.email),
    checkIn: request.checkIn ?? null, checkOut: request.checkOut ?? null,
    groupName: text(request.groupName), blockCode: text(request.blockCode),
    bookingSourceId: request.bookingSourceId ?? null,
    source: text(request.source),
    businessSource: text(request.businessSource),
    marketSegment: text(request.marketSegment),
    expectedArrival: text(request.expectedArrival),
    lines: request.lines.map((l) => ({
      roomTypeId: l.roomTypeId ?? null,
      mealPlan: l.mealPlan ?? "EP",
      adults: l.adults ?? 1,
      children: l.children ?? 0,
      rooms: Math.max(1, l.rooms ?? 1),
      agreedRate: l.agreedRate ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/* ── Is a room free for every night of it? ─────────────────────────
   Asked only of a machine (`refuseWhenFull`), and asked BEFORE anything is
   written, so a booking that is refused leaves nothing behind - not even the
   guest (D17-80). The same figure the Inventory grid shows a person, and the
   night of departure is not counted: that room is free again. */
async function noRoomFor(client: Client, request: BookingRequest): Promise<string | null> {
  const wanted = new Map<string, number>();
  for (const line of request.lines) {
    if (!line.roomTypeId) continue;
    wanted.set(line.roomTypeId,
      (wanted.get(line.roomTypeId) ?? 0) + Math.max(1, line.rooms ?? 1));
  }
  for (const [roomTypeId, rooms] of wanted) {
    const { rows } = await client.query<{ name: string; short: number }>(
      `select rt.name, coalesce(min(g.available), 0)::int as short
         from app.inventory_grid($1, $2::date, ($3::date - 1)) g
         join room_types rt on rt.id = g.room_type_id
        where g.room_type_id = $4
        group by rt.name`,
      [request.hotelId, request.checkIn, request.checkOut, roomTypeId]);
    const row = rows[0];
    if (!row || row.short < rooms) {
      const name = row?.name ?? "That room type";
      return `${name} has no room free for every night from ${request.checkIn} to ${request.checkOut}.`;
    }
  }
  return null;
}

/* ── The desk's fields, checked (Phase 1, D27-33) ───────────────────
   Every one of these refuses BEFORE the first write (MEMORY 243), and the
   screen only reflects what is decided here: a complimentary room, the
   discount and the company are money. */

interface DeskTerms {
  /** The percent taken off every paid night, and how it was allowed. */
  discount: {
    percent: number | null; reason: string | null; promotionId: string | null;
    /* ₹ off each night (191); free-hand up to `cap`% of the night. */
    amount?: number | null; cap?: number;
  } | null;
  companyId: string | null;
  title: string | null;
  nationality: string | null;
}

const text = (v: string | undefined): string | null => v?.trim() || null;

/** Does the signed-in person hold one of these roles at THIS hotel? A group
    administrator is the owner everywhere.
    ponytail: the fifth copy (reputation, purchasing, guest messages and
    equipment keep one each); one shared helper when the core offers it. */
export async function holdsRoleAt(
  client: Client, hotelId: string, roles: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (select 1 from staff s
                     where s.id = app.current_user_id() and s.is_active and s.is_group_admin)
         or exists (select 1 from staff_hotels sh join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id() and sh.hotel_id = $1
                       and s.is_active and sh.role = any($2::text[])) as may`,
    [hotelId, roles]);
  return rows[0]?.may === true;
}

async function deskTerms(
  client: Client, request: BookingRequest, lines: BookingLineInput[],
): Promise<DeskTerms | BookingRefused> {
  const hotelId = request.hotelId;

  if (lines.some((l) => l.complimentary === true)) {
    if (!(await holdsRoleAt(client, hotelId, COMP_ROLES))) {
      return refuse(
        "A complimentary room is given by the owner, an administrator or the "
        + "general manager. Ask one of them.");
    }
  }

  let discount: DeskTerms["discount"] = null;
  const d = request.discount;
  if (d?.promotionId) {
    const { rows } = await client.query<{ percent: number | null; amount: number | null }>(
      `select percent::float8 as percent, amount::float8 as amount from room_promotions
        where id = $1 and hotel_id = $2 and is_active`,
      [d.promotionId, hotelId]);
    if (!rows[0]) return refuse("That promotion is not on this hotel's list any more.");
    discount = { percent: rows[0].percent, amount: rows[0].amount,
                 reason: text(d.reason), promotionId: d.promotionId };
  } else if (d?.percent !== undefined && d.percent !== null) {
    const percent = Number(d.percent);
    const { rows } = await client.query<{ cap: string }>(
      "select app.pos_freehand_discount_cap()::text as cap");
    const cap = Number(rows[0]!.cap);
    if (!Number.isFinite(percent) || percent <= 0) {
      return refuse("A discount is a percentage above 0.");
    }
    if (percent > cap) {
      return refuse(
        `A discount over ${cap}% is given only through a named promotion. `
        + `Up to ${cap}% can be given here with a reason.`);
    }
    if (!text(d.reason)) return refuse("Say why the discount is given.");
    discount = { percent, reason: text(d.reason), promotionId: null };
  } else if (d?.amount !== undefined && d.amount !== null) {
    /* ₹ OFF EACH NIGHT (191, the owner's D27-259 Q4): the cap is checked
       against each night's rate below, where the rate is known. */
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || amount <= 0) return refuse("A discount in rupees is above ₹0.");
    if (!text(d.reason)) return refuse("Say why the discount is given.");
    const { rows } = await client.query<{ cap: string }>(
      "select app.pos_freehand_discount_cap()::text as cap");
    discount = { percent: null, amount, cap: Number(rows[0]!.cap), reason: text(d.reason), promotionId: null };
  }

  let companyId: string | null = null;
  if (request.companyId) {
    const { rows } = await client.query(
      "select 1 from companies where id = $1 and is_active", [request.companyId]);
    if (!rows[0]) return refuse("That company is not on the list any more.");
    companyId = request.companyId;
  }

  const title = text(request.title);
  if (title !== null && !(TITLES as readonly string[]).includes(title)) {
    return refuse(`A title is ${TITLES.join(", ")} or none.`);
  }
  const nationality = text(request.nationality)?.toUpperCase() ?? null;
  /* BK-4: a real country, not only two letters - "ZZ" fed Form III. */
  const noCountry = countryProblem(nationality);
  if (noCountry) return refuse(noCountry);

  return { discount, companyId, title, nationality };
}

/* ── The booking itself ───────────────────────────────────────────── */

export async function makeBooking(
  client: Client, request: BookingRequest,
): Promise<BookingResult> {
  const lines = request.lines.filter((l) => l.roomTypeId);
  const externalRef = request.externalRef ?? null;
  const fingerprint = externalRef ? fingerprintOf(request) : null;
  const sourceId = request.bookingSourceId;
  const hotelId = request.hotelId;
  const total = lines.reduce((n, l) => n + Math.max(1, l.rooms ?? 1), 0);

  /* ── What every caller is asked, in the same words ────────────────
     These were the HTTP route's checks. They are here so a machine cannot
     make a booking a person could not: no name, no nights, no rooms, no
     channel, or four hundred rooms from a typed quantity. */
  if (!request.guestName?.trim()) return refuse("Whose booking is it?");
  if (!request.checkIn || !request.checkOut) return refuse("Which nights?");
  const badDate = dateProblem(request.checkIn) ?? dateProblem(request.checkOut);
  if (badDate) return refuse(badDate);
  /* A DAY USE (the owner's D27-227): out the day it comes, check-out =
     check-in, saved as one (is_day_use, 015) and charged its day at check-in.
     Only a departure BEFORE the arrival is refused now. */
  if (request.checkOut < request.checkIn) {
    return refuse(
      "A stay ends after it starts. The night of departure is not charged, "
      + "so a guest leaving on the 5th has their last night on the 4th.");
  }
  const dayUse = request.checkOut === request.checkIn;
  /* FD-6 (the owner, 28 September; D27-197): at most 90 nights, as the
     walk-in desk held it and Change dates does. */
  const tooLong = countProblem(
    (Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000,
    "Nights", dayUse ? 0 : 1, MAX_NIGHTS);
  if (tooLong) return refuse(tooLong);
  if (lines.length === 0) return refuse("Which rooms?");
  if (!sourceId) {
    return refuse(
      "Where did this booking come from? Pick the channel - it is what "
      + "the source-mix report counts, and it cannot be filled in later.");
  }
  if (total > 40) {
    /* Not a policy - a guard against a typo in the quantity box turning into
       four hundred reservations nobody can undo one at a time. */
    return refuse(
      `${total} rooms in one booking looks like a mistake. Split it, or say `
      + "so and it can be raised.");
  }
  /* The lead's campaign (D27-170): leads' 161 holds it to 200 characters,
     trimmed. Asked here, before any write, so it is a sentence and not a
     constraint thrown after the rooms are made (MEMORY 243). */
  if ((request.campaign?.trim().length ?? 0) > 200) {
    return refuse("A campaign is at most 200 characters.");
  }
  /* 231 holds it to 500. */
  if ((request.specialRequest?.trim().length ?? 0) > 500) {
    return refuse("A special request is at most 500 characters.");
  }
  if (externalRef !== null && (externalRef.trim() === "" || externalRef.length > 100)) {
    return refuse(
      "externalRef must be your own reference for this booking, as text, "
      + "no longer than 100 characters.");
  }

  /* THE HOTEL MAY TAKE THE DESK'S OVERBOOKING AWAY (the owner's D27-243 3.2):
     on by default, as D17-43 had it; off, the desk's booking - a group's
     too, whole or not at all - is refused past a full house like a
     machine's. */
  const deskMayOverbook = request.refuseWhenFull ? false : (await client.query<{ yes: boolean }>(
    "select desk_may_overbook as yes from hotels where id = $1", [request.hotelId])).rows[0]?.yes ?? true;
  if (request.refuseWhenFull || !deskMayOverbook) {
    const full = await noRoomFor(client, { ...request, lines });
    if (full) return { ok: false, kind: "no_room", reason: full };
  }

    /* ⚠ ALREADY RECEIVED? Asked before anything is written, and before the
       channel is checked: a source switched off since the first request must
       not turn a retry into a refusal of a booking that exists. This is the
       courteous answer; the unique index on line 1 is the guarantee, and a
       copy racing this one past the check is caught at the bottom. */
    if (externalRef && fingerprint) {
      const earlier = await alreadyReceived(client, hotelId, sourceId, externalRef);
      if (earlier.length > 0) return answerRepeat(earlier, externalRef, fingerprint);
    }

    /* BK-3 (the owner, 28 September): nothing arrives before the hotel's
       business date - the QA confirmed a booking that "arrived" five days
       ago. A booking site's late message is refused too, so it lands on
       Channel bookings as needing attention, not lost. Below the repeat
       check: a retry of a booking already made is answered, not refused,
       after the night audit has moved the date. */
    const { rows: today } = await client.query<{ d: string }>(
      "select app.business_date($1)::text as d", [hotelId]);
    if (request.checkIn < today[0]!.d) {
      return refuse(
        `The arrival, ${request.checkIn}, is before the hotel's business date, `
        + `${today[0]!.d}. A booking starts on the business date or later.`);
    }

    /* ⚠ EVERY REFUSAL GOES ABOVE THE FIRST WRITE (RES-1). `withSession`
       commits whatever the callback returns, a refusal included, so a
       refusal below an insert keeps the insert. This route wrote the guest
       and the group first and could then refuse four ways — a channel
       switched off, a room type not here, a party too big, a line with no
       price — and in a booking of several room types the earlier lines'
       rooms were already confirmed, with open folios, holding inventory.
       The caller saw ok:false and tried again, and every try added more.
       The walk-in desk had the same fault (root MEMORY 243) and is fixed
       the same way: read and check everything, then write. */

    /* ⚠ THE COMMISSION IS READ ONCE AND COPIED ONTO EVERY ROOM. Read
       per room it would be the same number four times; read at report
       time it would be whatever was agreed later. 082 explains the
       choice — a report about March must not change because of
       something negotiated in April.

       NULL when no rate has been agreed with this source at this
       property, and NULL is what gets stored. Not zero: zero would
       claim the booking cost nothing in commission. */
    const { rows: src } = await client.query<{
      name: string; commission_pct: string | null;
    }>(
      `select bs.name, r.commission_pct::text as commission_pct
         from booking_sources bs
         left join booking_source_rates r
                on r.booking_source_id = bs.id and r.hotel_id = $2
        where bs.id = $1 and bs.is_active`,
      [request.bookingSourceId, hotelId]);
    if (!src[0]) {
      return refuse(
        "That booking source is not on the list any more. A manager can "
        + "switch it back on under Property setup → Booking sources.");
    }
    const commission = src[0].commission_pct;

    const terms = await deskTerms(client, request, lines);
    if ("ok" in terms) return terms;

    /* THE COMPANY'S CONTRACT (D27-184). A booking naming a company is made
       under its contract in force on the arrival date (C-3): the contract
       prices a line with no typed rate, its commission replaces the
       source's (C-8), and the booking keeps which contract it was. */
    const { rows: under } = terms.companyId
      ? await client.query<{ id: string; commission_pct: string | null }>(
        `select id::text, commission_pct::text
           from app.contract_in_force($1, $2, $3::date)`,
        [terms.companyId, hotelId, request.checkIn])
      : { rows: [] };
    const contract = under[0] ?? null;

    /* EVERY LINE IS PRICED AND FITTED BEFORE ANY IS BOOKED. A refusal on
       the second room type must find nothing of the first on file. */
    const planned: {
      line: BookingLineInput; typeName: string; adults: number; children: number;
      rate: number;
    }[] = [];

    for (const line of lines) {
      const { rows: rt } = await client.query<{
        name: string; max: number; max_adults: number | null; max_children: number | null;
        off: boolean; not_sold: boolean;
      }>(`select rt.name, rt.max_occupancy as max, rt.max_adults, rt.max_children,
                /* P3 (D27-258 Q3, Q4): a plan switched Off is not offered for new
                   bookings, and one whose sources are chosen is sold by those only. */
                coalesce((select not s.is_active from rate_plan_settings s
                           where s.room_type_id = rt.id and s.meal_plan = $3), false) as off,
                exists (select 1 from rate_plan_sources p where p.room_type_id = rt.id and p.meal_plan = $3)
                  and not exists (select 1 from rate_plan_sources p where p.room_type_id = rt.id
                                     and p.meal_plan = $3 and p.booking_source_id = $4::uuid) as not_sold
           from room_types rt
          where rt.id = $1 and rt.hotel_id = $2`,
        [line.roomTypeId, hotelId, line.mealPlan ?? "EP", sourceId ?? null]);
      if (!rt[0]) return refuse("One of those room types is not here.");

      const adults = line.adults ?? 1;
      const children = line.children ?? 0;
      /* X-3 (round D): 0 adults or -1 children reached the database's own
         check and came back as "Something went wrong". */
      const count = countProblem(adults, "Adults", 1) ?? countProblem(children, "Children", 0);
      if (count) return refuse(count);
      if (adults + children > rt[0].max) {
        return refuse(
          `${adults + children} people will not fit a ${rt[0].name} - it `
          + `sleeps ${rt[0].max}.`);
      }
      /* P3 (D27-258 Q1): the type's own limits for adults and children. */
      if (rt[0].max_adults !== null && adults > rt[0].max_adults) {
        return refuse(`A ${rt[0].name} takes ${rt[0].max_adults} adults at most.`);
      }
      if (rt[0].max_children !== null && children > rt[0].max_children) {
        return refuse(`A ${rt[0].name} takes ${rt[0].max_children} ${rt[0].max_children === 1 ? "child" : "children"} at most.`);
      }
      if (rt[0].off) {
        return refuse(`${rt[0].name} on ${line.mealPlan ?? "EP"} is switched off for new bookings.`);
      }
      if (rt[0].not_sold) {
        return refuse(`${rt[0].name} on ${line.mealPlan ?? "EP"} is not sold through this source.`);
      }

      /* The FIRST night's tariff, and the clerk sees the whole breakdown
         before submitting. agreed_rate is one number the audit posts every
         night — that is what "snapshotted at booking" means — so a stay
         crossing a season is charged what was agreed, not what the calendar
         says on night four. */
      /* A COMPLIMENTARY ROOM IS ₹0 AND NEEDS NO PRICE: the night audit posts
         nothing for it (020), and an unpriced calendar does not stop a gift. */
      let rate = line.complimentary === true ? 0 : line.agreedRate ?? null;
      /* A DAY USE'S PRICE IS TYPED, EVERY TIME (the owner's D27-229): there is
         no day rate to look up and the night's tariff is not one - never
         filled in, never a zero. Any role that may book may type it. */
      if (dayUse && line.complimentary !== true && !(rate !== null && rate > 0)) {
        return refuse("Type the day-use price.");
      }
      /* The contract's own figure priced this line (D27-233): before GST. */
      let byContract = false;
      if (rate === null) {
        /* Under a contract, its price - or, where it has no figure for this
           room type and plan, the calendar's (C-4), inside the same function. */
        const { rows: t } = await client.query<{
          total: string | null; unpriced: string | null; from_contract: boolean;
        }>(
          contract
            ? `select total::text, unpriced, from_contract
                 from app.contract_price($6::uuid,$1,$2,$3::date,$4,$5)`
            : `select total::text, unpriced, false as from_contract
                 from app.tariff_for($1,$2,$3::date,$4,$5)`,
          [line.roomTypeId, line.mealPlan ?? "EP", request.checkIn,
           adults, children, ...(contract ? [contract.id] : [])]);
        if (t[0]?.total === null || t[0]?.total === undefined) {
          /* NEVER A ZERO. A machine is told "unpriced" by name, so the channel
             manager can say which nights need a price rather than selling the
             room for nothing (D17-49). */
          return {
            ok: false, kind: "unpriced",
            reason: `${rt[0].name} has no price for ${t[0]?.unpriced ?? "this party"}. `
              + "Set it on Rates, or enter a rate for this booking.",
          };
        }
        rate = Number(t[0].total);
        byContract = t[0].from_contract;
      }

      /* A RATE THAT INCLUDES GST (D27-187, D27-195) is split here, before it is
         kept: agreed_rate is the rate before GST the audit posts, and its GST
         by the slab adds back to the figure (finance's one split). The typed
         rate, or with none typed the list price the tariff gave (D27-199) -
         never a contract's rate, which is before GST already (D27-233). */
      if (rate > 0 && line.rateIncludesGst === true && !byContract) {
        const split = await roomRateBeforeGst(client, hotelId, rate);
        if (!split.ok) return refuse(split.reason);
        rate = split.pre;
      }

      /* THE DISCOUNT LOWERS THE ONE FIGURE THE BOOKING KEEPS, rounded to the
         paisa by Postgres, so the audit, the tax slab and finance's bill
         (app.stay_bill) all follow from it with no second sum (D27-36). */
      if (terms.discount?.amount != null && rate > 0) {
        /* ₹ OFF EACH NIGHT (191, D27-259 Q4): free-hand up to the cap's share
           of the night with a reason; more only by a named promotion. */
        const off = terms.discount.amount;
        if (terms.discount.cap !== undefined && off > rate * terms.discount.cap / 100) {
          return refuse(
            `₹${off} off is more than ${terms.discount.cap}% of the night's ₹${rate}. `
            + "More is given only through a named promotion.");
        }
        if (off >= rate) return refuse(`₹${off} off would leave nothing of the night's ₹${rate}.`);
        rate = Math.round((rate - off) * 100) / 100;
      } else if (terms.discount && rate > 0) {
        const { rows: after } = await client.query<{ rate: string }>(
          "select round($1::numeric * (100 - $2::numeric) / 100, 2)::text as rate",
          [rate, terms.discount.percent]);
        rate = Number(after[0]!.rate);
      }

      planned.push({ line, typeName: rt[0].name, adults, children, rate });
    }

    /* ── THE RETURNING GUEST, the last refusal (D21-20). ────────────────
       The clerk said "same person". The database asks again whether the
       phone or email typed still suggests exactly that person, and only
       then fills a blank phone or email on their record from what was
       typed - it writes NOTHING when it refuses, so this refusal is still
       above the first write (RES-1). Nothing on file is overwritten. */
    let guestId: string | null = null;
    let guestName = request.guestName;
    if (request.guestId) {
      const { rows: same } = await client.query<{ id: string | null; name: string | null }>(
        `select u.id::text, g.full_name as name
           from (select app.use_returning_guest($1::uuid, $2, $3) as id) u
           left join guests g on g.id = u.id`,
        [request.guestId, request.phone ?? null, request.email ?? null]);
      if (!same[0]?.id) {
        return refuse(
          "That guest no longer matches the phone or email typed. Check the "
          + "suggestion again, or book them as a new guest.");
      }
      guestId = same[0].id;
      guestName = same[0].name ?? guestName;
    }

    /* ── OVER THE COMPANY'S CREDIT LIMIT (the owner's D27-275), the last
       refusal: an allowance is written when a GM allows it (MEMORY 243).
       What the booking bills: every room's nights at its rate, with the
       room's GST. ponytail: no GST rule set counts as none here. */
    if (terms.companyId) {
      const nights = dayUse ? 1
        : Math.round((Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000);
      const { rows: [bill] } = await client.query<{ total: string }>(
        `select coalesce(sum(l.rooms * $2::int * (l.rate
                  + round(l.rate * coalesce(app.gst_rate_or_null($1, 'room', l.rate), 0) / 100.0, 2))), 0)::text as total
           from jsonb_to_recordset($3::jsonb) as l(rooms int, rate numeric)`,
        [hotelId, nights, JSON.stringify(planned.map((p) => ({ rooms: Math.max(1, p.line.rooms ?? 1), rate: p.rate })))]);
      const over = await overCreditLimit(client, hotelId, terms.companyId, Number(bill!.total), {
        reason: request.overLimitReason,
        title: `booking for ${guestName}, ${request.checkIn} to ${request.checkOut}`,
      });
      if (over) return { ok: false, kind: "refused", ...over };
    }

    /* ── Nothing below this line refuses. ─────────────────────────────── */

    /* One guest for the whole booking. A block belongs to whoever made it;
       individual names are filled in as the rooming list arrives, which is
       usually days later and often never for a wedding. */
    if (!guestId) {
      const { rows: guest } = await client.query<{ id: string }>(
        `insert into guests (full_name, phone, email, title, nationality)
         values ($1, nullif($2,''), nullif($3,''), $4, coalesce($5, 'IN'))
         returning id::text`,
        [request.guestName, request.phone?.trim() ?? "", request.email?.trim() ?? "",
         terms.title, terms.nationality]);
      guestId = guest[0]!.id;
    } else if (terms.title) {
      /* A returning guest's record is filled, never overwritten: the title
         only where none is on file, as the phone and email are. */
      await client.query(
        "update guests set title = $2 where id = $1 and title is null",
        [guestId, terms.title]);
    }

    let groupId: string | null = null;
    if (total > 1) {
      const { rows: g } = await client.query<{ id: string }>(
        `insert into reservation_groups (name, block_code, lead_hotel_id)
         values ($1, nullif($2,''), $3) returning id::text`,
        [request.groupName?.trim() || `${request.guestName} - ${total} rooms`,
         request.blockCode?.trim() ?? "", hotelId]);
      groupId = g[0]!.id;
    }

    const made: { id: string; reference: string; roomType: string; rate: number }[] = [];
    /* The rows themselves, for a caller in process: the channel manager
       records which reservations a pushed booking became, so the inbox can
       say what happened to it (D17-79). Over HTTP they are not sent - a
       booking is named by its reference, which is what a person reads. */
    const reservationIds: string[] = [];
    const folioIds: string[] = [];

    for (const { line, typeName, adults, children, rate } of planned) {
      for (let i = 0; i < Math.max(1, line.rooms ?? 1); i += 1) {
        /* ONE REFERENCE, FROM ONE PLACE (RES-2, 092). FH-<hotel code>-<YYMM>-
           <number>, the month on the hotel's own clock — the owner's format of
           16 September. This was an inline copy of the generator: no lock,
           so two bookings in the same second built the same reference and
           the second was a 500; DDMM, so `FH-2608-…` meant the 26th here and
           August at the desk; and lpad, which CUTS a number past four digits.

           ⚠ IN THIS TRANSACTION, BEFORE THIS INSERT. app.next_reference takes
           a per-hotel lock held until the transaction ends, and the next
           caller waits there and then sees this row. Asked anywhere else —
           a separate query, before withSession — the lock would be gone
           before the row it protects exists. */
        const { rows: ref } = await client.query<{ reference: string }>(
          "select app.next_reference($1) as reference", [hotelId]);

        const { rows: booked } = await client.query<{ id: string }>(
          `insert into reservations
             (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
              adults, children, occupancy, agreed_rate, status, source,
              meal_plan, group_id, business_source, market_segment,
              expected_arrival, booking_source_id, commission_pct,
              ota_reference, ota_line, ota_fingerprint, whatsapp_agreed,
              is_complimentary, expected_departure, sales_person, company_id,
              discount_percent, discount_reason, room_promotion_id, discount_amount,
              notes, special_request, is_single_lady, contract_id, prepaid_on_site,
              -- WHO MADE IT (RES-14, the owner's D27-239): the person signed
              -- in, or null for a machine's booking. It was never written.
              created_by)
           values ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$30,$11,
                   $12,$13,$14,$15,$16::time,$17,$18::numeric,
                   $19,$20,$21,$22,
                   $23,$24::time,$25,$26,$27::numeric,$28,$29,$35::numeric,
                   $31,$36,$32,$33::uuid, coalesce($34::boolean, true),
                   app.current_user_id())
           returning id::text`,
          [hotelId, ref[0]!.reference, guestId, line.roomTypeId,
           request.checkIn, request.checkOut, adults, children, adults + children,
           /* The legacy column keeps the source's NAME rather than a
              second free-text answer. Two fields describing one fact is
              how they drift; this one is now derived from the other and
              stays only because reports written before 082 read it. */
           rate, request.source?.trim() || src[0].name,
           line.mealPlan ?? "EP", groupId,
           /* Blank stays NULL, never "" — an empty segment would sort as its
              own category in the source-mix report and read as an answer. */
           request.businessSource?.trim() || null,
           request.marketSegment?.trim() || null,
           /* NULL when they did not say, which is most bookings. Never
              midnight — nothing should hold a room against a time
              nobody gave. */
           request.expectedArrival?.trim() || null,
           request.bookingSourceId,
           /* C-8: the contract's commission, when it has one. */
           contract?.commission_pct ?? commission,
           /* All NULL for the desk. For a sender, every room carries its
              reference and its place in the request — line 1 is the one two
              racing copies collide on (091). */
           externalRef, externalRef ? made.length + 1 : null, fingerprint,
           /* Every room of the booking carries the guest's answer. */
           request.whatsappAgreed === true,
           line.complimentary === true,
           request.expectedDeparture?.trim() || null,
           request.salesPerson?.trim() || null,
           terms.companyId,
           /* A gift is not discounted - there is nothing to take off. */
           line.complimentary === true || rate === 0 ? null : terms.discount?.percent ?? null,
           line.complimentary === true || rate === 0 ? null : terms.discount?.reason ?? null,
           line.complimentary === true || rate === 0 ? null : terms.discount?.promotionId ?? null,
           request.tentative === true ? "tentative" : "confirmed",
           text(request.notes), request.isSingleLady === true, contract?.id ?? null,
           typeof request.prepaidOnSite === "boolean" ? request.prepaidOnSite : null,
           line.complimentary === true || rate === 0 ? null : terms.discount?.amount ?? null,
           text(request.specialRequest)],
        );

        /* A BOOKING NEEDS SOMEWHERE TO PUT MONEY, from the moment it
           exists. Nothing created a folio for a reservation made here:
           the walk-in opened one and this did not, so a guest booked
           through the interface was checked in with nowhere to bill —
           the till could not charge their room, and check-out had
           nothing to settle.

           At BOOKING rather than at check-in, because most guests here
           pay a token amount when they book. A deposit taken before
           arrival needs a folio to land in, and one created at arrival
           is a day too late. */
        const { rows: folio } = await client.query<{ id: string }>(
          `insert into folios (hotel_id, reservation_id, status)
           values ($1, $2, 'open') returning id::text`,
          [hotelId, booked[0]!.id]);
        made.push({ id: booked[0]!.id, reference: ref[0]!.reference, roomType: typeName,
                    rate: Number(rate) });
        reservationIds.push(booked[0]!.id);
        folioIds.push(folio[0]!.id);
      }
    }

    /* THE LEAD'S CAMPAIGN (D27-170), on every room of it. Its own statement,
       and only when there is one: the column is the leads lane's (164). */
    const campaign = text(request.campaign);
    if (campaign) {
      await client.query(
        "update reservations set campaign = $1 where id = any($2::uuid[])",
        [campaign, reservationIds]);
    }

    /* WHERE THEY LIVE, beside the ID documents where 013 keeps an address.
       After the rooms, because updating a returning guest's row needs a
       booking at this property (026). Blanks on file are filled; nothing
       on file is overwritten - the check-in is where it is corrected. */
    const a = request.address ?? {};
    const address = [a.addressLine, a.city, a.state, a.pincode, a.country].map(text);
    if (address.some((v) => v !== null)) {
      await client.query(
        `insert into guest_documents (guest_id, address_line, city, state, pincode, country)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (guest_id) do update set
           address_line = coalesce(guest_documents.address_line, excluded.address_line),
           city         = coalesce(guest_documents.city,         excluded.city),
           state        = coalesce(guest_documents.state,        excluded.state),
           pincode      = coalesce(guest_documents.pincode,      excluded.pincode),
           country      = coalesce(guest_documents.country,      excluded.country),
           updated_at   = now()`,
        [guestId, ...address]);
    }

    return {
      ok: true as const,
      /* Made here and now, not found already made (RES-3). */
      duplicate: false,
      status: request.tentative === true ? "tentative" : "confirmed",
      groupId,
      rooms: made.length,
      /* The returning guest's name as it stands on file, when the clerk
         confirmed one - that is whose booking it now is. */
      guest: guestName,
      bookings: made,
      nightly: made.reduce((sum, m) => sum + m.rate, 0),
      reservationIds,
      folioIds,
      guestId,
    };
}

