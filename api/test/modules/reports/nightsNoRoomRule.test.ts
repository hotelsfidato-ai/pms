import { describe, it, expect } from "vitest";
import { dailyFigures, sumDays } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   A NIGHT NOT CHARGED YET, AT A PROPERTY WITH NO ROOM GST RULE (D27-173)

   A new property has no GST rate until somebody sets one (D22-9), and it
   can take bookings before that. NIGHTS priced such a night's tax with
   app.gst_rate, which RAISES without a rule - so the Dashboard, every
   report on dailyFigures and marketing's numbers answered "Something went
   wrong". Now the tax of such a night is unknown: null, a dash, never 0,
   and never the rent alone passed off as the whole. The rent is unchanged.
   Posting a charge still refuses without a rule (night-audit, front desk).

   One transaction, rolled back: nothing is left behind.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

describe("a future booking at a property with no room GST rule", () => {
  it("dailyFigures answers: the rent at the booked rate, the tax unknown until a rule exists", async () => {
    const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true)`);
      const h = (await client.query<{ id: string }>(
        "select app.provision_property_unchecked('NRR','No Room Rule Test','Nowhere')::text as id")).rows[0]!.id;
      await client.query("delete from tax_rules where hotel_id = $1 and kind = 'room'", [h]);
      const guest = (await client.query<{ id: string }>(
        "insert into guests (full_name) values ('No room rule test guest') returning id::text")).rows[0]!.id;
      const { first, last } = (await client.query<{ first: string; last: string }>(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
         values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
                 app.business_date($1) + 1, app.business_date($1) + 3, 2500, 'confirmed')
         returning check_in::text as first, (check_out - 1)::text as last`, [h, guest])).rows[0]!;

      const days = await dailyFigures(client, h, first, last);
      expect(days.map((d) => [d.room, d.roomTax])).toEqual([[2500, null], [2500, null]]);
      expect(sumDays(days)).toMatchObject({ room: 5000, roomTax: null });

      await client.query("insert into tax_rules (hotel_id, kind, over_amount, rate, note) values ($1, 'room', 0, 12, 'test')", [h]);
      const priced = await dailyFigures(client, h, first, last);
      expect(priced.map((d) => [d.room, d.roomTax])).toEqual([[2500, 300], [2500, 300]]);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  });
});
