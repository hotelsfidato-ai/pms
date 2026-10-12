import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { buildReport, type ReportDoc } from "../../../src/modules/reports/index.ts";
import { pct } from "../../../src/modules/reports/document.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STATISTICS FOLLOW THE HOTEL'S TWO SWITCHES (the owner, D27-307 (1))

   "A complimentary room counts as sold" and "A day use counts as half a
   room sold" (Settings, Front desk rules) already decided the Manager
   report's Sold Room and the Rates calendar through dailyFigures().sold.
   Monthly occupancy, Monthly statistics and Yearly statistics added
   paying and complimentary rooms themselves, so a hotel that turned
   complimentary off saw two occupancies. Now all three read the same
   figure; Night Sold (paying) and Complimentary stay their own columns,
   and the footnote says how the switches stand.

   One night: 4 rooms, 1 paying (₹3,000), 1 complimentary, 1 day use.
   Each test is one transaction, rolled back: nothing is left behind.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Cells = Record<string, unknown>;
const cells = (doc: ReportDoc, label: string) =>
  doc.sections[0]!.rows.find((r) => r.cells["label"] === label)!.cells as Cells;

/** The hotel and its one night, then `test`, then everything rolled back. */
async function onOneNight(test: (t: {
  read: () => Promise<{ docs: ReportDoc[]; day: Cells; yearRow: Cells; bars: unknown[] }>;
  setSwitches: (comp: boolean, half: boolean) => Promise<unknown>;
}) => Promise<void>) {
  const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true)`);
    const h = (await client.query<{ id: string }>(
      "select app.provision_property_unchecked('SWS','Switches Test','Nowhere')::text as id")).rows[0]!.id;
    const type = (await client.query<{ id: string }>(
      "select id::text from room_types where hotel_id = $1 order by sort_order limit 1", [h])).rows[0]!.id;
    await client.query(
      `insert into rooms (hotel_id, room_type_id, number)
       values ($1, $2, '101'), ($1, $2, '102'), ($1, $2, '103'), ($1, $2, '104')`, [h, type]);
    const guest = (await client.query<{ id: string }>(
      "insert into guests (full_name) values ('Switches test guest') returning id::text")).rows[0]!.id;
    const night = (await client.query<{ d: string }>(
      "select (app.business_date($1) + 1)::text as d", [h])).rows[0]!.d;
    const book = (nights: number, rate: number, comp: boolean) => client.query(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, is_complimentary, status)
       values ($1, app.next_reference($1), $2, $3, $4::date, $4::date + $5::int, $6, $7, 'confirmed')`,
      [h, guest, type, night, nights, rate, comp]);
    await book(1, 3000, false);
    await book(1, 0, true);
    await book(0, 1000, false);           // a day use

    const dayOfMonth = Number(night.slice(8, 10));
    const p = { asOn: night, month: night.slice(0, 7), year: Number(night.slice(0, 4)) };
    await test({
      read: async () => {
        const stats = await buildReport(client, h, "monthly-statistics", p);
        const occ = await buildReport(client, h, "monthly-occupancy", p);
        const year = await buildReport(client, h, "yearly-statistics", p);
        return {
          docs: [stats, occ, year],
          day: cells(stats, `${dayOfMonth} ${DAYS[new Date(`${night}T00:00:00Z`).getUTCDay()]}`),
          yearRow: cells(year, MONTHS[Number(night.slice(5, 7)) - 1]!),
          bars: [stats, occ].map((d) => d.chart!.series[0]!.values[dayOfMonth - 1]),
        };
      },
      setSwitches: (comp, half) => client.query(
        "update hotels set kpi_comp_as_sold = $2, kpi_day_use_half = $3 where id = $1", [h, comp, half]),
    });
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
}

describe("Monthly occupancy, Monthly statistics and Yearly statistics follow the switches", () => {
  it("count sold rooms as the Manager report does; Night Sold and Complimentary stay apart", () =>
    onOneNight(async ({ read, setSwitches }) => {
      /* The defaults (comp on, day use off): the numbers as they always were. */
      let r = await read();
      expect(r.day).toMatchObject({ available: 4, sold: 1, complimentary: 1, occupancy: 50, adr: 1500, revpar: 750 });
      expect(r.bars).toEqual([50, 50]);
      expect(r.yearRow).toMatchObject({ sold: 1, complimentary: 1, occupancy: pct(2, r.yearRow["available"] as number), adr: 1500 });

      /* Complimentary off: the free room is not sold; still its own column. */
      await setSwitches(false, false);
      r = await read();
      expect(r.day).toMatchObject({ sold: 1, complimentary: 1, occupancy: 25, adr: 3000, revpar: 750 });
      expect(r.bars).toEqual([25, 25]);
      expect(r.yearRow).toMatchObject({ occupancy: pct(1, r.yearRow["available"] as number), adr: 3000 });

      /* Day use half on: half a room more sold. */
      await setSwitches(true, true);
      r = await read();
      expect(r.day).toMatchObject({ sold: 1, complimentary: 1, occupancy: 62.5, adr: 1200, revpar: 750 });
      expect(r.bars).toEqual([62.5, 62.5]);
      expect(r.yearRow).toMatchObject({ occupancy: pct(2.5, r.yearRow["available"] as number), adr: 1200 });
    }));

  it("say in the footnote how the switches stand", () =>
    onOneNight(async ({ read, setSwitches }) => {
      const says = async (words: string) => {
        for (const doc of (await read()).docs) expect(doc.footnotes.join(" ")).toContain(words);
      };
      await says("a complimentary room counts as sold; a day use is not counted");
      await setSwitches(false, false);
      await says("a complimentary room does not count as sold; a day use is not counted");
      await setSwitches(true, true);
      await says("a complimentary room counts as sold; a day use counts as half a room sold");
    }));
});
