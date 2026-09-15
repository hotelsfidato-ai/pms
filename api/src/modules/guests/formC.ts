import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* Split out of api/src/routes/invoices.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: guests.
   The Form C register: which foreign guests owe a filing, and who filed
   it. The endpoints are unchanged; `refuse` and `hotelIdFor` are copies
   of the invoices file's. */

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

/* ── Form C ───────────────────────────────────────────────────────── */

formC.get("/:code/form-c", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      reservation_id: string; guest_name: string; nationality: string;
      passport: string | null; room_number: string; arrived: string;
      due_by: string; overdue: boolean; filed: boolean;
      reference: string | null;
    }>(
      `select reservation_id::text, guest_name, nationality, passport,
              room_number, to_char(arrived,'YYYY-MM-DD') as arrived,
              to_char(due_by,'DD Mon YYYY, HH24:MI') as due_by,
              overdue, filed, reference
         from app.form_c_due($1)`,
      [hotelId],
    );

    return {
      /* Said on the response, not only in a code comment. Anyone
         building against this must not assume filing happened. */
      note:
        "This system does not file with the FRRO. Filing happens on the " +
        "government portal; this register records who owes one and who did it.",
      due: rows.filter((r) => !r.filed).length,
      overdue: rows.filter((r) => r.overdue).length,
      rows: rows.map((r) => ({
        reservationId: r.reservation_id,
        guest: r.guest_name,
        nationality: r.nationality,
        /* Null when the guest has no document row. A blank passport on
           a register that must be filed is information, not an error to
           hide — somebody has to go and ask for it. */
        passport: r.passport,
        room: r.room_number,
        arrived: r.arrived,
        dueBy: r.due_by,
        overdue: r.overdue,
        filed: r.filed,
        reference: r.reference,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

formC.post("/:code/form-c/:reservationId", async (c) => {
  const body = await c.req
    .json<{ reference?: string; notes?: string }>()
    .catch(() => ({} as { reference?: string; notes?: string }));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const reference = body.reference?.trim();
    if (!reference) {
      /* The portal's acknowledgement IS the evidence. Recording a
         filing without it produces a register that proves nothing,
         which is worse than an empty one — it reads as compliance. */
      return refuse(
        "The FRRO acknowledgement reference is required. Without it the " +
          "register is a claim, not evidence.",
      );
    }

    const { rows: res } = await client.query<{ guest_id: string }>(
      `select guest_id::text from reservations
        where hotel_id = $1 and id = $2::uuid`,
      [hotelId, c.req.param("reservationId")],
    );
    if (!res[0]) return refuse("No such stay at this property.");

    try {
      await client.query(
        `insert into form_c_filings
           (hotel_id, reservation_id, guest_id, reference, notes, filed_by)
         values ($1, $2::uuid, $3::uuid, $4, $5, app.current_user_id())`,
        [hotelId, c.req.param("reservationId"), res[0].guest_id,
         reference, body.notes ?? null],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error &&
          (error as { code?: string }).code === "23505") {
        return refuse("That stay has already been filed.");
      }
      throw error;
    }

    return { ok: true, reference };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
