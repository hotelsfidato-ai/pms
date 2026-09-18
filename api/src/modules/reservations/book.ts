import { createHash } from "node:crypto";
import type { Client } from "../../db.ts";

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
}

export interface BookingMade {
  ok: true;
  duplicate: boolean;
  groupId: string | null;
  rooms: number;
  guest: string;
  bookings: Array<{ reference: string; roomType: string; rate: number }>;
  nightly: number;
  /** The rows, for a caller in process. Empty on a repeat: nothing was made
      this time, and the references above say which booking it already is. */
  reservationIds: string[];
  folioIds: string[];
  guestId: string | null;
}

export interface BookingRefused {
  ok: false;
  /** "no_room" only ever comes back to a machine - see refuseWhenFull. */
  kind: "refused" | "no_room" | "unpriced";
  reason: string;
}

export type BookingResult = BookingMade | BookingRefused;

const refuse = (reason: string): BookingRefused => ({ ok: false, kind: "refused", reason });

/* ── A booking this channel already sent (RES-3) ──────────────────── */

type Received = {
  reference: string;
  room_type: string;
  agreed_rate: string;
  group_id: string | null;
  guest: string;
  ota_fingerprint: string | null;
};

export async function alreadyReceived(
  client: Client, hotelId: string, sourceId: string | undefined,
  externalRef: string,
): Promise<Received[]> {
  const { rows } = await client.query<Received>(
    `select r.reference, rt.name as room_type, r.agreed_rate::text,
            r.group_id::text, g.full_name as guest, r.ota_fingerprint
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
    reference: r.reference, roomType: r.room_type, rate: Number(r.agreed_rate),
  }));
  return {
    ok: true,
    duplicate: true,
    groupId: earlier[0]!.group_id,
    rooms: bookings.length,
    guest: earlier[0]!.guest,
    bookings,
    nightly: bookings.reduce((sum, b) => sum + b.rate, 0),
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
  if (request.checkOut <= request.checkIn) {
    return refuse(
      "A stay ends after it starts. The night of departure is not charged, "
      + "so a guest leaving on the 5th has their last night on the 4th.");
  }
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
  if (externalRef !== null && (externalRef.trim() === "" || externalRef.length > 100)) {
    return refuse(
      "externalRef must be your own reference for this booking, as text, "
      + "no longer than 100 characters.");
  }

  if (request.refuseWhenFull) {
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
      return refuse("That booking source is not on the list any more.");
    }
    const commission = src[0].commission_pct;

    /* EVERY LINE IS PRICED AND FITTED BEFORE ANY IS BOOKED. A refusal on
       the second room type must find nothing of the first on file. */
    const planned: {
      line: BookingLineInput; typeName: string; adults: number; children: number;
      rate: number;
    }[] = [];

    for (const line of lines) {
      const { rows: rt } = await client.query<{
        name: string; max: number;
      }>(`select name, max_occupancy as max from room_types
           where id = $1 and hotel_id = $2`, [line.roomTypeId, hotelId]);
      if (!rt[0]) return refuse("One of those room types is not here.");

      const adults = line.adults ?? 1;
      const children = line.children ?? 0;
      if (adults + children > rt[0].max) {
        return refuse(
          `${adults + children} people will not fit a ${rt[0].name} - it `
          + `sleeps ${rt[0].max}.`);
      }

      /* The FIRST night's tariff, and the clerk sees the whole breakdown
         before submitting. agreed_rate is one number the audit posts every
         night — that is what "snapshotted at booking" means — so a stay
         crossing a season is charged what was agreed, not what the calendar
         says on night four. */
      let rate = line.agreedRate ?? null;
      if (rate === null) {
        const { rows: t } = await client.query<{
          total: string | null; unpriced: string | null;
        }>(
          `select total::text, unpriced
             from app.tariff_for($1,$2,$3::date,$4,$5)`,
          [line.roomTypeId, line.mealPlan ?? "EP", request.checkIn,
           adults, children]);
        if (t[0]?.total === null || t[0]?.total === undefined) {
          /* NEVER A ZERO. A machine is told "unpriced" by name, so the channel
             manager can say which nights need a price rather than selling the
             room for nothing (D17-49). */
          return {
            ok: false, kind: "unpriced",
            reason: `${rt[0].name} has no price for ${t[0]?.unpriced ?? "this party"}. `
              + "Set it on the rate calendar, or enter a rate for this booking.",
          };
        }
        rate = Number(t[0].total);
      }

      planned.push({ line, typeName: rt[0].name, adults, children, rate });
    }

    /* ── Nothing below this line refuses. ─────────────────────────────── */

    /* One guest for the whole booking. A block belongs to whoever made it;
       individual names are filled in as the rooming list arrives, which is
       usually days later and often never for a wedding. */
    const { rows: guest } = await client.query<{ id: string }>(
      `insert into guests (full_name, phone, email)
       values ($1, nullif($2,''), nullif($3,''))
       returning id::text`,
      [request.guestName, request.phone?.trim() ?? "", request.email?.trim() ?? ""]);
    const guestId = guest[0]!.id;

    let groupId: string | null = null;
    if (total > 1) {
      const { rows: g } = await client.query<{ id: string }>(
        `insert into reservation_groups (name, block_code, lead_hotel_id)
         values ($1, nullif($2,''), $3) returning id::text`,
        [request.groupName?.trim() || `${request.guestName} - ${total} rooms`,
         request.blockCode?.trim() ?? "", hotelId]);
      groupId = g[0]!.id;
    }

    const made: { reference: string; roomType: string; rate: number }[] = [];
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
              ota_reference, ota_line, ota_fingerprint)
           values ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,'confirmed',$11,
                   $12,$13,$14,$15,$16::time,$17,$18::numeric,
                   $19,$20,$21)
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
           request.bookingSourceId, commission,
           /* All NULL for the desk. For a sender, every room carries its
              reference and its place in the request — line 1 is the one two
              racing copies collide on (091). */
           externalRef, externalRef ? made.length + 1 : null, fingerprint],
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
        made.push({ reference: ref[0]!.reference, roomType: typeName,
                    rate: Number(rate) });
        reservationIds.push(booked[0]!.id);
        folioIds.push(folio[0]!.id);
      }
    }

    return {
      ok: true as const,
      /* Made here and now, not found already made (RES-3). */
      duplicate: false,
      groupId,
      rooms: made.length,
      guest: request.guestName,
      bookings: made,
      nightly: made.reduce((sum, m) => sum + m.rate, 0),
      reservationIds,
      folioIds,
      guestId,
    };
}

