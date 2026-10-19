import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { emailProblem, phoneProblem } from "../../validate.ts";
import {
  makeBooking, alreadyReceived, answerRepeat, fingerprintOf, isUniqueViolation,
  type BookingRequest, type BookingLineInput, type BookingDiscount, type BookingAddress,
} from "./book.ts";

/* ══════════════════════════════════════════════════════════════════
   GROUPS — twelve rooms and one host

   A wedding block. The host settles the accommodation; every guest
   pays their own bar tab. That was never a choice between one folio
   and twelve — 006 built `folios` many-per-reservation from the start
   and made `reservation_id` nullable precisely so a master could
   exist. 056 added the other end of the link and the routing switch.

   TWO BALANCES, NEVER ONE. What the host owes and what the guests owe
   are different debts settled by different people, and adding them
   into a single figure hides which half anybody is being asked for.
   ══════════════════════════════════════════════════════════════════ */

export const groups = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The list lives in stays.ts ────────────────────────────────────
   `GET /:code/groups` was already answered there, and `stays` is mounted
   BEFORE this file — so a second copy here would never have run, and the
   older one would have kept answering while this one looked correct in
   the source. rates.ts carries the same warning about `/:code/rates`, and
   I walked into it anyway: the first probe of this file returned a shape
   nothing in it produces.

   The existing route gained the master balance rather than being
   duplicated. What is here is what it did not answer: one group in
   detail, the master folio, and who pays for which room. */

/* ── One group ─────────────────────────────────────────────────── */

groups.get("/:code/groups/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows: g } = await client.query<{
      name: string; block_code: string | null; company: string | null;
      notes: string | null; lead: string | null;
    }>(
      `select g.name, g.block_code, co.name as company, g.notes,
              app.group_lead(g.id)::text as lead
         from reservation_groups g
         left join companies co on co.id = g.company_id
        where g.id = $1`,
      [groupId],
    );
    if (!g[0]) return refuse("No such group.");

    const { rows: rooms } = await client.query<{
      reservation_id: string; reference: string; guest: string;
      room: string | null; room_type: string;
      check_in: string; check_out: string; nights: number;
      status: string; agreed_rate: string; routed: boolean; balance: string;
      adults: number; children: number;
    }>(
      `select reservation_id::text, reference, guest, room, room_type,
              check_in::text, check_out::text, nights, status,
              agreed_rate::text, routed, balance::text, adults, children
         from app.group_rooms($1, $2)`,
      [hotelId, groupId],
    );

    const { rows: master } = await client.query<{
      id: string; status: string; balance: string;
      company: string | null; invoice: string | null;
    }>(
      /* Who the bill is addressed to, and its tax invoice while one stands
         (issued and not credited, as finance asks it): the page's Settle and
         Issue tax invoice (D27-305 (10)). */
      `select f.id::text, f.status,
              coalesce((select sum(fp.amount + fp.tax_amount)
                          from folio_postings fp where fp.folio_id = f.id), 0)::text
                as balance,
              co.name as company,
              (select i.number from invoices i
                where i.folio_id = f.id and i.credits_id is null
                  and not exists (select 1 from invoices cn where cn.credits_id = i.id)
                order by i.issued_at desc limit 1) as invoice
         from folios f
         left join companies co on co.id = f.company_id
        where f.group_id = $1 and f.hotel_id = $2 and f.status = 'open'`,
      [groupId, hotelId],
    );

    const { rows: lines } = master[0]
      ? await client.query<{
          date: string; description: string; category: string;
          amount: string; room: string | null;
        }>(
          /* The room is app.stay_room (086). This asked for the HELD
             assignment, and a check-out releases it — so every line
             a departed room had routed to the master bill printed
             without its room. */
          `select fp.business_date::text as date, fp.description, fp.category,
                  (fp.amount + fp.tax_amount)::text as amount,
                  app.stay_room(fp.reservation_id) as room
             from folio_postings fp
            where fp.folio_id = $1
            order by fp.business_date, fp.id`,
          [master[0].id])
      : { rows: [] };

    const guestSide = rooms.reduce((sum, r) => sum + Number(r.balance), 0);

    return {
      id: groupId,
      name: g[0].name,
      blockCode: g[0].block_code,
      company: g[0].company,
      notes: g[0].notes,
      /* The group's lead room (D22-52): its one confirmation and its one
         review request go to this room's guest. */
      leadId: g[0].lead,
      rooms: rooms.map((r) => ({
        reservationId: r.reservation_id, reference: r.reference,
        guest: r.guest, room: r.room, roomType: r.room_type,
        checkIn: r.check_in, checkOut: r.check_out, nights: r.nights,
        status: r.status, agreedRate: Number(r.agreed_rate),
        routed: r.routed, balance: Number(r.balance),
        /* How many people. For a group this is the first thing
           anybody asks: nine rooms is meaningless until you know
           whether it is nine couples or nine families, and it is
           what housekeeping sets the beds from. */
        adults: r.adults, children: r.children,
      })),
      /* TWO figures, deliberately. The host's account and what the guests
         owe on their own folios are different debts settled by different
         people; one combined number tells nobody what to collect. */
      master: master[0]
        ? { id: master[0].id, balance: Number(master[0].balance),
            company: master[0].company, invoice: master[0].invoice,
            lines: lines.map((l) => ({
              date: l.date, description: l.description,
              category: l.category, amount: Number(l.amount), room: l.room,
            })) }
        : null,
      guestBalance: guestSide,
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, "ok" in body && body.ok === false ? 409 : 200);
});

/* ── Opening the master ────────────────────────────────────────── */

groups.post("/:code/groups/:id/master", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows: existing } = await client.query<{ id: string }>(
      `select id::text from folios
        where group_id = $1 and hotel_id = $2 and status = 'open'`,
      [groupId, hotelId]);
    if (existing[0]) {
      /* Not an error worth a red toast — it is already what was wanted.
         A unique index enforces one, so this is the friendly half. */
      return { ok: true as const, id: existing[0].id, created: false };
    }

    /* ADDRESSED TO THE COMPANY THE GROUP IS BILLED TO (D27-305 (10)), as a
       function's bill is (060): the group's own, else its lead room's - one
       booking made every room, with one company. "Bill to company" then
       sends it to that company's City ledger, which reads the bill's own
       company (cityLedgerMoves, app.company_owes). */
    const { rows } = await client.query<{ id: string }>(
      `insert into folios (hotel_id, group_id, bill_to, company_id)
       select $1, g.id, case when x.co is null then 'guest' else 'company' end, x.co
         from reservation_groups g
        cross join lateral (select coalesce(g.company_id,
                   (select r.company_id from reservations r where r.id = app.group_lead(g.id))) as co) x
        where g.id = $2
       returning id::text`,
      [hotelId, groupId]);
    if (!rows[0]) return refuse("No such group.");

    return { ok: true as const, id: rows[0].id, created: true };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Who leads the group (D22-52) ──────────────────────────────────
   By default the room booked first that still stands; the desk may pick
   another. Who leads is ALWAYS read through app.group_lead, so a lead
   that is later cancelled gives way to the default by itself. Every
   refusal comes before the one write (MEMORY 243). */
groups.post("/:code/groups/:id/lead", async (c) => {
  const input = await c.req.json<{ reservationId?: string }>()
    .catch(() => ({}) as { reservationId?: string });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows } = await client.query<{ guest: string; status: string }>(
      `select g.full_name as guest, r.status
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2 and r.group_id = $3`,
      [input.reservationId ?? null, hotelId, groupId]);
    const room = rows[0];
    if (!room) return refuse("That room is not in this group.");
    if (["cancelled", "void", "no_show"].includes(room.status)) {
      return refuse(
        `${room.guest}'s booking no longer stands, so it cannot lead the group.`);
    }

    await client.query(
      "update reservation_groups set lead_reservation_id = $1 where id = $2",
      [input.reservationId, groupId]);
    return { ok: true as const, guest: room.guest };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Who pays for a room ───────────────────────────────────────── */

groups.post("/:code/stays/:id/routing", async (c) => {
  const input = await c.req.json<{ toGroup?: boolean }>()
    .catch(() => ({}) as { toGroup?: boolean });
  const toGroup = input.toGroup === true;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{
      guest: string; group_id: string | null;
    }>(
      `select g.full_name as guest, r.group_id::text
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [stayId, hotelId]);
    if (!stay[0]) return refuse("No such reservation.");

    if (toGroup && !stay[0].group_id) {
      return refuse(
        `${stay[0].guest} is not in a group, so there is no master folio to `
        + "charge. Add the booking to a group first.");
    }

    if (toGroup) {
      const { rows: master } = await client.query<{ id: string }>(
        `select id::text from folios
          where group_id = $1 and hotel_id = $2 and status = 'open'`,
        [stay[0].group_id, hotelId]);
      if (!master[0]) {
        /* Named rather than silently falling back. app.folio_for_room_charge
           WOULD fall back to the stay's own folio — deliberately, because a
           charge that lands nowhere is worse than one on the wrong account —
           but a clerk who ticked "host pays" and got no master would never
           know the tick did nothing. */
        return refuse(
          "This group has no open master folio yet. Open one, and the room "
          + "charges will go to it.");
      }
    }

    await client.query(
      `update reservations set route_room_to_group = $1 where id = $2`,
      [toGroup, stayId]);

    return { ok: true as const, guest: stay[0].guest, routed: toGroup };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* What a booking at this hotel must carry, the hotel's own list (192). */
const FIELD_WORDS: Record<string, string> = {
  phone: "The phone number", email: "The email", nationality: "The nationality",
  address: "The address", expectedArrival: "The expected arrival time",
  marketSegment: "The market segment", businessSource: "The business source",
  salesPerson: "The sales person",
};
async function missingField(
  client: Client, hotelId: string, input: Record<string, unknown>,
): Promise<string | null> {
  const { rows } = await client.query<{ f: string[] }>(
    "select required_booking_fields as f from hotels where id = $1", [hotelId]);
  const blank = (v: unknown): boolean => v == null || (typeof v === "string" ? !v.trim()
    : typeof v === "object" && Object.values(v as object).every(blank));
  const f = (rows[0]?.f ?? []).find((k) => blank(input[k]));
  return f ? `${FIELD_WORDS[f]} is needed for a booking at this hotel.` : null;
}

/* ── Booking several rooms at once ─────────────────────────────────
   A wedding party wants four Deluxes and two Superiors for the same three
   nights. Six bookings typed one at a time is six chances to mistype a date,
   and nothing afterwards says they belong together.

   A GROUP IS CREATED ONLY FOR MORE THAN ONE ROOM. A single booking that
   happens to go through this path is just a booking — inventing a group of
   one puts a row in every group list that nobody means.

   THE RATE IS NOT GUESSED. app.tariff_for answers NULL when any part of the
   party is unpriced, and this refuses by name rather than quietly charging
   for two people in a room of three. The caller may override with a rate
   somebody agreed, which is what a negotiated block is.

   AVAILABILITY IS REPORTED, NOT ENFORCED. A reservation is for a room TYPE;
   deliberate overbooking is something every hotel does, and 005 separated
   type from room precisely so it stays possible. The summary says how many
   are left; the clerk decides. */
groups.post("/:code/bookings", async (c) => {
  type Body = {
    guestName?: string; phone?: string; email?: string;
    checkIn?: string; checkOut?: string;
    groupName?: string; blockCode?: string;
    /* ⚠ `bookingSourceId` IS REQUIRED AND `source` IS NOT. The free text 042
       left behind is still accepted so nothing that posts to this endpoint
       breaks, but the channel is now a row in booking_sources and a booking
       without one cannot be saved. The owner asked for that on 8 September:
       an unrecorded channel is a lead nobody can trace back. */
    bookingSourceId?: string;
    source?: string; businessSource?: string; marketSegment?: string;
    /* The hour they said they would arrive. Optional, and NULL when they did
       not say - which is most bookings. Nothing should hold a room against a
       time nobody gave. */
    expectedArrival?: string;
    /* The SENDER'S own reference - the OTA's number, or the CRS's id.
       Optional: the desk has none and sends none. A machine sends it, and a
       second request with the same one from the same channel is answered
       with the first booking instead of making another (RES-3, 091). */
    externalRef?: unknown;
    lines?: BookingLineInput[];
    /* The CRM's three (docs/briefs/crm.md). The returning guest the clerk
       confirmed (D21-20) - checked again in makeBooking; "guest agreed to
       WhatsApp" (D21-72); and "agreed to offers" (D25-39, opt-in), kept
       against the phone and email themselves for the whole group (D21-22). */
    guestId?: string;
    whatsappAgreed?: boolean;
    offersAgreed?: boolean;
    /* D27-246: "Prepaid on the booking site", for a booking site's booking. */
    prepaidOnSite?: boolean;
    /* The desk's, from Phase 1 (D27-33): each checked in makeBooking. */
    tentative?: boolean; expectedDeparture?: string; salesPerson?: string;
    companyId?: string; discount?: BookingDiscount;
    /* D27-275: a GM's "allow, with reason" over the company's credit limit. */
    overLimitReason?: string;
    title?: string; nationality?: string; address?: BookingAddress;
    /* D27-163: the one page's Notes box and the walk-in's tick. */
    notes?: string; isSingleLady?: boolean;
    /* D27-347: the guest's special request, for the voucher. */
    specialRequest?: string;
    /* D27-170: the lead's campaign, from "Book this lead". */
    campaign?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  /* X-2 (the owner, 28 September): an impossible phone or email is refused
     where a person types it. Here, not in makeBooking: a booking site's
     masked phone must not turn a real booking into a refusal. */
  const contact = phoneProblem(input.phone) ?? emailProblem(input.email);
  if (contact) return c.json({ ok: false, reason: contact }, 409);

  /* ⚠ THE BOOKING ITSELF IS `makeBooking` (book.ts), and it holds every
     refusal. This route's whole job is to turn a request body into what that
     function takes, and its answer into an HTTP one - so a booking made by a
     machine in process (the channel manager, D17-79) cannot behave
     differently from one made here. */
  let externalRef: string | null = null;
  if (input.externalRef !== undefined && input.externalRef !== null) {
    /* Present but not usable is refused rather than ignored: a feed that
       believes it is protected against its own retries, and is not, finds
       out the day a timeout makes two bookings. */
    externalRef = typeof input.externalRef === "string" ? input.externalRef.trim() : "";
    if (!externalRef) {
      return c.json(
        { ok: false, reason: "externalRef must be your own reference for this booking, as text." },
        409);
    }
  }

  const build = (hotelId: string): BookingRequest => ({
    hotelId,
    guestName: input.guestName?.trim() ?? "",
    ...(input.phone === undefined ? {} : { phone: input.phone }),
    ...(input.email === undefined ? {} : { email: input.email }),
    checkIn: input.checkIn ?? "",
    checkOut: input.checkOut ?? "",
    ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
    ...(input.blockCode === undefined ? {} : { blockCode: input.blockCode }),
    ...(input.bookingSourceId === undefined ? {} : { bookingSourceId: input.bookingSourceId }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.businessSource === undefined ? {} : { businessSource: input.businessSource }),
    ...(input.marketSegment === undefined ? {} : { marketSegment: input.marketSegment }),
    ...(input.expectedArrival === undefined ? {} : { expectedArrival: input.expectedArrival }),
    externalRef,
    lines: input.lines ?? [],
    ...(typeof input.guestId === "string" && input.guestId ? { guestId: input.guestId } : {}),
    whatsappAgreed: input.whatsappAgreed === true,
    ...(typeof input.prepaidOnSite === "boolean" ? { prepaidOnSite: input.prepaidOnSite } : {}),
    tentative: input.tentative === true,
    ...(typeof input.expectedDeparture === "string" ? { expectedDeparture: input.expectedDeparture } : {}),
    ...(typeof input.salesPerson === "string" ? { salesPerson: input.salesPerson } : {}),
    ...(typeof input.companyId === "string" && input.companyId ? { companyId: input.companyId } : {}),
    ...(typeof input.overLimitReason === "string" ? { overLimitReason: input.overLimitReason } : {}),
    ...(input.discount && typeof input.discount === "object" ? { discount: input.discount } : {}),
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.nationality === "string" ? { nationality: input.nationality } : {}),
    ...(input.address && typeof input.address === "object" ? { address: input.address } : {}),
    ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
    ...(typeof input.specialRequest === "string" ? { specialRequest: input.specialRequest } : {}),
    isSingleLady: input.isSingleLady === true,
    ...(typeof input.campaign === "string" ? { campaign: input.campaign } : {}),
  });

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    /* THE HOTEL'S REQUIRED FIELDS (the owner's D27-260 Q2): the desk's New
       booking only - a channel's booking never comes this way. */
    const missing = await missingField(client, hotelId, input as Record<string, unknown>);
    if (missing) return { ok: false as const, kind: "refused" as const, reason: missing };
    const made = await makeBooking(client, build(hotelId));
    /* In the booking's own transaction, after it is made: a refused booking
       records nothing, and a repeat was recorded the first time. */
    if (made.ok && !made.duplicate && input.offersAgreed === true) {
      await client.query("select app.record_offers_yes($1, $2)",
        [input.phone ?? null, input.email ?? null]);
    }
    return made;
  }).catch(async (error: unknown) => {
    /* TWO COPIES AT ONCE. Both passed the already-received check before
       either had committed; this one reached line 1 second, waited for the
       other to commit, and lost at a unique index. The throw rolled back
       everything it had written. From the sender's side the booking DID
       land, so answer as the repeat it is - in a FRESH transaction, where
       the winner's rows are visible.

       ⚠ ANY unique index, not only reservations_ota_line_idx: whether it was
       our copy's twin is settled by looking, not by the constraint's name.
       If no earlier request with this reference exists, the collision was
       with somebody else's booking and the error stands. */
    if (!externalRef || !isUniqueViolation(error)) throw error;
    return withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const request = build(hotelId);
      const earlier = await alreadyReceived(
        client, hotelId, request.bookingSourceId, externalRef);
      if (earlier.length === 0) throw error;
      return answerRepeat(earlier, externalRef, fingerprintOf(request));
    });
  });

  if (!result) return c.json({ error: "No such property." }, 404);

  /* ⚠ THE ANSWER A SCREEN ALREADY READS, plus two things only ADDED, so an
     older screen or a queued offline booking reads it unchanged: each booking's
     `id` (Phase 1: the Booked card hands the booking to front desk's doors -
     a room, the check-in, the guest's page, the voucher - and every one of
     them is addressed by the stay's id) and the `status` it was made with.
     A repeat answers the same ids as the first time: it IS the first answer
     (RES-3). `duplicate` still appears, as it always did, only when true. */
  if (!result.ok) {
    return c.json({ ok: false, reason: result.reason,
                    ...("needs" in result && result.needs ? { needs: result.needs } : {}) }, 409);
  }
  return c.json({
    ok: true as const,
    ...(result.duplicate ? { duplicate: true as const } : {}),
    groupId: result.groupId,
    rooms: result.rooms,
    guest: result.guest,
    bookings: result.bookings,
    nightly: result.nightly,
    status: result.status,
  }, 200);
});
