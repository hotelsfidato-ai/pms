import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import {
  identityProblem, isForeign, maskedId, saveIdentity, saveVisit, type Identity, type Visit,
} from "./formIII.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OTHER ADULTS IN A ROOM (the owner's D27-382, GUE-6)

   A companion IS a guest: a `guests` row, their `guest_documents`, a
   `form_iii_stays` row of their own, tied to the stay by stay_companions
   (migration "every adult in a room"). Entered at check-in or later on the
   stay, always on its own call: POST /check-in knows nothing of them, so no
   companion can ever stop a check-in. An ID is held as a lead guest's is:
   the check-in roles only (D25-38, roleGate), an Aadhaar masked here as on
   the registration card, and nothing here logs a person.
   ══════════════════════════════════════════════════════════════════ */

export const companions = new Hono<{ Variables: { subject: string } }>();

const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });

type Body = { fullName?: string; nationality?: string; identity?: Identity; visit?: Visit };

/** The stay, at this hotel, when somebody can be in its room. */
async function stayFor(client: Client, code: string, id: string) {
  if (!A_UUID.test(id)) return null;
  const { rows } = await client.query<{
    hotel_id: string; status: string; today: string;
  }>(
    `select r.hotel_id::text, r.status, app.business_date(r.hotel_id)::text as today
       from reservations r join hotels h on h.id = r.hotel_id
      where h.code = upper($1) and r.id = $2`, [code, id]);
  return rows[0] ?? null;
}

const GONE = ["cancelled", "void", "no_show"];
const NOBODY = "This booking did not go ahead, so nobody is in its room to record.";

/** The sentence refusing what was typed, or null: the desk's own rules. */
function typedProblem(b: Body, today: string): string | null {
  if (!b.fullName?.trim()) return "A guest has a name.";
  if (!b.nationality?.trim()) return "Nationality is a two-letter country code, e.g. IN.";
  const id = b.identity ?? {};
  if (id.idType?.trim() && !id.idNumber?.trim()) return `A ${id.idType} needs its number.`;
  return identityProblem({ ...id, nationality: b.nationality }, b.visit, today);
}

/** Their ID, and for a foreigner this visit's answers. Only what was typed. */
async function saveDetails(
  client: Client, hotelId: string, stayId: string, guestId: string, b: Body,
): Promise<void> {
  if (Object.values(b.identity ?? {}).some((v) => v?.trim())) {
    await saveIdentity(client, guestId, b.identity!);
  }
  if (isForeign(b.nationality) && b.visit) {
    await saveVisit(client, hotelId, stayId, b.visit, guestId);
  }
}

/* What the stay panel and the check-in window show. Their answers come with
   them, under the names the shared fields use, for Edit. */
const PERSON = `
  g.id::text as "guestId", g.full_name as name, g.nationality,
  d.id_type as "idType", d.id_number as "idNumber",
  exists (select 1 from form_c_filings f
           where f.reservation_id = c.reservation_id and f.guest_id = c.guest_id) as filed,
  d.visa_number as "visaNumber", d.visa_type as "visaType",
  d.gender, d.date_of_birth::text as "dateOfBirth",
  d.passport_issued_on::text as "passportIssuedOn", d.passport_issue_place as "passportIssuePlace",
  d.passport_issue_country as "passportIssueCountry", d.passport_expiry::text as "passportExpiry",
  d.visa_issued_on::text as "visaIssuedOn", d.visa_issue_place as "visaIssuePlace",
  d.visa_issue_country as "visaIssueCountry", d.visa_expiry::text as "visaExpiry",
  d.address_line as "addressLine", d.city, d.country,
  v.phone_in_india as "phoneInIndia", v.mobile_in_india as "mobileInIndia",
  v.phone_abroad as "phoneAbroad", v.mobile_abroad as "mobileAbroad",
  v.arrived_from as "arrivedFrom", v.previous_stay as "previousStay", v.purpose,
  v.purpose_other as "purposeOther", v.arrived_in_india_on::text as "arrivedInIndiaOn",
  v.arrival_port as "arrivalPort", v.ref_address as "refAddress", v.ref_city as "refCity",
  v.ref_state as "refState", v.ref_pincode as "refPincode", v.remarks,
  case v.employed_in_india when true then 'yes' when false then 'no' end as "employedInIndia"`;

companions.get("/:code/stays/:id/companions", async (c) => {
  const stayId = c.req.param("id");
  const body = await withSession(c.get("subject"), async (client) => {
    const stay = await stayFor(client, c.req.param("code"), stayId);
    if (!stay) return null;
    const { rows: head } = await client.query(
      `select r.adults::int, app.stay_recorded(r.id) as recorded, g.full_name as lead,
              g.nationality as "leadNationality"
         from reservations r join guests g on g.id = r.guest_id where r.id = $1`, [stayId]);
    const { rows } = await client.query<Record<string, string | boolean | null>>(
      `select ${PERSON}
         from stay_companions c
         join guests g on g.id = c.guest_id
         left join guest_documents d on d.guest_id = c.guest_id
         left join form_iii_stays v on v.reservation_id = c.reservation_id and v.guest_id = c.guest_id
        where c.reservation_id = $1
        order by c.added_at, g.full_name`, [stayId]);
    return {
      ...head[0],
      open: !GONE.includes(stay.status),
      companions: rows.map((r) => ({
        ...r, idNumber: maskedId(r["idType"] as string | null, r["idNumber"] as string | null),
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such stay." }, 404);
});

companions.post("/:code/stays/:id/companions", async (c) => {
  const stayId = c.req.param("id");
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const result = await withSession(c.get("subject"), async (client) => {
    const stay = await stayFor(client, c.req.param("code"), stayId);
    if (!stay) return null;
    if (GONE.includes(stay.status)) return refuse(NOBODY);
    const nationality = b.nationality?.trim().toUpperCase() ?? "";
    const wrong = typedProblem({ ...b, nationality }, stay.today);
    if (wrong) return refuse(wrong);

    /* Every refusal is above this line (MEMORY 243). The link before the ID:
       the document's own row security asks for it. */
    const { rows } = await client.query<{ id: string }>(
      "insert into guests (full_name, nationality) values ($1, $2) returning id::text",
      [b.fullName!.trim(), nationality]);
    const guestId = rows[0]!.id;
    await client.query(
      `insert into stay_companions (hotel_id, reservation_id, guest_id, added_by)
       values ($1, $2, $3, app.current_user_id())`, [stay.hotel_id, stayId, guestId]);
    await saveDetails(client, stay.hotel_id, stayId, guestId, { ...b, nationality });
    return { ok: true as const, guestId };
  });
  if (!result) return c.json({ error: "No such stay." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

companions.put("/:code/stays/:id/companions/:guestId", async (c) => {
  const stayId = c.req.param("id");
  const guestId = c.req.param("guestId");
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const result = await withSession(c.get("subject"), async (client) => {
    const stay = await stayFor(client, c.req.param("code"), stayId);
    if (!stay || !A_UUID.test(guestId)) return null;
    const { rows: link } = await client.query<{ filed: boolean }>(
      `select exists (select 1 from form_c_filings f
                       where f.reservation_id = c.reservation_id and f.guest_id = c.guest_id) as filed
         from stay_companions c where c.reservation_id = $1 and c.guest_id = $2`, [stayId, guestId]);
    if (!link[0]) return null;
    if (link[0].filed) {
      return refuse("This person's Form III is filed. Correct their details on the Form III register.");
    }
    const nationality = b.nationality?.trim().toUpperCase() ?? "";
    const wrong = typedProblem({ ...b, nationality }, stay.today);
    if (wrong) return refuse(wrong);

    await client.query("update guests set full_name = $2, nationality = $3 where id = $1",
      [guestId, b.fullName!.trim(), nationality]);
    await saveDetails(client, stay.hotel_id, stayId, guestId, { ...b, nationality });
    return { ok: true as const, guestId };
  });
  if (!result) return c.json({ error: "No such person on this stay." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

companions.delete("/:code/stays/:id/companions/:guestId", async (c) => {
  const stayId = c.req.param("id");
  const guestId = c.req.param("guestId");
  const result = await withSession(c.get("subject"), async (client) => {
    const stay = await stayFor(client, c.req.param("code"), stayId);
    if (!stay || !A_UUID.test(guestId)) return null;
    try {
      const { rows } = await client.query<{ removed: boolean }>(
        "select app.remove_companion($1, $2, $3) as removed", [stay.hotel_id, stayId, guestId]);
      return rows[0]!.removed ? { ok: true as const } : null;
    } catch (error) {
      const e = error as { code?: string; message?: string };
      if (e.code === "P0001" && e.message) return refuse(e.message);
      throw error;
    }
  });
  if (!result) return c.json({ error: "No such person on this stay." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
