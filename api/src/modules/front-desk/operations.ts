import { Hono } from "hono";
import { withSession, type Session } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { resolveDate, businessDateFor } from "../../businessDate.ts";
import { folioFor } from "../../folio.ts";
import { roomNightsDue, postRoomNight, leavingEarly } from "../night-audit/index.ts";
import { editFolioCharge, stayFacts } from "../finance/index.ts";
import {
  formIIIRefusal, identityProblem, isForeign, maskedId, saveCompanionsDeparture,
  saveIdentity, saveVisit, type Identity, type Visit,
} from "../guests/index.ts";
import { earnAtCheckOut } from "../loyalty/index.ts";
import { countProblem, dateProblem, MAX_NIGHTS } from "../../validate.ts";
import { cancelStaleKeys } from "../room-systems/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FLOWS THAT WRITE

   Everything before this read. This is the first route that changes
   something a guest would notice, and the checkpoint it belongs to is
   measured by one sentence:

       check a guest in, reload the browser, they are still checked in.

   Two things make that safe rather than merely possible.

   ONE TRANSACTION PER REQUEST. `withSession` already opens one, so a
   check-in that assigns a room and moves a status either does both or
   does neither. A half-applied check-in leaves a room held by a
   booking that never arrived.

   THE DATABASE REFUSES, NOT THE BROWSER. `src/lib/rules.ts` still
   disables the button — that is what a clerk should see — but the
   rule is enforced here too. A rule enforced only in the browser is a
   suggestion, and a suggestion is not what stops a room being sold
   twice.
   ══════════════════════════════════════════════════════════════════ */

/* Split on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). The front desk's endpoints stay here.
   Posting a charge, reversing one and taking a payment went to finance
   (postings.ts), and the cashier shift to finance (cashier.ts). `folioFor`,
   which check-in and the postings both call, is in the core
   (api/src/folio.ts). Nothing inside an endpoint changed. */

export const operations = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/** Rule 6's shape, all the way down. Refused is a result, not an error. */
type Outcome<T = unknown> =
  | { ok: true; data?: T }
  /* `needs` names WHAT WOULD SATISFY the refusal, for the refusals that
     have an answer. A screen can then open the right dialog instead of
     matching on the prose — which is a string somebody will reword one
     day, at which point the way through silently disappears. Most
     refusals have no `needs`: "the room is occupied" is not a form to
     fill in. */
  | { ok: false; reason: string; needs?: "late-reason" | "early-reason" | "leaving-early" | "next-destination" };


/** Rupees, grouped, in a sentence somebody reads. The Indian grouping
    is what a guest expects to see on a bill, and `toFixed(2)` printed
    "1000.00" into a refusal the front desk had to read aloud. */
function money(n: number): string {
  /* Paise are shown when there are any, and shown as TWO digits.
     `minimumFractionDigits: 0` printed "₹787.5" for seven hundred and
     eighty-seven fifty — which is not how anybody writes an amount they
     are asking a guest to hand over. A round figure still reads
     "₹1,000" rather than "₹1,000.00". */
  const paise = Math.round(n * 100) % 100 !== 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}


/** May this person set a charge aside?

    Recording an early arrival or a late departure is an OBSERVATION —
    the guest was at the desk at nine, or still in the room at four, and
    that is true whoever noticed. WAIVING the charge is a decision about
    money and somebody has to own it.

    Asked on the server for both ends, because the dialogs hide the
    option as a courtesy and `waiveEarly` / `waiveLate` are fields in a
    POST body anybody can send. */
async function mayWaive(
  client: Client, hotelId: string, staffId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select (s.is_group_admin
             or exists (select 1 from staff_hotels sh
                         where sh.staff_id = s.id
                           and sh.hotel_id = $1
                           and sh.role in ('owner', 'gm'))) as may
       from staff s where s.id = $2`,
    [hotelId, staffId],
  );
  return rows[0]?.may === true;
}

const WAIVE_REFUSED =
  "Setting that charge aside is a manager's decision. Record it and let "
  + "it charge, or ask a manager to waive it.";

const refuse = (
  reason: string, needs?: "late-reason" | "early-reason" | "leaving-early" | "next-destination",
): Outcome => (needs ? { ok: false, reason, needs } : { ok: false, reason });

/** Is somebody still IN this room - app.in_house (129), the one rule - other
    than the stays in `except`? The sentence if so. FD-11's, and the owner's
    rule A (24 September): asked by every route that puts a guest in a room
    NOW - the check-in (a walk-in's too), a move or a swap from tonight, a
    room for a guest already checked in. A room given ahead to a booking that has not
    arrived is a hold, not a guest in it: its check-in asks again on the day. */
export async function stillIn(
  client: Client, hotelId: string, roomId: string, roomNumber: string,
  except: string[] = [],
): Promise<string | null> {
  const { rows } = await client.query<{ guest: string; reference: string }>(
    `select g.full_name as guest, r.reference
       from app.in_house($1) i
       join reservations r on r.id = i.reservation_id
       join guests g on g.id = r.guest_id
      where i.room_id = $2 and i.reservation_id <> all($3::uuid[])
      limit 1`,
    [hotelId, roomId, except],
  );
  return rows[0]
    ? `${rows[0].guest} (${rows[0].reference}) is still in room ${roomNumber}. `
      + "Check them out first, or choose another room."
    : null;
}

/* A BLOCKED ROOM IS NOT GIVEN (the owner's D27-339): a room out of order, in
   maintenance or otherwise blocked on any night of [from, to) - a day use
   counts its one day - cannot take the stay, whether the block was entered
   today or ahead of time. The inventory already subtracts it (044); this is
   the desk's doors saying the same. Blocks hold both their days (022). */
const BLOCK_WORDS: Record<string, string> = {
  out_of_order: "out of order", out_of_service: "in maintenance (out of service)",
  refurbishment: "in refurbishment", house_use: "NC - not for sale", owner_occupied: "owner occupied",
};
export async function blockedFor(
  client: Client, roomId: string, roomNumber: string, from: string, to: string,
): Promise<string | null> {
  const { rows: [b] } = await client.query<{ reason: string; from_date: string; to_date: string | null }>(
    `select b.reason, to_char(b.from_date, 'DD Mon') as from_date, to_char(b.to_date, 'DD Mon') as to_date
       from room_blocks b
      where b.room_id = $1
        and b.from_date < greatest($3::date, $2::date + 1)
        and (b.to_date is null or b.to_date >= $2::date)
      order by b.from_date
      limit 1`,
    [roomId, from, to],
  );
  if (!b) return null;
  return `Room ${roomNumber} is ${BLOCK_WORDS[b.reason] ?? b.reason} from ${b.from_date}`
    + `${b.to_date ? ` to ${b.to_date}` : " until further notice"}, so it cannot take this stay. `
    + "Choose another room, or end the block first.";
}

interface CheckInBody {
  roomNumber?: string;
  /* Why the room was given before the property's check-in time, and
     whether the charge for it was waived. 063 refuses to record the
     one without the other. */
  earlyReason?: string;
  waiveEarly?: boolean;
  adults?: number;
  children?: number;
  ratePlan?: string;
  /* The DOCUMENT, not a claim that one was seen.
     `idCaptured: boolean` used to be the whole of it: the client
     asserted a passport had been looked at, the server filed the
     assertion into a note, and guest_documents — which has existed
     since migration 013 — was never written to. Capture is now derived
     from whether a document actually arrived, which is not something a
     client can lie about. */
  identity?: Identity;
  /* Form III's questions about this visit, for a foreign guest (D27-25). */
  visit?: Visit;
  idSkipReason?: string;
  /* Absent means "the property's own operating day", resolved from the
     database. It used to mean the server's wall clock, which dated a
     00:40 settlement to tomorrow — filed under a day the hotel had not
     reached, and missing from the night audit that closed the real one. */
  businessDate?: string;
  user?: string;
  /* D25-39: the guest agreed to offers, asked face to face at check-in. */
  offersAgreed?: boolean;
  /* D27-193: the clerk saw and confirmed a move of more than a day. */
  confirmMove?: boolean;
  /* D27-246: the desk's answer to "Prepaid on the booking site" for a
     booking-site booking; absent = as the booking says (on by default). */
  prepaidOnSite?: boolean;
}

/** What THIS stay still owes before it checks in, by the hotel's rule (the
    owner's D27-243 3.3, D27-246), or null when nothing is asked: the rule is
    "none"; the booking is billed to a company; its room is on the group's
    bill (the host pays); it came from a booking site and is prepaid there;
    it is complimentary or has no agreed rate. ASKED: the first night's - or
    every night's - agreed rate with its GST, as check-in and the night audit
    post it (no GST rule for rooms: the rate alone, as nothing posts its tax
    yet, D27-205). PAID: payments less refunds on the stay's own bill, where
    New booking's advance lands. `arrival` is the day the stay starts if it
    checks in now. No override: the hotel sets "none" instead. */
async function advanceOwed(
  client: Client, hotelId: string, stayId: string, arrival: string, prepaidOnSite?: boolean,
): Promise<{ rule: "first_night" | "whole_stay"; asked: number; paid: number; owed: number } | null> {
  const { rows } = await client.query<{
    rule: "none" | "first_night" | "whole_stay"; exempt: boolean; asked: string | null; paid: string;
  }>(
    `select h.advance_before_check_in as rule,
            (r.company_id is not null
             or (r.route_room_to_group and r.group_id is not null)
             or r.is_complimentary
             or (coalesce(bs.kind, r.source) = 'ota' and coalesce($4::boolean, r.prepaid_on_site))) as exempt,
            ((case when h.advance_before_check_in = 'whole_stay'
                   then greatest(r.check_out - $3::date, 1) else 1 end)
             * (r.agreed_rate + coalesce(round(r.agreed_rate
                 * app.gst_rate_or_null(h.id, 'room', r.agreed_rate) / 100.0, 2), 0)))::text as asked,
            coalesce((select -sum(fp.amount)
                        from folio_postings fp join folios f on f.id = fp.folio_id
                       where f.reservation_id = r.id and fp.category in ('payment', 'refund')
                         and fp.reverses_id is null
                         and not exists (select 1 from folio_postings v where v.reverses_id = fp.id)),
                     0)::text as paid
       from reservations r
       join hotels h on h.id = r.hotel_id
       left join booking_sources bs on bs.id = r.booking_source_id
      where r.hotel_id = $1 and r.id = $2`,
    [hotelId, stayId, arrival, prepaidOnSite ?? null]);
  const a = rows[0];
  if (!a || a.rule === "none" || a.exempt || a.asked === null) return null;
  const asked = Number(a.asked), paid = Number(a.paid);
  return { rule: a.rule, asked, paid, owed: Math.max(0, Math.round((asked - paid) * 100) / 100) };
}

/** The refusal's sentence: the amount owed, what was asked and what is paid. */
const advanceWords = (a: { rule: string; asked: number; paid: number; owed: number }) =>
  `An advance of ${money(a.owed)} is owed before check-in `
  + `(${a.rule === "whole_stay" ? "the whole stay" : "the first night"} ${money(a.asked)}, `
  + `paid ${money(a.paid)}). Take it on the Bill tab.`;

/** The document THIS stay's online check-in carried, confirmed by the desk -
    the express check-in's one question (D27-236 3.4, D27-242). Null for a
    foreign guest (Form III is always the desk's), for a submission waiting
    or set aside, and for any document kept from an earlier visit. */
async function expressDocument(
  client: Client, hotelId: string, stayId: string,
): Promise<{ type: string; number: string } | null> {
  const { rows } = await client.query<{ type: string; number: string; nationality: string | null }>(
    `select s.id_type as type, s.id_number as number, g.nationality
       from reservations r
       join guests g on g.id = r.guest_id
       join guest_detail_submissions s on s.reservation_id = r.id and s.status = 'confirmed'
      where r.hotel_id = $1 and r.id = $2
        and nullif(trim(s.id_type), '') is not null
        and nullif(trim(s.id_number), '') is not null
      order by s.handled_at desc nulls last
      limit 1`, [hotelId, stayId]);
  const d = rows[0];
  return d && !isForeign(d.nationality ?? "IN") ? { type: d.type, number: d.number } : null;
}

/* Whether a stay checks in by express, and the document, masked to its last
   four (D27-236 3.4): what the check-in screen shows in place of the ID. */
operations.get("/:code/stays/:id/express-check-in", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const d = await expressDocument(client, hotelId, c.req.param("id"));
    /* And the advance still owed, so the screen holds Check in with the
       server's own figure (D27-243 3.3): the arrival as it stands, or the
       business date for an arrival that moves. */
    const { rows: s } = await client.query<{ arrival: string }>(
      `select to_char(least(r.check_in, app.business_date($1)), 'YYYY-MM-DD') as arrival
         from reservations r where r.hotel_id = $1 and r.id = $2`, [hotelId, c.req.param("id")]);
    /* ?prepaid=false: the desk has unticked "Prepaid on the booking site". */
    const q = c.req.query("prepaid");
    const prepaid = q === "false" ? false : q === "true" ? true : undefined;
    const a = s[0] ? await advanceOwed(client, hotelId, c.req.param("id"), s[0].arrival, prepaid) : null;
    const advance = a && a.owed > 0 ? { ...a, words: advanceWords(a) } : null;
    /* Whether the booking came from a booking site, and its tick (D27-246). */
    const { rows: site } = await client.query<{ site: boolean; prepaid: boolean }>(
      `select coalesce(bs.kind, r.source) = 'ota' as site, r.prepaid_on_site as prepaid
         from reservations r left join booking_sources bs on bs.id = r.booking_source_id
        where r.hotel_id = $1 and r.id = $2`, [hotelId, c.req.param("id")]);
    const bookingSite = site[0]?.site ?? false;
    const prepaidOnSite = site[0]?.prepaid ?? true;
    return d
      ? { express: true, document: { type: d.type, number: `${"•".repeat(Math.max(0, d.number.length - 4))}${d.number.slice(-4)}` }, advance, bookingSite, prepaidOnSite }
      : { express: false, advance, bookingSite, prepaidOnSite };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* THE GUEST REGISTRATION CARD (the owner's D27-344, D27-345): the old
   system's card in Fidato's design, printed from a button. Its number is
   given at check-in (230); a stay checked in before then has none. Aadhaar
   is printed as its last four only, until the lawyer answers (D25-37); any
   other ID whole, as the clerk compares it with the card in their hand
   (maskedId, guests). Above the signature, the hotel's house policies, the
   voucher's own. Every other adult in the room is listed, the same way
   (D27-382). */
operations.get("/:code/stays/:id/registration-card", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");
    const { rows } = await client.query<Record<string, string | number | string[] | null>>(
      `select r.gr_card_no, r.agreed_rate::text as rate, r.ota_reference,
              g.title, g.full_name, g.email, g.phone, g.nationality,
              d.id_type, d.id_number, d.address_line, d.city, d.state, d.pincode, d.country,
              co.name as company, co.kind as company_kind, co.email as company_email, co.phone as company_phone,
              bs.name as source_name, bs.kind as source_kind,
              f3.arrived_from, f3.next_destination,
              h.name as hotel, concat_ws(', ', h.address_line, h.address_line_2) as hotel_address,
              h.city as hotel_city, h.state as hotel_state, h.phone as hotel_phone,
              h.email as hotel_email, h.website as hotel_website, h.gstin as hotel_gstin, h.house_policies
         from reservations r
         join guests g on g.id = r.guest_id
         join hotels h on h.id = r.hotel_id
         left join guest_documents d on d.guest_id = g.id
         left join companies co on co.id = r.company_id
         left join booking_sources bs on bs.id = r.booking_source_id
         left join form_iii_stays f3 on f3.reservation_id = r.id and f3.guest_id is null
        where r.hotel_id = $1 and r.id = $2`,
      [hotelId, stayId],
    );
    const r = rows[0];
    const stay = r ? await stayFacts(client, { reservationId: stayId }) : null;
    if (!r || !stay) return { missing: true as const };
    const s = (k: string) => (r[k] as string | null) ?? null;
    const { rows: others } = await client.query<{
      name: string; nationality: string; id_type: string | null; id_number: string | null;
    }>(
      `select g.full_name as name, g.nationality, d.id_type, d.id_number
         from stay_companions c
         join guests g on g.id = c.guest_id
         left join guest_documents d on d.guest_id = c.guest_id
        where c.reservation_id = $1
        order by c.added_at, g.full_name`, [stayId]);
    const agent = s("company_kind") === "travel_agent"
      ? { name: s("company"), email: s("company_email"), phone: s("company_phone"), voucher: s("ota_reference") }
      : s("source_kind") === "ota"
        ? { name: s("source_name"), email: null, phone: null, voucher: s("ota_reference") }
        : null;
    return {
      hotel: {
        name: s("hotel")!, address: s("hotel_address") || null, city: s("hotel_city"), state: s("hotel_state"),
        phone: s("hotel_phone"), email: s("hotel_email"), website: s("hotel_website"),
        gstin: s("hotel_gstin"),
      },
      housePolicies: (r["house_policies"] as string[] | null) ?? [],
      grCardNo: r["gr_card_no"] === null ? null : Number(r["gr_card_no"]),
      stay,
      rate: s("rate"),
      guest: {
        title: s("title"), name: s("full_name")!, email: s("email"), phone: s("phone"), nationality: s("nationality"),
        address: { line: s("address_line"), city: s("city"), state: s("state"), pincode: s("pincode"), country: s("country") },
        idType: s("id_type"),
        idNumber: maskedId(s("id_type"), s("id_number")),
      },
      companions: others.map((o) => ({
        name: o.name, nationality: o.nationality, idType: o.id_type,
        idNumber: maskedId(o.id_type, o.id_number),
      })),
      company: s("company_kind") === "corporate"
        ? { name: s("company"), email: s("company_email"), phone: s("company_phone") } : null,
      agent,
      arrivedFrom: s("arrived_from"),
      nextDestination: s("next_destination"),
    };
  });
  if (body === null) return c.json({ error: "No such property." }, 404);
  if ("missing" in body) return c.json({ error: "No such stay." }, 404);
  return c.json(body);
});

operations.post("/:code/stays/:id/check-in", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as CheckInBody;
  const stayId = c.req.param("id");

  const result = await withSession(
    c.get("subject"),
    async (client, session: Session): Promise<
      Outcome | { ok: true; typeChanged: boolean; typeName: string } | null
    > => {
      const hotelId = await hotelIdFor(client, c.req.param("code"));
      if (!hotelId) return null;

      /* FOR UPDATE. Two clerks checking the same booking in at once
         would otherwise both read `confirmed`, both write `checked_in`,
         and both assign a room — leaving two assignments on one
         reservation. The second waits here and then finds the status
         already moved. */
      const { rows } = await client.query<{
        id: string;
        status: string;
        check_in: string;
        check_out: string;
        room_type_id: string;
        notes: string | null;
        guest_id: string;
        nationality: string;
      }>(
        `select id, status, check_in::text, check_out::text, room_type_id,
                notes, guest_id,
                (select g.nationality from guests g where g.id = guest_id) as nationality
           from reservations
          where hotel_id = $1 and id = $2
          for update`,
        [hotelId, stayId],
      );

      const stay = rows[0];
      if (!stay) return refuse("Reservation not found.");

      if (stay.status === "checked_in") return refuse("Already checked in.");
      if (stay.status === "checked_out") return refuse("This stay has already departed.");
      if (stay.status === "cancelled") return refuse("This booking was cancelled.");
      if (stay.status === "no_show") return refuse("This booking was marked a no-show.");
      if (stay.status !== "confirmed") return refuse("Only a confirmed booking can be checked in.");

      /* FD-8 (QA, 28 September): adults 0 reached the database's own check
         and came back "Something went wrong". Refused in words. */
      const count = (body.adults === undefined ? null : countProblem(body.adults, "Adults", 1))
        ?? (body.children === undefined ? null : countProblem(body.children, "Children", 0));
      if (count) return refuse(count);

      /* THE PROPERTY'S DATE, NOT THE BOOKING'S. This read
         `body.businessDate ?? stay.check_in`, so when the client sent
         no date it fell back to the booking's OWN arrival — and
         `stay.check_in > businessDate` compared a value against itself.
         The arrival-date guard could never fire. A guest booked for
         next week checked in today, silently, with the reservation
         still saying it starts next week: the night audit would not
         charge tonight and the tape chart would show the room empty
         with somebody asleep in it.

         Defect 14's shape exactly — a gate reading a different source
         from the action it guards. The hotel's business date is the
         only honest answer, and the client's is accepted only as an
         override for the audit's own replay. The hotel's date is
         app.business_date, the day after the last closed day: the column
         `hotels.business_date` never moves once an audit has run (FD-16). */
      const businessDate = await resolveDate(client, hotelId, body.businessDate);

      /* ── ARRIVING A DAY OR MORE EARLY ─────────────────────────────
         This used to be a flat refusal: "it cannot be checked in
         early". That is not how a hotel works. A guest whose booking
         starts tomorrow turns up tonight, the room is free, and the
         desk puts them in it — the decision is availability and
         judgement, not a rule.

         So it is allowed WITH A REASON, and the booking moves with the
         guest: the arrival becomes today, which is what actually
         happened. Leaving check_in in the future while the guest is in
         the room is the state that makes every report disagree with
         the floor — the night audit would not charge tonight, and the
         tape chart would show the room empty with somebody asleep in
         it.

         The room is still checked for the WHOLE stay below, so an
         early arrival into a room somebody else has tomorrow is
         refused on availability, by name. */
      const earlyByDays = stay.check_in > businessDate;
      if (earlyByDays && !body.earlyReason?.trim()) {
        return refuse(
          `This booking arrives on ${stay.check_in}, not today. It can be `
          + "checked in early if a room is free - give a reason and it moves "
          + "to today.",
        );
      }
      /* MORE THAN A DAY EARLY MOVES A WHOLE BOOKING (D27-193): the owner's
         1 October booking, checked in on a hotel still on 25 August, became
         39 nights nobody had seen. Allowed, but only once the screen has
         shown the move and the clerk confirmed it - a stale screen cannot. */
      const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
      if (day(stay.check_in) - day(businessDate) > 1 && body.confirmMove !== true) {
        return refuse(
          `Checking in now moves the arrival from ${stay.check_in} to ${businessDate}: `
          + `${day(stay.check_out) - day(businessDate)} nights. Confirm the move first.`,
        );
      }

      /* ── ARRIVING EARLY ───────────────────────────────────────
         The property sells the night from its check-in time. Before
         that hour the room is still yesterday's — either being cleaned
         or still occupied — so letting somebody in is a decision, not
         a formality.

         It is ALLOWED. This is a hotel, and a guest off an overnight
         train is a normal Tuesday. What it is not is silent: somebody
         says why, their name goes on it, and if the property charges
         for it the charge reaches the folio.

         Asked in the PROPERTY'S timezone by one function, so this
         screen and the check-out screen cannot come to different
         conclusions about the same clock. */
      const { rows: earlyRows } = await client.query<{ early: boolean }>(
        `select app.arrival_is_early($1, now()) as early`, [hotelId]);
      const isEarly = earlyRows[0]?.early ?? false;

      if (isEarly && !body.earlyReason?.trim()) {
        const { rows: t } = await client.query<{ t: string; charge: string | null }>(
          `select to_char(check_in_time,'HH24:MI') as t,
                  early_checkin_charge::text as charge
             from hotels where id = $1`, [hotelId]);
        const charge = t[0]?.charge;
        return refuse(
          `Rooms are ready from ${t[0]?.t ?? "the check-in time"}. `
          + "An early arrival needs a reason and somebody to allow it"
          + (charge
              ? `, and carries a ${Number(charge).toFixed(2)} charge.`
              : ". The property does not charge for one.")
        );
      }

      /* ⚠ WHO MAY WAIVE, ASKED BEFORE THE FIRST WRITE (FD-14). There was
         no check at all once: `waiveEarly` arrived in the body and was
         obeyed. Then the check sat below the check-in's writes, and a
         refusal commits what came before it (MEMORY 243) - the clerk was
         told no while the guest was checked in, with no early charge. */
      if ((isEarly || earlyByDays) && body.waiveEarly
          && !(await mayWaive(client, hotelId, session.staffId))) {
        return refuse(WAIVE_REFUSED);
      }

      const roomNumber = body.roomNumber?.trim();
      if (!roomNumber) return refuse("Choose a room.");

      const { rows: roomRows } = await client.query<{
        id: string;
        room_type_id: string;
        type_name: string;
        housekeeping_status: string;
      }>(
        `select rm.id, rm.room_type_id, rt.name as type_name, rm.housekeeping_status
           from rooms rm join room_types rt on rt.id = rm.room_type_id
          where rm.hotel_id = $1 and rm.number = $2 and rm.is_active`,
        [hotelId, roomNumber],
      );
      const room = roomRows[0];
      if (!room) return refuse("That room is not part of this property.");

      if (room.housekeeping_status === "out_of_service") {
        return refuse("That room is held out of service.");
      }
      if (room.housekeeping_status === "dirty") {
        return refuse("That room has not been cleaned yet.");
      }
      /* ANOTHER TYPE IS TAKEN AND SAID (the owner's D27-328 (1), FD-34).
         This refused "That room is a different type from the one booked."
         while Assign room and Move room allow it - so the upgrade Assign
         room had just given could not be checked in. Noted as theirs are:
         `typeChanged` and the room's type, answered to the clerk. The
         booking keeps its type and its agreed rate: an upgrade does not
         change the price. */
      const typeChanged = room.room_type_id !== stay.room_type_id;

      /* FD-11 (D23-12): is somebody still IN the room - app.in_house, the
         one rule (129). A guest past their departure date who has not
         checked out holds no night that overlaps this stay, so the clash
         check below never saw them. */
      const inRoom = await stillIn(client, hotelId, room.id, roomNumber);
      if (inRoom) return refuse(inRoom);

      /* The room must be free for the WHOLE stay, not merely tonight.
         The EXCLUDE constraint on room_assignments would catch an
         overlap anyway — but it would arrive as a constraint name, and
         a clerk needs a sentence.

         THE WHOLE STAY STARTS TODAY when the arrival moves (FD-24, 30
         September): this asked about the booking's old dates, and the hold
         below was written on them, so the nights the guest moved onto were
         neither checked nor held - somebody else's room tonight, and free
         to sell again tomorrow. */
      const arrival = earlyByDays ? businessDate : stay.check_in;
      /* ...and no block on any of its nights (D27-339). */
      const blocked = await blockedFor(client, room.id, roomNumber, arrival, stay.check_out);
      if (blocked) return refuse(blocked);
      const { rows: clash } = await client.query<{ reference: string }>(
        `select r.reference
           from room_assignments ra
           join reservations r on r.id = ra.reservation_id
          where ra.room_id = $1
            and ra.released_at is null
            and ra.reservation_id <> $2
            and daterange(ra.from_date, greatest(ra.to_date, ra.from_date + 1), '[)')
                && daterange($3::date, greatest($4::date, $3::date + 1), '[)')
          limit 1`,
        [room.id, stayId, arrival, stay.check_out],
      );
      if (clash[0]) {
        return refuse(`Room ${roomNumber} is held by ${clash[0].reference} for part of that stay.`);
      }

      /* THE DOCUMENT, BELOW THE ROOM'S CHECKS (the master, 28 September):
         a check-in into an occupied or unready room is refused for the
         room, whatever the form holds. Still above the first write.

         A document is captured when a TYPE and a NUMBER arrive together.
         Either alone is a half-filled form, and the database refuses it
         anyway (gd_number_present, 026) — better to say so in a sentence
         than to let a check constraint surface as an error code. */
      const identity = body.identity;
      const captured = Boolean(
        identity?.idType && identity.idNumber?.trim(),
      );

      /* EXPRESS CHECK-IN (the owner's D27-236 3.4, D27-242): an Indian guest
         whose ID the desk confirmed from THIS stay's online check-in just
         collects the key - nothing retyped. Asked here, of the server's own
         records, never of the client; a foreign guest never passes it. */
      const express = !captured && !body.idSkipReason?.trim()
        ? await expressDocument(client, hotelId, stayId) : null;
      if (!captured && !body.idSkipReason?.trim() && !express) {
        return refuse(
          "Record the guest's ID document - type and number - or give a " +
            "reason for skipping it.",
        );
      }
      if (identity?.idType && !identity.idNumber?.trim()) {
        return refuse(`A ${identity.idType} needs its number.`);
      }
      /* FD-2, GU-2, BK-4, X-2 (round D): an Aadhaar "12ab", a birth in the
         future, nationality "ZZ", a phone "abc" - refused in a sentence. */
      const wrong = identityProblem(identity, body.visit, businessDate);
      if (wrong) return refuse(wrong);
      /* Form III's own fields, before the first write (MEMORY 243). The
         nationality typed, else the one on file: leaving the field out must
         not be a way past the rule. And "IN" typed - the ID block opens on
         it - never replaces a foreign nationality on file (D27-197, the
         owner, FD-23; D27-25's walk-in rule, on every path). A wrong one is
         corrected on the guest's record. */
      const typed = identity?.nationality?.trim().toUpperCase();
      const nationality = typed && !(typed === "IN" && isForeign(stay.nationality))
        ? typed : stay.nationality;
      const formIII = formIIIRefusal({ ...identity, nationality }, body.visit, captured);
      if (formIII) return refuse(formIII);

      /* AN ADVANCE BEFORE CHECK-IN (the owner's D27-243 3.3, D27-246): the
         last refusal, before the first write. The desk's untick of "Prepaid
         on the booking site" counts here and is saved below. */
      const owed = await advanceOwed(client, hotelId, stayId,
        earlyByDays ? businessDate : stay.check_in, body.prepaidOnSite);
      if (owed && owed.owed > 0) return refuse(advanceWords(owed));

      const notes = captured || express
        ? stay.notes
        : [stay.notes, `ID not captured - ${body.idSkipReason}`]
            .filter(Boolean)
            .join(" · ");

      /* Replace rather than add. A booking pre-assigned to one room and
         checked into another must not end up holding both. Released BEFORE
         the stay turns checked_in (FD-10): nobody ever entered the room it
         was given ahead, so 185's trigger leaves it as clean as it was. */
      await client.query(
        `update room_assignments set released_at = now()
          where reservation_id = $1 and released_at is null and room_id <> $2`,
        [stayId, room.id],
      );

      await client.query(
        `update reservations
            set status = 'checked_in',
                adults = coalesce($3, adults),
                children = coalesce($4, children),
                occupancy = coalesce($3, adults) + coalesce($4, children),
                meal_plan = coalesce($5, meal_plan),
                notes = $6,
                prepaid_on_site = coalesce($7, prepaid_on_site)
          where hotel_id = $1 and id = $2`,
        [hotelId, stayId, body.adults ?? null, body.children ?? null,
         body.ratePlan === "Room Only" ? "RO" : body.ratePlan ?? null, notes,
         typeof body.prepaidOnSite === "boolean" ? body.prepaidOnSite : null],
      );

      /* AND A FOLIO, IF THERE IS NOT ONE. Bookings now open theirs at
         the moment they are made, but every one taken before that fix
         has none — and a guest checked in without a folio cannot be
         charged for anything, by the till or the desk. `folioFor` opens one on demand and returns the existing one
         otherwise, so this costs a lookup and closes the gap for every
         booking already in the database. */
      await folioFor(client, hotelId, stayId);

      /* THE BOOKING MOVES WITH THE GUEST. Written before the early
         record below so both land in one transaction — a stay that
         checked in but still says it arrives tomorrow is worse than
         either state on its own. */
      if (earlyByDays) {
        await client.query(
          `update reservations set check_in = $3::date
            where hotel_id = $1 and id = $2`,
          [hotelId, stayId, businessDate]);
      }

      /* WHO ALLOWED IT, AND WHY. Written with the timestamp, because
         the constraint in 063 refuses one without the other — an early
         arrival recorded with no reason answers nothing anybody asks
         three months later. */
      if (isEarly || earlyByDays) {
        await client.query(
          `update reservations
              set early_checkin_at = now(),
                  early_checkin_reason = $3,
                  early_checkin_by = $4
            where hotel_id = $1 and id = $2`,
          [hotelId, stayId, body.earlyReason!.trim(), session.staffId]);

        /* And onto the folio, if the property charges. `waiveEarly` is
           a manager deciding not to - asked above, before any write - and
           worth being visible by its absence on the bill. */
        if (!body.waiveEarly && isEarly) {
          /* PART OF THE ROOM ON THE BILL (the owner's D27-223): its source
             says what it is, 'early_checkin', and the bill's sections put it
             under Room. Lines before 1 October say 'front_desk' and stay in
             Other charges. */
          /* The charge is the property's; the RATE is the room's.
             Letting somebody in at eleven is ancillary to selling them
             the room, so it carries the room's slab — and the room's
             slab is decided by the room's nightly rate, not by the
             ₹1,000 being charged for the early hours. On a ₹9,000 suite
             that is 18%; asking the rule about ₹1,000 would answer 5%
             and put the wrong figure in the GST return. */
          const { rows: h } = await client.query<{
            charge: string | null; nightly: string | null;
          }>(
            `select h.early_checkin_charge::text as charge,
                    r.agreed_rate::text as nightly
               from hotels h
               left join reservations r on r.id = $2
              where h.id = $1`, [hotelId, stayId]);
          const amount = h[0]?.charge === null || h[0]?.charge === undefined
            ? null : Number(h[0].charge);
          if (amount !== null && amount > 0) {
            await client.query(
              `insert into folio_postings
                 (hotel_id, folio_id, business_date, category, description,
                  amount, tax_rate, tax_amount, source_type, posted_by)
               select $1::uuid, f.id, $2::date, 'misc', 'Early check-in',
                      $3::numeric, t.rate,
                      round($3::numeric * t.rate / 100.0, 2),
                      'early_checkin', $4::uuid
                 from folios f
                cross join (select app.gst_rate($1,'room',$6::numeric) as rate) t
                where f.reservation_id = $5 and f.status = 'open'
                limit 1`,
              [hotelId, businessDate, amount, session.staffId, stayId,
               Number(h[0]?.nightly ?? amount)]);
          }
        }
      }

      /* ── The document ────────────────────────────────────────────
         In the SAME transaction as the check-in. A guest who is in
         house with a document that failed to save is exactly the state
         an FRRO inspection finds and nobody can explain — so either
         both land or neither does.

         Upsert, because a returning guest already has a row and 013
         made guest_id the primary key. 026 added the UPDATE policy
         that makes this possible at all; before it, a second visit
         could not be recorded.

         COALESCE on every field: a clerk capturing a passport number
         today must not blank the address somebody recorded last year.
         Only what was actually typed is written. */
      if (captured && identity) {
        await saveIdentity(client, stay.guest_id, identity);
      }

      /* Nationality lives on the GUEST, not the document — it is a fact
         about the person, and it is what the Form C register filters
         on. Only written when supplied: the column defaults to 'IN',
         and overwriting a recorded nationality with a default because
         a form field was left empty would remove a foreign national
         from the register entirely. */
      if (typed) {
        await client.query(
          "update guests set nationality = $2 where id = $1",
          [stay.guest_id, nationality],
        );
      }
      if (isForeign(nationality)) {
        await saveVisit(client, hotelId, stayId, body.visit ?? {});
      }

      /* A hold given ahead on this room starts on the old arrival: it is
         stretched back to the day the guest came (FD-24). */
      await client.query(
        `update room_assignments set from_date = $3::date
          where reservation_id = $1 and released_at is null and room_id = $2
            and from_date > $3::date`,
        [stayId, room.id, arrival],
      );
      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1, $2, $3, $4, $5, 'arrival')
         on conflict do nothing`,
        [hotelId, stayId, room.id, arrival, stay.check_out],
      );

      /* THE FIRST NIGHT IS CHARGED NOW (the owner's D27-204, D27-205): the
         room charge and its GST, dated today, by the night audit's own code -
         so the audit finds this night charged and posts each later one. The
         last write, in the check-in's own transaction, after every refusal
         (MEMORY 243) and after the hold, which names the room on the line.
         Nothing for a complimentary room, as the audit. And nothing where the
         property has no GST rule for rooms: the guest is not kept at the desk
         for a setting, and the audit - refused until the rule is set - posts
         this night. */
      const [night] = await roomNightsDue(client, hotelId, businessDate, stayId);
      if (night && !night.comp && night.gst !== null) {
        await postRoomNight(client, hotelId, businessDate, night, "check_in");
      }

      /* No write to rooms.occupancy_status here: the check-in above and
         the assignment re-read it from app.in_house (129), the one rule. */

      if (body.offersAgreed === true) {
        await client.query(
          "select app.record_offers_yes(phone, email::text) from guests where id = $1",
          [stay.guest_id]);
      }

      void session;
      return { ok: true as const, typeChanged, typeName: room.type_name };
    },
  );

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Is an arrival right now early, and what does it cost? ─────────
   Asked of the SERVER, against the property's clock. A tablet with the
   wrong time set must not be able to make an early arrival look like an
   ordinary one — and the check-in route refuses independently either
   way, so this is what the screen shows, never what it decides. */
operations.get("/:code/early-arrival", async (c) => {
  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      early: boolean; t: string; charge: string | null;
      late_t: string; late_charge: string | null;
    }>(
      `select app.arrival_is_early(id, now()) as early,
              to_char(check_in_time,'HH24:MI') as t,
              early_checkin_charge::text as charge,
              to_char(check_out_time,'HH24:MI') as late_t,
              late_checkout_charge::text as late_charge
         from hotels where id = $1`, [hotelId]);
    const r = rows[0];
    if (!r) return null;
    return {
      isEarly: r.early,
      checkInTime: r.t,
      checkOutTime: r.late_t,
      /* NULL, not 0. A property that does not charge for an early
         arrival is not the same as one charging nothing, and the
         screens show a dash rather than a zero. */
      charge: r.charge === null ? null : Number(r.charge),
      lateCharge: r.late_charge === null ? null : Number(r.late_charge),
      /* Whether THIS person may waive either charge: the check-in's and the
         check-out's own question (mayWaive), so a screen offers the tick to
         exactly those the server will then accept it from (rule C). */
      mayWaive: await mayWaive(client, hotelId, session.staffId),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Is this check-out leaving early? (D27-315) ────────────────────
   What the Check out step shows: the booked departure, today, the nights
   not stayed and whether a booking site must be told. Null when no night is
   freed. The check-out route asks the same function and decides. */
operations.get("/:code/stays/:id/leaving-early", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return { leavingEarly: await leavingEarly(client, hotelId, c.req.param("id")) };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Check out ───────────────────────────────────────────────────── */

operations.post("/:code/stays/:id/check-out", async (c) => {
  type CheckOutBody = {
    /* Why they stayed past the check-out time, and whether the charge
       was waived. 063 refuses the record without the reason. */
    lateReason?: string;
    waiveLate?: boolean;
    /* Form III: where a foreign guest goes next (D27-25). */
    nextDestination?: string;
    /* Why a guest leaves before the booked departure (D27-315). */
    earlyReason?: string;
  };
  const body = (await c.req.json().catch(() => ({}))) as CheckOutBody;

  const result = await withSession(c.get("subject"), async (client, session): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const stayId = c.req.param("id");

    const { rows } = await client.query<{
      status: string; nationality: string; foreign_companion: boolean;
    }>(
      `select r.status, g.nationality,
              exists (select 1 from stay_companions c join guests cg on cg.id = c.guest_id
                       where c.reservation_id = r.id and cg.nationality <> 'IN') as foreign_companion
         from reservations r join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and r.id = $2 for update of r`,
      [hotelId, stayId],
    );
    const stay = rows[0];
    if (!stay) return refuse("Reservation not found.");
    if (stay.status === "checked_out") return refuse("This stay has already departed.");
    if (stay.status !== "checked_in") return refuse("Only a checked-in guest can check out.");

    /* ── WHERE A FOREIGN GUEST GOES NEXT ─────────────────────────────
       Rule 17(1): at departure the foreigner gives the address they are
       going to, and Form III's departure carries it. Asked here, while
       they are still at the desk (the owner, 27 September) - and above
       the late charge, the first write (MEMORY 243). Their foreign
       companions leave with them, under an Indian lead too (D27-382). */
    const nextDestination = body.nextDestination?.trim();
    if ((isForeign(stay.nationality) || stay.foreign_companion) && !nextDestination) {
      return refuse(
        "Form III asks where a foreign guest is going next. Enter the next "
        + "destination to check them out.",
        "next-destination",
      );
    }

    /* ── LEAVING LATE ───────────────────────────────────────────────
       The mirror of arriving early, and the same shape: allowed, never
       silent. A guest still in the room at four has kept it out of
       tonight's inventory, and housekeeping cannot turn it around for
       an arrival that is already on the chart.

       Checked BEFORE the balance, deliberately. A late charge is part
       of what they owe, so testing the balance first would pass them
       on a total that is about to change — and then refuse the
       check-out they were just told they could have.

       ONLY ON OR AFTER THE DEPARTURE DATE (D27-314 (2)): before it - by
       the hotel's business date - the guest is leaving early, whatever
       the hour. The rule says so (migration "late departure on the day").
       NEVER A DAY USE (D27-319 (2)): it has its own hours, so the rule is
       given the arrival too (migration "a day use is never late").
       AND ONCE (D27-314 (1)): a late departure already recorded - the
       reason, the charge or its waiver - is not asked again or charged
       again. The next Check out came after the guest paid, asked for the
       reason again and posted the charge again. Read after the row lock
       above, so two presses cannot both record it. */
    const { rows: lateRows } = await client.query<{ late: boolean }>(
      `select app.departure_is_late(hotel_id, now(), check_in, check_out)
              and late_checkout_at is null as late
         from reservations where id = $1`, [stayId]);
    const isLate = lateRows[0]?.late ?? false;

    if (isLate && !body.lateReason?.trim()) {
      const { rows: t } = await client.query<{ t: string; charge: string | null }>(
        `select to_char(check_out_time,'HH24:MI') as t,
                late_checkout_charge::text as charge
           from hotels where id = $1`, [hotelId]);
      const charge = t[0]?.charge;
      return refuse(
        `Check-out was ${t[0]?.t ?? "earlier"}. A late departure needs a `
        + "reason and somebody to allow it"
        + (charge
            /* ₹, and grouped. This printed "1000.00" — a bare number in
               a sentence a guest's bill will carry the consequence of. */
            ? `, and carries a ${money(Number(charge))} charge.`
            : ". The property does not charge for one."),
        "late-reason",
      );
    }

    /* ── WHO MAY WAIVE ──────────────────────────────────────────────
       Recording a late departure is an observation: the guest was
       still in the room at four, and that is true whoever noticed.
       WAIVING the charge is a decision about money, and somebody has
       to own it.

       Checked HERE, not only on the screen. The dialog hides the
       option from a clerk as a courtesy to the clerk; this is the
       thing that actually decides, because a screen is not a
       permission system and `waiveLate` is a field in a POST body
       anybody can send. Rule 6's second half: the server refuses
       independently. */
    if (isLate && body.waiveLate
        && !(await mayWaive(client, hotelId, session.staffId))) {
      return refuse(WAIVE_REFUSED);
    }

    /* Recorded and charged BEFORE the balance is tested, so the guest
       settles the whole bill including this. */
    if (isLate) {
      await client.query(
        `update reservations
            set late_checkout_at = now(),
                late_checkout_reason = $3,
                late_checkout_by = $4
          where hotel_id = $1 and id = $2`,
        [hotelId, stayId, body.lateReason!.trim(), session.staffId]);

      if (!body.waiveLate) {
        /* Same rule as the early charge above: the room decides the
           slab, because a late departure is ancillary to the room - and
           its source, 'late_checkout', puts it under Room on the bill
           (D27-223). */
        /* ⚠ THIS READ `hotels.business_date` AND POSTED TO IT.
           That column is the property's CONFIGURED date. The real one
           is `app.business_date()` — the last completed night audit
           plus a day — and the two differ the moment a property has
           ever closed a night. Posting to the configured date then hit
           012's guard, "that date is closed", and the whole check-out
           came back as a 500 with no explanation.

           The EARLY check-in charge twenty lines up has always used the
           resolved date. Same feature, two ends, and only one of them
           was right — which is the shape of most of what has been found
           in this file. */
        const businessDate = await businessDateFor(client, hotelId);

        const { rows: h } = await client.query<{
          charge: string | null; nightly: string | null;
        }>(
          `select h.late_checkout_charge::text as charge,
                  r.agreed_rate::text as nightly
             from hotels h
             left join reservations r on r.id = $2
            where h.id = $1`, [hotelId, stayId]);
        const amount = h[0]?.charge === null || h[0]?.charge === undefined
          ? null : Number(h[0].charge);
        if (amount !== null && amount > 0) {
          await client.query(
            `insert into folio_postings
               (hotel_id, folio_id, business_date, category, description,
                amount, tax_rate, tax_amount, source_type, posted_by)
             select $1::uuid, f.id, $2::date, 'misc', 'Late check-out',
                    $3::numeric, t.rate,
                    round($3::numeric * t.rate / 100.0, 2),
                    'late_checkout', $4::uuid
               from folios f
              cross join (select app.gst_rate($1,'room',$6::numeric) as rate) t
              where f.reservation_id = $5 and f.status = 'open'
              limit 1`,
            [hotelId, businessDate, amount, session.staffId, stayId,
             Number(h[0]?.nightly ?? amount)]);
        }
      }
    }

    /* The balance decides. A guest cannot walk out owing money without
       somebody deciding to let them — and that decision is a transfer
       to the city ledger, which is itself a posting. */
    const { rows: bal } = await client.query<{ balance: string }>(
      `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as balance
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2
          and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
      [hotelId, stayId],
    );
    const balance = Math.round(Number(bal[0]?.balance ?? 0) * 100) / 100;

    if (balance > 0.5) {
      return refuse(
        /* `money()` rather than a bare toLocaleString: this printed
           "₹787.5" for seven hundred and eighty-seven fifty, which is
           not how anybody writes an amount they are asking a guest to
           pay. */
        `${money(balance)} is still outstanding. Settle the folio, ` +
          `or transfer it to the city ledger, before checking out.`
          /* SAY WHAT JUST HAPPENED. The late charge was posted moments
             ago by this very call, so the balance the clerk was looking
             at a second before does not match the one in this sentence.
             Without this line it reads as the system changing its mind. */
          + (isLate && !body.waiveLate
              ? " The late departure has been recorded and charged, which is"
                + " part of that figure."
              : ""),
      );
    }
    if (balance < -0.5) {
      return refuse(
        `The guest has overpaid by ${money(Math.abs(balance))}. ` +
          `Refund it before checking out.`,
      );
    }

    /* ── LEAVING EARLY (the owner's D27-315, Part A) ──────────────────
       Before the booked departure, the nights not stayed are not charged
       and go back on sale: the departure becomes the later of today and the
       day after the last night posted (leavingEarly, the audit's own rule),
       and the room hold is trimmed with it (app.amend_stay). Inventory, the
       push to booking sites, Due out and the reports read the booking's
       dates, so they follow. Nights posted are never removed.

       AFTER LATENESS WAS DECIDED, above, on the booked date: moved first,
       an early leaver would be "on the date" and charged a late fee
       (D27-314). After every refusal, before the status flips (MEMORY 243).
       A typed reason, kept on the booking as a rate change keeps its own. */
    const early = await leavingEarly(client, hotelId, stayId);
    if (early) {
      const why = body.earlyReason?.trim();
      if (!why) {
        return refuse(
          `Booked to leave on ${early.departure}. ${early.nightsFreed} `
          + `${early.nightsFreed === 1 ? "night is" : "nights are"} not stayed: `
          + "say why the guest is leaving early.",
          "leaving-early",
        );
      }
      await client.query(
        `select 1 from reservations r,
                app.amend_stay(r.hotel_id, r.id, r.check_in, $3::date,
                               r.adults, r.children, $4)
          where r.hotel_id = $1 and r.id = $2`,
        [hotelId, stayId, early.newDeparture, session.staffId]);
      await client.query(
        `update reservations
            set notes = concat_ws(' · ', nullif(notes, ''), $2::text)
          where id = $1`,
        [stayId, `Left early on ${early.today}, booked to ${early.departure}: ${why}`]);
    }

    const { rows: room } = await client.query<{ id: string; number: string }>(
      `select rm.id, rm.number
         from room_assignments ra
         join rooms rm on rm.id = ra.room_id
        where ra.reservation_id = $1 and ra.released_at is null
        limit 1`,
      [stayId],
    );

    await client.query(
      "update reservations set status = 'checked_out' where hotel_id = $1 and id = $2",
      [hotelId, stayId],
    );
    /* Their key cards stop (D27-178): after the last refusal, never one. */
    await cancelStaleKeys(client, hotelId, stayId);
    if (isForeign(stay.nationality)) {
      await saveVisit(client, hotelId, stayId, { nextDestination: nextDestination! });
    }
    if (stay.foreign_companion) {
      await saveCompanionsDeparture(client, hotelId, stayId, nextDestination!);
    }
    await client.query(
      "update folios set status = 'closed', closed_at = now() where hotel_id = $1 and reservation_id = $2",
      [hotelId, stayId],
    );
    /* A member's points for the stay (loyalty, D27-179). */
    await earnAtCheckOut(client, stayId);

    if (room[0]) {
      /* Releasing the assignment IS the room being vacated, and 070 puts
         the consequence there: vacant, and dirty, so it reaches
         housekeeping's board the moment the guest walks out rather than
         the next time somebody remembers.

         ⚠ THIS USED TO SET THE ROOM ITSELF, right here, and it was the
         only place that did — so a room vacated by a MOVE or an
         EXCHANGE stayed marked occupied and clean, and the next guest
         walked into a bed somebody had slept in.

         It was also less careful than the trigger that replaced it: it
         dirtied unconditionally, including a room held out of service
         for a leaking tap — which 022 gave its own state precisely so a
         check-out could not put it back into the cleaning queue and
         from there into inventory. */
      await client.query(
        "update room_assignments set released_at = now() where reservation_id = $1 and released_at is null",
        [stayId],
      );
    }

    return { ok: true, data: { room: room[0]?.number ?? null } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Assigning a room before arrival ──────────────────────────────────
   Check-in assigns a room AT arrival. This assigns one ahead of it —
   a confirmed booking that has a room TYPE and no room number yet.

   The tape chart's "Assign room" button had no handler at all, so the
   only way a reservation ever got a room was by checking the guest in.
   A hotel that pre-allocates its arrivals the night before could not.
   ═══════════════════════════════════════════════════════════════════ */
operations.post("/:code/stays/:id/assign", async (c) => {
  const body = await c.req.json<{ roomNumber?: string }>()
    .catch(() => ({}) as { roomNumber?: string });

  const roomNumber = body.roomNumber?.trim();
  if (!roomNumber) return c.json(refuse("Which room?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{
      status: string; check_in: string; check_out: string;
      room_type_id: string; guest: string; assigned: string | null;
    }>(
      `select r.status,
              to_char(r.check_in,'YYYY-MM-DD')  as check_in,
              to_char(r.check_out,'YYYY-MM-DD') as check_out,
              r.room_type_id::text, g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id and ra.released_at is null
                limit 1) as assigned
         from reservations r
         join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [stayId, hotelId],
    );
    if (!stay[0]) return refuse("No such reservation.");

    if (stay[0].assigned) {
      /* Named, because "already assigned" without the room number
         leaves the clerk to go and look. */
      return refuse(
        `${stay[0].guest} is already in room ${stay[0].assigned}. Move them ` +
        `from the room rather than assigning a second one.`,
      );
    }
    if (!["confirmed", "checked_in"].includes(stay[0].status)) {
      return refuse(
        `This booking is ${stay[0].status}, so there is nothing to put in a room.`,
      );
    }

    const { rows: room } = await client.query<{
      id: string; room_type_id: string; type_name: string; oos: boolean;
    }>(
      `select rm.id::text, rm.room_type_id::text, rt.name as type_name,
              (rm.housekeeping_status = 'out_of_service') as oos
         from rooms rm
         join room_types rt on rt.id = rm.room_type_id
        where rm.hotel_id = $1 and rm.number = $2 and rm.is_active`,
      [hotelId, roomNumber],
    );
    if (!room[0]) return refuse(`There is no room ${roomNumber} here.`);
    if (room[0].oos) {
      return refuse(`Room ${roomNumber} is out of service.`);
    }
    /* No block on any night it would hold (D27-339): from today for a guest
       already in, else from the arrival - a block entered ahead included. */
    const holdFrom = stay[0].status === "checked_in" ? await businessDateFor(client, hotelId) : stay[0].check_in;
    const blocked = await blockedFor(client, room[0].id, roomNumber, holdFrom, stay[0].check_out);
    if (blocked) return refuse(blocked);
    /* A guest already checked in goes into the room now (rule A). A booking
       not yet arrived is only held: its check-in asks on the day. */
    if (stay[0].status === "checked_in") {
      const inRoom = await stillIn(client, hotelId, room[0].id, roomNumber, [stayId]);
      if (inRoom) return refuse(inRoom);
    }

    /* A different room TYPE is allowed but said out loud. Upgrades and
       downgrades happen constantly; silently changing what the guest
       booked does not. */
    const typeChanged = room[0].room_type_id !== stay[0].room_type_id;

    try {
      /* 'arrival' and not 'assignment'. `ra_reason_valid` allows exactly
         arrival, move, upgrade, downgrade, fault, group_consolidation.
         I invented a seventh and Postgres refused the insert with a 500.

         This IS the assignment for their arrival; it just happens before
         they get here. A type change is surfaced to the clerk rather than
         recorded as upgrade/downgrade, because nothing here ranks the
         types and guessing the direction would be inventing again.

         Second time this shape has cost a round trip today: read the
         constraint, do not guess the value. */
      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1,$2,$3,$4::date,$5::date,'arrival')`,
        [hotelId, stayId, room[0].id, stay[0].check_in, stay[0].check_out],
      );
    } catch (error) {
      /* The EXCLUDE constraint refuses two stays overlapping in one
         room. That is the guarantee; this turns it into a sentence. */
      const e = error as { code?: string } | undefined;
      if (e?.code === "23P01" || e?.code === "23505") {
        return refuse(
          `Room ${roomNumber} is taken for part of ${stay[0].check_in} to ` +
          `${stay[0].check_out}. Pick another room, or shorten the stay.`,
        );
      }
      throw error;
    }

    return {
      ok: true as const,
      room: roomNumber,
      guest: stay[0].guest,
      typeChanged,
      typeName: room[0].type_name,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Moving a guest ───────────────────────────────────────────────
   The assign endpoint above already tells a clerk to "move them from the
   room rather than assigning a second one". This is that.

   THE MONEY IS NOT TOUCHED unless the caller says so. The audit posts
   `reservations.agreed_rate`, snapshotted at booking and deliberately never
   looked up again, so a move reprices nothing by itself. Nights already
   posted are never rewritten either — the guest genuinely slept in the old
   room, and the ledger is append-only.

   What CAN change is the rate from here onward, and only because the audit
   posts one night at a time. It is optional, and the room type changing is
   the case that makes it worth asking about. */
operations.post("/:code/stays/:id/move", async (c) => {
  type Body = {
    roomNumber?: string; from?: string; reason?: string;
    /* Optional. Applies to nights not yet posted, which is every night from
       tonight on — a posted night is history. On the arrival day tonight IS
       posted, at check-in (D27-204): that one line is put right too. */
    agreedRate?: number;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const roomNumber = input.roomNumber?.trim();
  if (!roomNumber) return c.json(refuse("Which room?"), 409);
  const from = input.from;
  if (!from) return c.json(refuse("Moving from which night?"), 409);

  const REASONS = ["move", "upgrade", "downgrade", "fault", "group_consolidation"];
  const reason = input.reason ?? "move";
  if (!REASONS.includes(reason)) {
    return c.json(refuse("Why are they moving?"), 409);
  }

  if (input.agreedRate !== undefined
      && (!Number.isFinite(input.agreedRate) || input.agreedRate < 0)) {
    return c.json(refuse("A rate is zero or more."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{
      status: string; guest: string; room_type_id: string; check_out: string;
    }>(
      `select r.status, g.full_name as guest, r.room_type_id::text,
              to_char(r.check_out,'YYYY-MM-DD') as check_out
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [stayId, hotelId],
    );
    if (!stay[0]) return refuse("No such reservation.");
    if (!["confirmed", "checked_in"].includes(stay[0].status)) {
      return refuse(
        `This booking is ${stay[0].status}, so there is nobody to move.`);
    }

    const { rows: room } = await client.query<{
      id: string; room_type_id: string; type_name: string; oos: boolean;
    }>(
      `select rm.id::text, rm.room_type_id::text, rt.name as type_name,
              (rm.housekeeping_status = 'out_of_service') as oos
         from rooms rm join room_types rt on rt.id = rm.room_type_id
        where rm.hotel_id = $1 and rm.number = $2 and rm.is_active`,
      [hotelId, roomNumber],
    );
    if (!room[0]) return refuse(`There is no room ${roomNumber} here.`);
    if (room[0].oos) return refuse(`Room ${roomNumber} is out of service.`);
    /* No block on any night from the move to the departure (D27-339). */
    const blocked = await blockedFor(client, room[0].id, roomNumber, from, stay[0].check_out);
    if (blocked) return refuse(blocked);

    /* A checked-in guest moved from tonight (or earlier) goes in now (rule
       A). A move for a later night, or of a booking not yet arrived, is a
       hold changing. Asked before app.move_room writes anything. */
    if (stay[0].status === "checked_in"
        && from <= await businessDateFor(client, hotelId)) {
      const inRoom = await stillIn(client, hotelId, room[0].id, roomNumber, [stayId]);
      if (inRoom) return refuse(inRoom);
    }

    /* TONIGHT FOLLOWS THE NEW RATE ON THE ARRIVAL DAY TOO (the owner's
       D27-205). A new rate has always applied "from tonight forward"; since
       D27-204 tonight's night is posted at check-in, so the move puts that
       one line right - finance's Edit: the old line reversed with the reason,
       the corrected one posted. The desk may do it through the move, though
       it edits no other charge. Before app.move_room writes: Edit asks all
       its questions before its first write, so a refusal changes nothing
       (MEMORY 243). */
    if (input.agreedRate !== undefined && stay[0].status === "checked_in") {
      const today = await businessDateFor(client, hotelId);
      const { rows: tonight } = from > today ? { rows: [] } : await client.query<{ id: string }>(
        `select fp.id::text from folio_postings fp
          where fp.hotel_id = $1 and fp.reservation_id = $2 and fp.category = 'room'
            and fp.source_type = 'check_in' and fp.business_date = $3::date
            and fp.amount <> $4::numeric and fp.reverses_id is null
            and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
        [hotelId, stayId, today, input.agreedRate.toFixed(2)]);
      if (tonight[0]) {
        const done = await editFolioCharge(client, hotelId, tonight[0].id,
          { amount: input.agreedRate, reason: `Room move: ${reason}` }, { reservationId: stayId });
        if (!done.ok) return refuse(`Tonight is already charged. ${done.reason}`);
      }
    }

    try {
      const { rows: moved } = await client.query<{
        left_room: string; nights_before: number; nights_after: number;
      }>(
        `select left_room, nights_before, nights_after
           from app.move_room($1,$2,$3,$4::date,$5,$6)`,
        [hotelId, stayId, room[0].id, input.from, reason, session.staffId],
      );

      if (input.agreedRate !== undefined) {
        await client.query(
          `update reservations set agreed_rate = $1 where id = $2`,
          [input.agreedRate.toFixed(2), stayId]);
      }
      /* Moved from tonight: the old room's key cards stop (D27-178). */
      await cancelStaleKeys(client, hotelId, stayId);

      return {
        ok: true as const,
        guest: stay[0].guest,
        from: moved[0]!.left_room,
        to: roomNumber,
        nightsBefore: moved[0]!.nights_before,
        nightsAfter: moved[0]!.nights_after,
        /* Said out loud rather than done quietly, the same as on assign. */
        typeChanged: room[0].room_type_id !== stay[0].room_type_id,
        typeName: room[0].type_name,
        rateChanged: input.agreedRate !== undefined,
      };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      /* The EXCLUDE constraint is the guarantee; this turns it into a
         sentence a clerk can act on. */
      if (e?.code === "23P01" || e?.code === "23505") {
        return refuse(
          `Room ${roomNumber} is taken for part of that time. Pick another ` +
          `room, or move them on a different night.`);
      }
      /* app.move_room raises its own, already written for a person. */
      if (e?.code === "P0001" && e.message) return refuse(e.message);
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Amending a stay ──────────────────────────────────────────────
   Dates and party size. The room hold moves with the booking, because a
   booking that says six nights while the room is held for four is invisible
   on every screen until the sixth night's guest opens an occupied door.

   The rate is deliberately not here. `agreed_rate` is snapshotted at booking,
   so two extra nights are charged at the rate the guest agreed to — which is
   what a guest expects, and changing it is somebody's decision rather than a
   side effect of extending a stay. */
operations.patch("/:code/stays/:id", async (c) => {
  type Body = {
    checkIn?: string; checkOut?: string;
    adults?: number; children?: number;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    /* Every field is optional and absent means UNCHANGED, so the current row
       is read first. A PATCH that treated a missing key as null would shorten
       a stay to nothing because a form did not send a field. */
    const { rows: now } = await client.query<{
      check_in: string; check_out: string;
      adults: number; children: number; guest: string;
    }>(
      `select to_char(r.check_in,'YYYY-MM-DD')  as check_in,
              to_char(r.check_out,'YYYY-MM-DD') as check_out,
              r.adults, r.children, g.full_name as guest
         from reservations r join guests g on g.id = r.guest_id
        where r.id = $1 and r.hotel_id = $2`,
      [stayId, hotelId],
    );
    if (!now[0]) return refuse("No such reservation.");

    const checkIn  = input.checkIn  ?? now[0].check_in;
    const checkOut = input.checkOut ?? now[0].check_out;
    const adults   = input.adults   ?? now[0].adults;
    const children = input.children ?? now[0].children;

    /* FD-4, FD-6, FD-9 (QA, 28 September): children -1 was saved (055
       checks only adults), a cleared arrival reached the database as NaN
       nights, and nothing capped the length. The owner: 90 nights at most. */
    const typed = dateProblem(checkIn) ?? dateProblem(checkOut)
      ?? countProblem(adults, "Adults", 1) ?? countProblem(children, "Children", 0);
    if (typed) return refuse(typed);
    const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
    if (nights > MAX_NIGHTS) {
      return refuse(`A stay is at most ${MAX_NIGHTS} nights. Split a longer one into two bookings.`);
    }
    /* A DAY USE STAYS ONE, AND A STAY STAYS A STAY (D27-229): a day use's rate
       is its typed day price, a stay's is a night's - turned into the other,
       the same figure would be charged as the wrong thing. */
    const wasDayUse = now[0].check_in === now[0].check_out;
    if ((checkIn === checkOut) !== wasDayUse) {
      return refuse(wasDayUse
        ? "A day use stays a day use: its price is the day's. To stay the night, book the nights."
        : "A stay does not become a day use here: book the day use on New booking, with its day price.");
    }

    try {
      const { rows } = await client.query<{
        nights_before: number; nights_after: number; room_held: string | null;
      }>(
        `select nights_before, nights_after, room_held
           from app.amend_stay($1,$2,$3::date,$4::date,$5::smallint,$6::smallint,$7)`,
        [hotelId, stayId, checkIn, checkOut, adults, children, session.staffId],
      );

      return {
        ok: true as const,
        guest: now[0].guest,
        checkIn, checkOut, adults, children,
        nightsBefore: rows[0]!.nights_before,
        nightsAfter: rows[0]!.nights_after,
        roomHeld: rows[0]!.room_held,
      };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23P01" || e?.code === "23505") {
        /* The room is taken for the nights being added. The booking is
           untouched — the whole call rolled back — so the sentence says what
           to do rather than what half-happened. */
        return refuse(
          `${now[0].guest} is in a room that is taken for part of ${checkIn}` +
          ` to ${checkOut}. Move them to another room first, or pick` +
          ` different dates.`);
      }
      if (e?.code === "P0001" && e.message) return refuse(e.message);
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

operations.post("/:code/stays/:id/unassign", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    try {
      const { rows } = await client.query<{ room: string }>(
        `select app.unassign_room($1,$2) as room`,
        [hotelId, c.req.param("id")]);
      return { ok: true as const, room: rows[0]!.room };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "P0001" && e.message) return refuse(e.message);
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Void — which is not cancel ────────────────────────────────────
   Cancelled HAPPENED and was undone: it may carry a cancellation
   charge, and it belongs in cancellation statistics because a guest
   did something a hotel wants to measure.

   Void NEVER HAPPENED. A duplicate, a test, a booking typed against
   the wrong property. No charge, no revenue, and it must stay out of
   cancellation statistics too — counting it there inflates a number
   somebody makes decisions from.

   Both stay on the record. Neither is deleted, for the same reason a
   struck POS line is kept: a booking that vanishes is one nobody can
   account for. */

operations.post("/:code/stays/:id/void", async (c) => {
  type VoidBody = { reason?: string };
  const input = await c.req.json<VoidBody>().catch(() => ({}) as VoidBody);

  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "Why is this being voided? “Entered twice”, “wrong property”, " +
      "“test booking”. It stays on the record with this reason."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows } = await client.query<{
      status: string; reference: string;
    }>(
      `select status, reference from reservations
        where id = $1 and hotel_id = $2`,
      [stayId, hotelId],
    );
    const stay = rows[0];
    if (!stay) return refuse("No such booking.");

    if (stay.status === "void") return refuse("This booking is already void.");

    /* A guest who arrived cannot un-arrive. Voiding a stay somebody
       occupied would remove a night the hotel actually sold. */
    if (["checked_in", "checked_out"].includes(stay.status)) {
      return refuse(
        `${stay.reference} has been checked ${stay.status === "checked_in" ? "in" : "out"}. ` +
        "A stay that happened cannot be made not to have happened - " +
        "reverse the charges instead.");
    }

    /* THE LINE BETWEEN VOID AND CANCEL. Money on the folio means the
       booking was real enough to be billed, and erasing it would take
       a posting out of an append-only ledger by the back door. */
    const { rows: posted } = await client.query<{ n: string }>(
      `select count(*)::text as n
         from folio_postings p
         join folios f on f.id = p.folio_id
        where f.reservation_id = $1`,
      [stayId],
    );
    if (Number(posted[0]!.n) > 0) {
      return refuse(
        `${stay.reference} already has charges on its folio. That is a ` +
        "cancellation, not a void - cancel it so the terms and any charge " +
        "are applied.");
    }

    await client.query(
      `update reservations
          set status = 'void', void_reason = $1, voided_by = $2,
              voided_at = now(), updated_at = now()
        where id = $3`,
      [reason, session.staffId, stayId],
    );

    /* The room comes back on its own — a trigger in 043 releases the
       assignment, because a voided booking holding a room out of
       inventory is found weeks later by a clerk who cannot sell a room
       that looks empty. */
    return { ok: true as const, data: { reference: stay.reference } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
