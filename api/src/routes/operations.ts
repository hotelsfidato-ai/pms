import { Hono } from "hono";
import { withSession, type Session } from "../auth.ts";
import type { Client } from "../db.ts";
import { resolveDate, businessDateFor } from "../businessDate.ts";

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
  | { ok: false; reason: string };

const refuse = (reason: string): Outcome => ({ ok: false, reason });

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
  identity?: {
    idType?: string;
    idNumber?: string;
    nationality?: string;
    passportExpiry?: string;
    visaNumber?: string;
    visaExpiry?: string;
    addressLine?: string;
    city?: string;
    country?: string;
  };
  idSkipReason?: string;
  /* Absent means "the property's own operating day", resolved from the
     database. It used to mean the server's wall clock, which dated a
     00:40 settlement to tomorrow — filed under a day the hotel had not
     reached, and missing from the night audit that closed the real one. */
  businessDate?: string;
  user?: string;
}

operations.post("/:code/stays/:id/check-in", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as CheckInBody;
  const stayId = c.req.param("id");

  const result = await withSession(
    c.get("subject"),
    async (client, session: Session): Promise<Outcome | null> => {
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
      }>(
        `select id, status, check_in::text, check_out::text, room_type_id,
                notes, guest_id
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
         override for the audit's own replay. */
      const { rows: bdRows } = await client.query<{ bd: string }>(
        `select business_date::text as bd from hotels where id = $1`,
        [hotelId]);
      const businessDate = body.businessDate ?? bdRows[0]!.bd;

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
          + "checked in early if a room is free — give a reason and it moves "
          + "to today.",
        );
      }

      /* A document is captured when a TYPE and a NUMBER arrive together.
         Either alone is a half-filled form, and the database refuses it
         anyway (gd_number_present, 026) — better to say so in a sentence
         than to let a check constraint surface as an error code. */
      const identity = body.identity;
      const captured = Boolean(
        identity?.idType && identity.idNumber?.trim(),
      );

      if (!captured && !body.idSkipReason?.trim()) {
        return refuse(
          "Record the guest's ID document — type and number — or give a " +
            "reason for skipping it.",
        );
      }
      if (identity?.idType && !identity.idNumber?.trim()) {
        return refuse(`A ${identity.idType} needs its number.`);
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

      const roomNumber = body.roomNumber?.trim();
      if (!roomNumber) return refuse("Choose a room.");

      const { rows: roomRows } = await client.query<{
        id: string;
        room_type_id: string;
        housekeeping_status: string;
      }>(
        `select id, room_type_id, housekeeping_status
           from rooms
          where hotel_id = $1 and number = $2 and is_active`,
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
      if (room.room_type_id !== stay.room_type_id) {
        return refuse("That room is a different type from the one booked.");
      }

      /* The room must be free for the WHOLE stay, not merely tonight.
         The EXCLUDE constraint on room_assignments would catch an
         overlap anyway — but it would arrive as a constraint name, and
         a clerk needs a sentence. */
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
        [room.id, stayId, stay.check_in, stay.check_out],
      );
      if (clash[0]) {
        return refuse(`Room ${roomNumber} is held by ${clash[0].reference} for part of that stay.`);
      }

      const notes = captured
        ? stay.notes
        : [stay.notes, `ID not captured — ${body.idSkipReason}`]
            .filter(Boolean)
            .join(" · ");

      await client.query(
        `update reservations
            set status = 'checked_in',
                adults = coalesce($3, adults),
                children = coalesce($4, children),
                occupancy = coalesce($3, adults) + coalesce($4, children),
                meal_plan = coalesce($5, meal_plan),
                notes = $6
          where hotel_id = $1 and id = $2`,
        [hotelId, stayId, body.adults ?? null, body.children ?? null,
         body.ratePlan === "Room Only" ? "RO" : body.ratePlan ?? null, notes],
      );

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
           the clerk deciding not to — a decision worth being able to
           make, and worth being visible by its absence on the bill. */
        if (!body.waiveEarly && isEarly) {
          /* CGST + SGST, which is how this schema stores it — there is
             no single `gst_rate` column and assuming one is how a
             charge lands with no tax on it. */
          const { rows: h } = await client.query<{ charge: string | null; tax: string }>(
            `select early_checkin_charge::text as charge,
                    (coalesce(cgst_rate,0) + coalesce(sgst_rate,0))::text as tax
               from hotels where id = $1`, [hotelId]);
          const amount = h[0]?.charge === null || h[0]?.charge === undefined
            ? null : Number(h[0].charge);
          if (amount !== null && amount > 0) {
            const rate = Number(h[0]!.tax);
            const tax = Math.round(amount * rate) / 100;
            await client.query(
              `insert into folio_postings
                 (hotel_id, folio_id, business_date, category, description,
                  amount, tax_rate, tax_amount, source_type, posted_by)
               select $1, f.id, $2::date, 'misc', 'Early check-in',
                      $3, $4, $5, 'front_desk', $6
                 from folios f
                where f.reservation_id = $7 and f.status = 'open'
                limit 1`,
              [hotelId, businessDate, amount, rate, tax, session.staffId, stayId]);
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
        await client.query(
          `insert into guest_documents
             (guest_id, id_type, id_number, passport_expiry, visa_number,
              visa_expiry, address_line, city, country,
              captured_by, captured_at)
           values ($1,$2,$3,$4::date,$5,$6::date,$7,$8,$9,
                   app.current_user_id(), now())
           on conflict (guest_id) do update set
             id_type         = excluded.id_type,
             id_number       = excluded.id_number,
             passport_expiry = coalesce(excluded.passport_expiry,
                                        guest_documents.passport_expiry),
             visa_number     = coalesce(excluded.visa_number,
                                        guest_documents.visa_number),
             visa_expiry     = coalesce(excluded.visa_expiry,
                                        guest_documents.visa_expiry),
             address_line    = coalesce(excluded.address_line,
                                        guest_documents.address_line),
             city            = coalesce(excluded.city, guest_documents.city),
             country         = coalesce(excluded.country, guest_documents.country),
             captured_by     = excluded.captured_by,
             captured_at     = excluded.captured_at`,
          [stay.guest_id, identity.idType, identity.idNumber!.trim(),
           identity.passportExpiry || null, identity.visaNumber || null,
           identity.visaExpiry || null, identity.addressLine || null,
           identity.city || null, identity.country || null],
        );
      }

      /* Nationality lives on the GUEST, not the document — it is a fact
         about the person, and it is what the Form C register filters
         on. Only written when supplied: the column defaults to 'IN',
         and overwriting a recorded nationality with a default because
         a form field was left empty would remove a foreign national
         from the register entirely. */
      if (identity?.nationality?.trim()) {
        await client.query(
          "update guests set nationality = $2 where id = $1",
          [stay.guest_id, identity.nationality.trim().toUpperCase()],
        );
      }

      /* Replace rather than add. A booking pre-assigned to one room and
         checked into another must not end up holding both. */
      await client.query(
        `update room_assignments set released_at = now()
          where reservation_id = $1 and released_at is null and room_id <> $2`,
        [stayId, room.id],
      );
      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1, $2, $3, $4, $5, 'arrival')
         on conflict do nothing`,
        [hotelId, stayId, room.id, stay.check_in, stay.check_out],
      );

      await client.query(
        "update rooms set occupancy_status = 'occupied' where id = $1",
        [room.id],
      );

      void session;
      return { ok: true };
    },
  );

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ══════════════════════════════════════════════════════════════════
   THE LEDGER

   Append-only, enforced by a trigger — `folio_postings_append_only`.
   A wrong charge is REVERSED with a second row; nothing is edited and
   nothing is deleted. That means `count(*)` goes UP when something is
   undone, which is the opposite of what most people expect and exactly
   what makes the ledger auditable.

   Every posting needs a folio. A reservation has one from check-in, so
   `folioFor` opens one on demand rather than failing on a stay that has
   not been billed yet — an empty folio is a normal state.
   ══════════════════════════════════════════════════════════════════ */

async function folioFor(
  client: Client, hotelId: string, stayId: string,
): Promise<string | null> {
  const { rows: existing } = await client.query<{ id: string }>(
    "select id from folios where hotel_id = $1 and reservation_id = $2 limit 1",
    [hotelId, stayId],
  );
  if (existing[0]) return existing[0].id;

  const { rows: res } = await client.query(
    "select 1 from reservations where hotel_id = $1 and id = $2",
    [hotelId, stayId],
  );
  if (!res.length) return null;

  const { rows: made } = await client.query<{ id: string }>(
    `insert into folios (hotel_id, reservation_id, status)
     values ($1, $2, 'open') returning id`,
    [hotelId, stayId],
  );
  return made[0]?.id ?? null;
}

/** The interface's categories, and the schema's. */
const CATEGORY: Record<string, string> = {
  Room: "room", "Room posting": "room",
  Food: "food", Beverage: "beverage", Beverages: "beverage",
  Spa: "spa", Laundry: "laundry", Minibar: "minibar",
  Telephone: "telephone", Miscellaneous: "misc", Misc: "misc",
  Discount: "discount", Payment: "payment", Refund: "refund",
};

const PAYMENT_METHOD: Record<string, string> = {
  Cash: "cash", UPI: "upi", "Credit Card": "card", "Debit Card": "card",
  "Net Banking": "netbanking", Wallet: "wallet", Cheque: "cheque",
  "Bank Transfer": "bank_transfer", "Bill to company": "city_ledger",
  "Room Posting": "city_ledger",
};

/* ── Post a charge ───────────────────────────────────────────────── */

operations.post("/:code/stays/:id/charges", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    category?: string; description?: string; amount?: number;
    taxable?: boolean; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const description = body.description?.trim();
    if (!description) return refuse("A charge needs a description.");
    if (!body.amount) return refuse("A charge of zero is not a charge.");

    const { rows } = await client.query<{ status: string }>(
      "select status from reservations where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")],
    );
    const stay = rows[0];
    if (!stay) return refuse("Reservation not found.");
    if (stay.status === "cancelled") return refuse("This booking was cancelled.");
    if (stay.status === "checked_out") {
      return refuse("This folio is closed. Reopen the stay to post to it.");
    }

    const folioId = await folioFor(client, hotelId, c.req.param("id"));
    if (!folioId) return refuse("Could not open a folio for this stay.");

    /* The property's own rate, not a constant. GST is a state subject
       and a property that crosses the tariff threshold moves to 9+9. */
    const { rows: rate } = await client.query<{ total: string }>(
      "select (cgst_rate + sgst_rate)::text as total from hotels where id = $1",
      [hotelId],
    );
    const taxRate = body.taxable ? Number(rate[0]?.total ?? 5) : 0;
    const amount = Math.round(body.amount * 100) / 100;
    const taxAmount = Math.round(amount * taxRate) / 100;

    const { rows: made } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id::text`,
      [hotelId, folioId, await resolveDate(client, hotelId, body.businessDate),
       CATEGORY[body.category ?? "Miscellaneous"] ?? "misc",
       description, amount, taxRate, taxAmount],
    );

    return { ok: true, data: { id: made[0]?.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Reverse one ─────────────────────────────────────────────────── */

operations.post("/:code/stays/:id/charges/:postingId/reverse", async (c) => {
  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const postingId = c.req.param("postingId");

    const { rows } = await client.query<{
      id: string; folio_id: string; business_date: string; category: string;
      description: string; amount: string; tax_rate: string; tax_amount: string;
      reverses_id: string | null; already: boolean;
    }>(
      `select fp.id::text, fp.folio_id, fp.business_date::text, fp.category,
              fp.description, fp.amount, fp.tax_rate, fp.tax_amount,
              fp.reverses_id::text,
              exists (select 1 from folio_postings r where r.reverses_id = fp.id) as already
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2 and fp.id = $3::bigint`,
      [hotelId, c.req.param("id"), postingId],
    );

    const p = rows[0];
    if (!p) return refuse("Posting not found.");
    if (p.already) return refuse("That posting has already been reversed.");
    if (p.reverses_id) return refuse("A reversal cannot itself be reversed.");

    /* The reversal is its OWN row, pointing at what it undoes. The
       original stays exactly as it was — that is the whole point of an
       append-only ledger, and it is why the posting count goes UP.

       No lock. `pms_app` has no UPDATE on this table (append-only), so
       `SELECT ... FOR UPDATE` is refused outright — the permission was
       telling me the lock was the wrong tool. Migration 021 puts a
       unique index on `reverses_id` instead, so two concurrent
       reversals leave one inserted and one refused by the database. */
    try {
      const { rows: made } = await client.query<{ id: string }>(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, reverses_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint)
         returning id::text`,
        [hotelId, p.folio_id, p.business_date, p.category,
         `Reversal — ${p.description}`,
         -Number(p.amount), p.tax_rate, -Number(p.tax_amount), postingId],
      );
      return { ok: true, data: { id: made[0]?.id } };
    } catch (error) {
      /* The index caught a second reversal. That is a refusal a clerk
         can act on, not a server error — somebody else got there
         first, and the credit is already on the folio. */
      if ((error as { code?: string }).code === "23505") {
        return refuse("That posting has already been reversed.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Take a payment ──────────────────────────────────────────────── */

operations.post("/:code/stays/:id/payments", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    method?: string; amount?: number; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (!body.amount || body.amount <= 0) {
      return refuse("A payment must be greater than zero.");
    }
    const method = PAYMENT_METHOD[body.method ?? "Cash"];
    if (!method) return refuse(`"${body.method}" is not a payment method.`);

    const folioId = await folioFor(client, hotelId, c.req.param("id"));
    if (!folioId) return refuse("Reservation not found.");

    /* A payment is a NEGATIVE posting. The balance is the sum of the
       ledger, so money received reduces it by being part of the sum —
       there is no separate "paid" column to keep in step. */
    const { rows: made } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,'payment',$4,$5,0,0)
       returning id::text`,
      [hotelId, folioId,
       await resolveDate(client, hotelId, body.businessDate),
       method === "city_ledger"
         ? "Transferred to city ledger"
         : `Received — ${body.method}`,
       -Math.round(body.amount * 100) / 100],
    );

    await client.query(
      `insert into payments (hotel_id, posting_id, method, amount)
       values ($1, $2::bigint, $3, $4)`,
      [hotelId, made[0]?.id, method, Math.round(body.amount * 100) / 100],
    );

    return { ok: true, data: { id: made[0]?.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Is an arrival right now early, and what does it cost? ─────────
   Asked of the SERVER, against the property's clock. A tablet with the
   wrong time set must not be able to make an early arrival look like an
   ordinary one — and the check-in route refuses independently either
   way, so this is what the screen shows, never what it decides. */
operations.get("/:code/early-arrival", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
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
    };
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
  };
  const body = (await c.req.json().catch(() => ({}))) as CheckOutBody;

  const result = await withSession(c.get("subject"), async (client, session): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const stayId = c.req.param("id");

    const { rows } = await client.query<{ status: string }>(
      `select status from reservations
        where hotel_id = $1 and id = $2 for update`,
      [hotelId, stayId],
    );
    const stay = rows[0];
    if (!stay) return refuse("Reservation not found.");
    if (stay.status === "checked_out") return refuse("This stay has already departed.");
    if (stay.status !== "checked_in") return refuse("Only a checked-in guest can check out.");

    /* ── LEAVING LATE ───────────────────────────────────────────────
       The mirror of arriving early, and the same shape: allowed, never
       silent. A guest still in the room at four has kept it out of
       tonight's inventory, and housekeeping cannot turn it around for
       an arrival that is already on the chart.

       Checked BEFORE the balance, deliberately. A late charge is part
       of what they owe, so testing the balance first would pass them
       on a total that is about to change — and then refuse the
       check-out they were just told they could have. */
    const { rows: lateRows } = await client.query<{ late: boolean }>(
      `select app.departure_is_late($1, now()) as late`, [hotelId]);
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
            ? `, and carries a ${Number(charge).toFixed(2)} charge.`
            : ". The property does not charge for one.")
      );
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
        const { rows: h } = await client.query<{
          charge: string | null; tax: string; bd: string;
        }>(
          `select late_checkout_charge::text as charge,
                  (coalesce(cgst_rate,0) + coalesce(sgst_rate,0))::text as tax,
                  business_date::text as bd
             from hotels where id = $1`, [hotelId]);
        const amount = h[0]?.charge === null || h[0]?.charge === undefined
          ? null : Number(h[0].charge);
        if (amount !== null && amount > 0) {
          const rate = Number(h[0]!.tax);
          const tax = Math.round(amount * rate) / 100;
          await client.query(
            `insert into folio_postings
               (hotel_id, folio_id, business_date, category, description,
                amount, tax_rate, tax_amount, source_type, posted_by)
             select $1, f.id, $2::date, 'misc', 'Late check-out',
                    $3, $4, $5, 'front_desk', $6
               from folios f
              where f.reservation_id = $7 and f.status = 'open'
              limit 1`,
            [hotelId, h[0]!.bd, amount, rate, tax, session.staffId, stayId]);
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
        `₹${balance.toLocaleString("en-IN")} is still outstanding. Settle the folio, ` +
          `or transfer it to the city ledger, before checking out.`,
      );
    }
    if (balance < -0.5) {
      return refuse(
        `The guest has overpaid by ₹${Math.abs(balance).toLocaleString("en-IN")}. ` +
          `Refund it before checking out.`,
      );
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
    await client.query(
      "update folios set status = 'closed', closed_at = now() where hotel_id = $1 and reservation_id = $2",
      [hotelId, stayId],
    );

    if (room[0]) {
      /* The room releases, becomes vacant, and becomes DIRTY — which is
         how it reaches housekeeping's board the moment the guest walks
         out, rather than the next time somebody remembers. */
      await client.query(
        "update room_assignments set released_at = now() where reservation_id = $1 and released_at is null",
        [stayId],
      );
      await client.query(
        `update rooms set occupancy_status = 'vacant', housekeeping_status = 'dirty'
          where id = $1`,
        [room[0].id],
      );
    }

    return { ok: true, data: { room: room[0]?.number ?? null } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ── A walk-in ────────────────────────────────────────────────────
   One act, not a booking followed by a check-in. The guest is at the
   desk; they arrive checked in, in a room, with the first night on
   the folio.

   It creates a GUEST too. There is no guest record to look up — that
   is what "walk-in" means — and the schema requires one, correctly: a
   reservation without a guest is a room held for nobody.
   ═══════════════════════════════════════════════════════════════ */

operations.post("/:code/walk-ins", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    guestName?: string; roomNumber?: string; nights?: number;
    adults?: number; children?: number; ratePlan?: string;
    rackTariff?: number; offeredTariff?: number;
    overrideReason?: string; businessDate?: string;
    /* Where it came from, captured AT THE DESK. This cannot be
       back-filled — a month later nobody remembers which agent sent a
       walk-in, and the source-mix report is built from exactly this. */
    businessSource?: string; marketSegment?: string; salesPerson?: string;
    isSingleLady?: boolean;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const guestName = body.guestName?.trim();
    if (!guestName) return refuse("A walk-in needs a guest name.");

    const nights = body.nights ?? 1;
    if (nights < 1) return refuse("A stay is at least one night.");

    const roomNumber = body.roomNumber?.trim();
    if (!roomNumber) return refuse("Choose a room.");

    const businessDate = await resolveDate(client, hotelId, body.businessDate);

    const { rows: roomRows } = await client.query<{
      id: string; room_type_id: string; housekeeping_status: string;
      occupancy_status: string; base_rate: string | null;
    }>(
      `select rm.id, rm.room_type_id, rm.housekeeping_status,
              rm.occupancy_status, rt.base_rate
         from rooms rm
         join room_types rt on rt.id = rm.room_type_id
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
    if (room.occupancy_status === "occupied") {
      return refuse("Somebody is already in that room.");
    }

    const departure = new Date(`${businessDate}T00:00:00Z`);
    departure.setUTCDate(departure.getUTCDate() + nights);
    const checkOut = departure.toISOString().slice(0, 10);

    /* The room must be free for the whole stay, not merely tonight. */
    const { rows: clash } = await client.query<{ reference: string }>(
      `select r.reference
         from room_assignments ra
         join reservations r on r.id = ra.reservation_id
        where ra.room_id = $1 and ra.released_at is null
          and daterange(ra.from_date, greatest(ra.to_date, ra.from_date + 1), '[)')
              && daterange($2::date, $3::date, '[)')
        limit 1`,
      [room.id, businessDate, checkOut],
    );
    if (clash[0]) {
      return refuse(`Room ${roomNumber} is held by ${clash[0].reference} for part of that stay.`);
    }

    const { rows: guestRows } = await client.query<{ id: string }>(
      "insert into guests (full_name) values ($1) returning id",
      [guestName],
    );

    /* The per-hotel reference sequence. `nextReference()` in the store
       generated one client-side, which cannot stay unique once two
       clerks are taking walk-ins at the same desk. */
    const { rows: refRows } = await client.query<{ reference: string }>(
      `select 'FH-' || to_char(now(), 'YYMM') || '-' ||
              lpad((coalesce(max(substring(reference from '[0-9]+$')::int), 5000) + 1)::text, 4, '0')
              as reference
         from reservations where hotel_id = $1`,
      [hotelId],
    );

    /* A NULL RACK RATE MUST REFUSE, NOT DEFAULT TO NOTHING.

       This was `body.offeredTariff ?? Number(room.base_rate)`, which was
       safe only while base_rate could not be null. 032 made it nullable —
       the system ships no price and the hotel enters its own — and
       `Number(null)` is 0, so a walk-in into an unpriced room type would
       have been checked in free, posted a zero room charge at the night
       audit, and halved the day's ADR without anything looking wrong. */
    const rack = room.base_rate === null ? null : Number(room.base_rate);
    const offered = body.offeredTariff ?? rack;

    if (offered === null || !Number.isFinite(offered)) {
      return refuse(
        `That room type has no rate set, so there is ` +
        `nothing to charge. Enter a tariff for this stay, or set the rate ` +
        `for the room type first.`,
      );
    }
    const notes = body.overrideReason?.trim()
      ? `Rate override — ${body.overrideReason.trim()}`
      : null;

    const { rows: made } = await client.query<{ id: string }>(
      `insert into reservations
         (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
          adults, children, occupancy, agreed_rate, status, source,
          meal_plan, notes,
          business_source, market_segment, sales_person, is_single_lady)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'checked_in','walk_in',$11,$12,
               $13,$14,$15,$16)
       returning id`,
      [hotelId, refRows[0]?.reference, guestRows[0]?.id, room.room_type_id,
       businessDate, checkOut, body.adults ?? 1, body.children ?? 0,
       (body.adults ?? 1) + (body.children ?? 0), offered,
       body.ratePlan === "Room Only" ? "RO" : body.ratePlan ?? null, notes,
       /* Blank stays NULL. An empty segment must not become the string
          "" — it would sort and group as its own category in the report
          and read as a real answer somebody gave. */
       body.businessSource?.trim() || null,
       body.marketSegment?.trim() || null,
       body.salesPerson?.trim() || null,
       body.isSingleLady === true],
    );
    const stayId = made[0]!.id;

    /* 'arrival', not 'walk_in'. ra_reason_valid does not list the
       latter and should not: a walk-in IS an arrival — the guest turns
       up and is given a room. The reason records what happened to the
       ROOM, not how the booking was taken.

       (Comment outside the template literal. A backtick inside one
       ends it — that is the second time, so: no backticks in SQL.) */
    await client.query(
      `insert into room_assignments
         (hotel_id, reservation_id, room_id, from_date, to_date, reason)
       values ($1,$2,$3,$4,$5,'arrival')`,
      [hotelId, stayId, room.id, businessDate, checkOut],
    );
    await client.query(
      "update rooms set occupancy_status = 'occupied' where id = $1",
      [room.id],
    );

    const { rows: folio } = await client.query<{ id: string }>(
      `insert into folios (hotel_id, reservation_id, status)
       values ($1, $2, 'open') returning id`,
      [hotelId, stayId],
    );

    const { rows: rate } = await client.query<{ total: string }>(
      "select (cgst_rate + sgst_rate)::text as total from hotels where id = $1",
      [hotelId],
    );
    const amount = Math.round(offered * nights * 100) / 100;
    const taxRate = Number(rate[0]?.total ?? 5);

    await client.query(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,'room',$4,$5,$6,$7)`,
      [hotelId, folio[0]?.id, businessDate,
       `Room ${roomNumber} · ${nights} night${nights === 1 ? "" : "s"}`,
       amount, taxRate, Math.round(amount * taxRate) / 100],
    );

    return { ok: true, data: { id: stayId, reference: refRows[0]?.reference } };
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
       tonight on — a posted night is history. */
    agreedRate?: number;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const roomNumber = input.roomNumber?.trim();
  if (!roomNumber) return c.json(refuse("Which room?"), 409);
  if (!input.from) return c.json(refuse("Moving from which night?"), 409);

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
      status: string; guest: string; room_type_id: string;
    }>(
      `select r.status, g.full_name as guest, r.room_type_id::text
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
        "A stay that happened cannot be made not to have happened — " +
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
        "cancellation, not a void — cancel it so the terms and any charge " +
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


/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK SHIFT

   Open with a float, take receipts, count the drawer, hand over.
   The POS day end's shape, deliberately — a front office that
   reasons about its cash differently from its restaurant is one
   where the two get compared and nobody can.
   ══════════════════════════════════════════════════════════════════ */

operations.get("/:code/cashier-shift", async (c) => {
  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    const { rows: open } = await client.query<{
      id: string; opening: string; opened_at: string; counted: string | null;
      variance_reason: string | null;
    }>(
      `select id::text, opening_cash::text as opening,
              to_char(opened_at,'HH24:MI') as opened_at,
              counted_cash::text as counted, variance_reason
         from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId],
    );

    /* No open drawer is a real state, not an error: the shift has not
       started. The screen offers to open one, and shows the last close
       so somebody taking over knows what they were handed. */
    if (!open[0]) {
      const { rows: last } = await client.query<{
        closed_at: string; counted: string; handed_to: string | null;
      }>(
        `select to_char(cs.closed_at,'DD Mon, HH24:MI') as closed_at,
                cs.counted_cash::text as counted, s.full_name as handed_to
           from cashier_shifts cs
           left join staff s on s.id = cs.handed_to
          where cs.hotel_id = $1 and cs.staff_id = $2
            and cs.closed_at is not null
          order by cs.closed_at desc limit 1`,
        [hotelId, session.staffId]);
      return {
        businessDate,
        shift: null,
        colleagues: [],
        previous: last[0]
          ? { closedAt: last[0].closed_at, counted: Number(last[0].counted),
              handedTo: last[0].handed_to }
          : null,
      };
    }

    const shiftId = open[0].id;

    const { rows: receipts } = await client.query<{
      method: string; n: number; amount: string;
    }>(
      `select coalesce(p.method,'unrecorded') as method,
              count(*)::int as n, (-sum(fp.amount))::text as amount
         from folio_postings fp
         left join payments p on p.posting_id = fp.id
         join cashier_shifts cs on cs.id = $1
        where fp.hotel_id = cs.hotel_id
          and fp.category = 'payment'
          and fp.posted_by = cs.staff_id
          and fp.created_at >= cs.opened_at
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id)
        group by coalesce(p.method,'unrecorded')
        order by 1`,
      [shiftId],
    );

    const { rows: movements } = await client.query<{
      id: string; kind: string; amount: string; reason: string;
      recorded_by: string; at: string;
    }>(
      `select m.id::text, m.kind, m.amount::text, m.reason,
              s.full_name as recorded_by, to_char(m.recorded_at,'HH24:MI') as at
         from cashier_movements m join staff s on s.id = m.recorded_by
        where m.shift_id = $1 order by m.recorded_at`,
      [shiftId],
    );

    const { rows: denoms } = await client.query<{ value: string; count: number }>(
      `select value::text, count from cashier_denominations
        where shift_id = $1 order by value desc`, [shiftId]);

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.cashier_expected_cash($1)::text as amount`, [shiftId]);

    const { rows: mates } = await client.query<{ id: string; name: string }>(
      `select s.id::text, s.full_name as name
         from staff s join staff_hotels sh on sh.staff_id = s.id
        where sh.hotel_id = $1 and s.is_active and s.id <> $2
        order by s.full_name`,
      [hotelId, session.staffId]);

    const counted = open[0].counted;
    const exp = Number(expected[0]!.amount);

    return {
      businessDate,
      shift: {
        id: shiftId,
        openedAt: open[0].opened_at,
        opening: Number(open[0].opening),
        receipts: receipts.map((r) => ({
          method: r.method, count: r.n, amount: Number(r.amount),
        })),
        movements: movements.map((m) => ({
          id: m.id, kind: m.kind, amount: Number(m.amount),
          reason: m.reason, recordedBy: m.recorded_by, at: m.at,
        })),
        expected: exp,
        counted: counted === null ? null : Number(counted),
        variance: counted === null ? null : Number(counted) - exp,
        varianceReason: open[0].variance_reason,
        denominations: denoms.map((d) => ({
          value: Number(d.value), count: d.count,
        })),
      },
      /* Who the drawer can be handed to. Nobody is a real answer — the
         last close of the night hands over to no one. */
      colleagues: mates,
      previous: null,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

operations.post("/:code/cashier-shift/open", async (c) => {
  const input = await c.req.json<{ opening?: number }>()
    .catch(() => ({}) as { opening?: number });
  const opening = Number(input.opening ?? 0);
  if (!Number.isFinite(opening) || opening < 0) {
    return c.json(refuse("An opening float is zero or more."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const businessDate = await businessDateFor(client, hotelId);

    try {
      await client.query(
        `insert into cashier_shifts (hotel_id, staff_id, business_date,
                                     opening_cash, opened_by)
         values ($1,$2,$3::date,$4,$2)`,
        [hotelId, session.staffId, businessDate, opening.toFixed(2)]);
      return { ok: true as const };
    } catch (error) {
      const e = error as { code?: string } | undefined;
      if (e?.code === "23505") {
        /* One open drawer per person. Two means neither can be reconciled. */
        return refuse("You already have a drawer open. Close it first.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

operations.post("/:code/cashier-shift/movements", async (c) => {
  type Body = { kind?: string; amount?: number; reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const KINDS = ["expense", "top_up", "withdrawal"];
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("Money out, money in, or to the safe?"), 409);
  }
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    return c.json(refuse("How much?"), 409);
  }
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "What was it for? This is the line somebody asks about."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: shift } = await client.query<{ id: string }>(
      `select id::text from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");

    await client.query(
      `insert into cashier_movements (hotel_id, shift_id, kind, amount,
                                      reason, recorded_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [hotelId, shift[0].id, input.kind, Number(input.amount).toFixed(2),
       reason, session.staffId]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

operations.post("/:code/cashier-shift/count", async (c) => {
  type Body = { denominations?: { value: number; count: number }[] };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: shift } = await client.query<{ id: string }>(
      `select id::text from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");
    const id = shift[0].id;

    /* Replaced wholesale. A count is one act — somebody empties the drawer
       and counts it — and merging a new count into an old one leaves
       denominations nobody typed this time. */
    await client.query(
      `delete from cashier_denominations where shift_id = $1`, [id]);
    for (const d of input.denominations ?? []) {
      if (!Number.isFinite(d.value) || d.value <= 0) continue;
      if (!Number.isInteger(d.count) || d.count <= 0) continue;
      await client.query(
        `insert into cashier_denominations (shift_id, value, count)
         values ($1,$2,$3)`, [id, d.value, d.count]);
    }

    const { rows: total } = await client.query<{ total: string }>(
      `select coalesce(sum(value * count),0)::text as total
         from cashier_denominations where shift_id = $1`, [id]);
    await client.query(
      `update cashier_shifts set counted_cash = $1 where id = $2`,
      [total[0]!.total, id]);

    return { ok: true as const, counted: Number(total[0]!.total) };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

operations.post("/:code/cashier-shift/close", async (c) => {
  type Body = { varianceReason?: string; handOverTo?: string | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: shift } = await client.query<{
      id: string; counted: string | null;
    }>(
      `select id::text, counted_cash::text as counted from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");
    if (shift[0].counted === null) return refuse("Count the drawer first.");

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.cashier_expected_cash($1)::text as amount`, [shift[0].id]);
    const variance = Number(shift[0].counted) - Number(expected[0]!.amount);

    /* A difference is RECORDED, not refused. The money is already whatever
       it is, and a desk that cannot hand over is worse than a difference
       written down — the same rule the POS close uses. */
    if (Math.abs(variance) >= 0.01 && !input.varianceReason?.trim()) {
      return refuse(
        `The drawer is ${variance > 0 ? "over" : "short"} by `
        + `${Math.abs(variance).toFixed(2)}. Say why, and it closes.`);
    }

    await client.query(
      `update cashier_shifts
          set variance_reason = $1, handed_to = $2, closed_by = $3,
              closed_at = now()
        where id = $4`,
      [input.varianceReason?.trim() || null, input.handOverTo || null,
       session.staffId, shift[0].id]);

    return { ok: true as const, variance };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
