import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import {
  identityProblem, isForeign, saveIdentity, saveVisit, type Identity, type Visit,
} from "./formIII.ts";
import { portalNumberProblem } from "../../validate.ts";

/* Split out of api/src/routes/invoices.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: guests.
   The Form III register (Form C until the 2025 Act, D27-25): which
   foreign guests owe a filing - on arrival and on departure - and the
   portal numbers that prove it. The addresses keep "form-c": they are
   not words anybody reads, and the role gate and the menu name them. */

export const formC = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const, reason, ...extra,
});

async function hotelIdFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The register ─────────────────────────────────────────────────── */

type Row = Record<string, string | number | boolean | string[] | null>;

formC.get("/:code/form-c", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Every date as text and every instant in the PROPERTY's clock: the
       card prints them, and a server in another zone must not move a
       guest's arrival by five and a half hours. */
    const { rows } = await client.query<Row>(
      `select f.reservation_id::text as "reservationId", f.guest_id::text as "guestId",
              f.companion, f.guest_name as guest,
              f.nationality, f.gender, f.date_of_birth::text as "dateOfBirth",
              f.id_type as "idType", f.passport,
              f.passport_issued_on::text as "passportIssuedOn",
              f.passport_issue_place as "passportIssuePlace",
              f.passport_issue_country as "passportIssueCountry",
              f.passport_expiry::text as "passportExpiry",
              f.visa_number as "visaNumber", f.visa_type as "visaType",
              f.visa_issued_on::text as "visaIssuedOn",
              f.visa_issue_place as "visaIssuePlace",
              f.visa_issue_country as "visaIssueCountry",
              f.visa_expiry::text as "visaExpiry",
              f.home_address as "homeAddress", f.home_city as "homeCity",
              f.home_country as "homeCountry", f.phone_in_india as "phoneInIndia",
              f.mobile_in_india as "mobileInIndia", f.phone_abroad as "phoneAbroad",
              f.mobile_abroad as "mobileAbroad",
              f.email, f.remarks, f.arrived_from as "arrivedFrom",
              f.previous_stay as "previousStay", f.purpose,
              f.purpose_other as "purposeOther",
              f.arrived_in_india_on::text as "arrivedInIndiaOn",
              f.arrival_port as "arrivalPort", f.employed_in_india as "employedInIndia",
              f.ref_address as "refAddress", f.ref_city as "refCity",
              f.ref_state as "refState", f.ref_pincode as "refPincode",
              f.next_destination as "nextDestination", f.room_number as room,
              f.adults, f.recorded, f.children, f.check_in::text as arrived,
              f.check_out::text as "checkOut", f.status,
              to_char(f.arrived_at at time zone h.timezone, 'YYYY-MM-DD HH24:MI') as "arrivedAt",
              to_char(f.departed_at at time zone h.timezone, 'YYYY-MM-DD HH24:MI') as "departedAt",
              to_char(f.arrival_due at time zone h.timezone, 'DD Mon YYYY, HH24:MI') as "dueBy",
              to_char(f.departure_due at time zone h.timezone, 'DD Mon YYYY, HH24:MI') as "departureDueBy",
              f.arrival_overdue as overdue, f.departure_overdue as "departureOverdue",
              f.arrival_numbers as "arrivalNumbers",
              f.departure_numbers as "departureNumbers"
         from app.form_iii_people($1) f
         join hotels h on h.id = $1`,
      [hotelId],
    );
    const { rows: premises } = await client.query<Row>(
      `select name, address_line as address, city, state, phone
         from hotels where id = $1`, [hotelId]);
    /* An adult nobody has recorded may be a foreigner (D27-382): the stays in
       house with one, which have no row below to carry the warning. */
    const { rows: unrecorded } = await client.query<Row>(
      `select coalesce(app.stay_room(r.id), '-') as room, r.adults::int as adults,
              app.stay_recorded(r.id) as recorded
         from reservations r
         join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and r.status = 'checked_in'
          and r.adults > app.stay_recorded(r.id)
          and g.nationality = 'IN'
          and not exists (select 1 from stay_companions c join guests cg on cg.id = c.guest_id
                           where c.reservation_id = r.id and cg.nationality <> 'IN')
        order by 1`, [hotelId]);

    const owes = (r: Row) =>
      (r["arrivalNumbers"] as string[]).length === 0
      || (r["status"] === "checked_out" && (r["departureNumbers"] as string[]).length === 0);

    return {
      /* Said on the response, not only in a code comment. Anyone
         building against this must not assume filing happened. */
      note:
        "This system does not file with the FRRO. Filing happens on the " +
        "government portal; this register records who owes one and who did it.",
      premises: premises[0] ?? null,
      due: rows.filter(owes).length,
      overdue: rows.filter((r) => r["overdue"] || r["departureOverdue"]).length,
      unrecorded,
      rows: rows.map((r) => ({
        ...r,
        /* The arrival's, kept under the names the register has always
           answered with. */
        filed: (r["arrivalNumbers"] as string[]).length > 0,
        reference: (r["arrivalNumbers"] as string[]).join(", ") || null,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* Whose row it is: the booking's lead guest, or with `guestId` a companion on
   the stay (D27-382). Null: nobody by that id on it. */
async function personOnStay(
  client: Client, hotelId: string, reservationId: string, guestId: string | undefined,
) {
  if (guestId && !/^[0-9a-f-]{36}$/i.test(guestId)) return null;
  const { rows } = await client.query<{
    guest_id: string; nationality: string; status: string; companion: boolean;
  }>(
    `select g.id::text as guest_id, g.nationality, r.status, g.id <> r.guest_id as companion
       from reservations r
       join guests g on g.id = r.guest_id
                     or g.id in (select c.guest_id from stay_companions c where c.reservation_id = r.id)
      where r.hotel_id = $1 and r.id = $2::uuid and g.id = coalesce($3::uuid, r.guest_id)`,
    [hotelId, reservationId, guestId ?? null],
  );
  return rows[0] ?? null;
}

/* ── A filing happened ────────────────────────────────────────────── */

formC.post("/:code/form-c/:reservationId", async (c) => {
  type Body = { reference?: string; notes?: string; kind?: string; guestId?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const reference = body.reference?.trim();
    /* GU-3 (the owner, 28 September): "!" was filed as a portal number and
       the register said everyone was filed. Letters and digits, - and /,
       6 to 30 characters, at least one digit. */
    const notANumber = portalNumberProblem(reference);
    if (notANumber) return refuse(notANumber);
    if (!reference) {
      /* The portal's acknowledgement IS the evidence. Recording a
         filing without it produces a register that proves nothing,
         which is worse than an empty one — it reads as compliance. */
      return refuse(
        "The FRRO acknowledgement reference is required. Without it the " +
          "register is a claim, not evidence.",
      );
    }
    const kind = body.kind ?? "arrival";
    if (kind !== "arrival" && kind !== "departure") {
      return refuse("A filing is for the arrival or the departure.");
    }

    const person = await personOnStay(client, hotelId, c.req.param("reservationId"), body.guestId);
    if (!person) return refuse("No such stay at this property.");
    /* 17(6): the departure is reported after it happens. */
    if (kind === "departure" && person.status !== "checked_out") {
      return refuse("The guest has not checked out. The departure is filed after they leave.");
    }

    try {
      await client.query(
        `insert into form_c_filings
           (hotel_id, reservation_id, guest_id, reference, notes, filed_by, kind)
         values ($1, $2::uuid, $3::uuid, $4, $5, app.current_user_id(), $6)`,
        [hotelId, c.req.param("reservationId"), person.guest_id,
         reference, body.notes ?? null, kind],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error &&
          (error as { code?: string }).code === "23505") {
        return refuse("That number is already recorded for this stay.");
      }
      throw error;
    }

    return { ok: true, reference };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Complete details ─────────────────────────────────────────────
   What check-in left blank, or got wrong, filled in later (the owner,
   27 September). Only what is typed is written. */

formC.put("/:code/form-c/:reservationId/details", async (c) => {
  type Body = { identity?: Identity; visit?: Visit; guestId?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const stay = await personOnStay(client, hotelId, c.req.param("reservationId"), body.guestId);
    if (!stay) return refuse("No such stay at this property.");
    if (!isForeign(stay.nationality)) {
      return refuse("Form III is for a foreign guest; this guest is recorded as Indian.");
    }
    const id = body.identity ?? {};
    /* Refused here in a sentence rather than by gd_number_present (026). */
    if (id.idType?.trim() && !id.idNumber?.trim()) {
      return refuse(`A ${id.idType} needs its number.`);
    }
    /* The desk's own rules (round D): the number by its type, no impossible
       date, a real country, a real phone. */
    const { rows: today } = await client.query<{ d: string }>(
      "select app.business_date($1)::text as d", [hotelId]);
    const wrong = identityProblem(id, body.visit, today[0]!.d);
    if (wrong) return refuse(wrong);

    await saveIdentity(client, stay.guest_id, id);
    await saveVisit(client, hotelId, c.req.param("reservationId"), body.visit ?? {},
      stay.companion ? stay.guest_id : undefined);
    return { ok: true };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
