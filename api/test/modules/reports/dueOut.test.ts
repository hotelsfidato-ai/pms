import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { READ_RULES, whoMay } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DASHBOARD'S TWO SERVER PIECES (the owner's D27-243, 2 October)

   1. WHAT DEPARTING GUESTS STILL OWE, for the Due out tile: the guests due
      out on the hotel's business date who have not left, how many of them
      owe on their own bills, and how much. "Owes" is the night audit's
      rule (checklist.ts): more than half a rupee on the stay's own bills,
      each bill's balance as finance counts it (folioBalance). Money owed,
      so it asks `invoice` as the other money-owed reads do (D27-147):
      the revenue manager is not let in.
   2. THE MONTH'S OCCUPANCY CHART on Monthly statistics: the same bars as
      the Monthly occupancy report, one per night.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DUEOUT";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, path: string) =>
  app.request(path, { headers: { "x-dev-staff-id": who } });

let owner = "";
let revenue = "";
let code = "AGR";

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  /* A hotel with somebody due out on its business date, where the demo has one. */
  code = (await sql<{ code: string }>(
    `select h.code from hotels h
      where exists (select 1 from reservations r where r.hotel_id = h.id and r.status = 'checked_in'
                      and r.check_out = app.business_date(h.id))
      order by h.code limit 1`))[0]?.code ?? "AGR";
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name) values ('dueout-revenue@fidato.in', '${TAG} revenue')
     on conflict (email) do update set is_active = true returning id::text`);
  revenue = row!.id;
  await sql("delete from staff_hotels where staff_id = $1", [revenue]);
  await sql(
    "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'revenue_manager' from hotels where code = $2",
    [revenue, code]);
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = $1", [revenue]);
  await sql("delete from staff where id = $1", [revenue]);
  await closePool();
});

describe("GET /api/hotels/:code/due-out - what departing guests still owe", () => {
  it("is the night audit's count of who owes, and the sum of what they owe", async () => {
    const res = await call(owner, `/api/hotels/${code}/due-out`);
    expect(res.status).toBe(200);
    const body = await res.json() as { date: string; leaving: number; owing: number; owed: number };

    /* The same question asked of the database directly. */
    const [want] = await sql<{ date: string; leaving: string; owing: string; owed: string }>(
      `with stay as (
         select r.id,
                (select coalesce(sum(fp.amount + fp.tax_amount), 0)
                   from folio_postings fp join folios f on f.id = fp.folio_id
                  where f.reservation_id = r.id and fp.reverses_id is null
                    and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)) as balance
           from reservations r join hotels h on h.id = r.hotel_id
          where h.code = $1 and r.status = 'checked_in' and r.check_out = app.business_date(h.id))
       select (select app.business_date(id)::text from hotels where code = $1) as date,
              count(*)::text as leaving,
              count(*) filter (where balance > 0.5)::text as owing,
              coalesce(sum(balance) filter (where balance > 0.5), 0)::text as owed
         from stay`, [code]);
    expect(body).toEqual({
      date: want!.date, leaving: Number(want!.leaving), owing: Number(want!.owing),
      owed: Math.round(Number(want!.owed) * 100) / 100,
    });
  });

  it("asks `invoice`: the revenue manager, who keeps every other report, is refused", async () => {
    expect(READ_RULES["GET /api/hotels/:code/due-out"]).toBeDefined();
    expect(whoMay(READ_RULES["GET /api/hotels/:code/due-out"]!)).not.toContain("revenue_manager");
    expect((await call(revenue, `/api/hotels/${code}/due-out`)).status).toBe(403);
  });
});

describe("Monthly statistics carries the month's occupancy chart (D27-243)", () => {
  it("the same bars as Monthly occupancy, one per night", async () => {
    const month = (await sql<{ m: string }>(
      "select to_char(app.business_date(id), 'YYYY-MM') as m from hotels where code = $1", [code]))[0]!.m;
    const read = async (key: string) => {
      const res = await call(owner, `/api/hotels/${code}/reports/${key}?month=${month}`);
      expect(res.status).toBe(200);
      return res.json() as Promise<{ chart?: { kind: string; unit: string; x: string[]; series: { values: number[] }[] } }>;
    };
    const stats = await read("monthly-statistics");
    const occupancy = await read("monthly-occupancy");
    expect(stats.chart, "no chart on Monthly statistics").toBeDefined();
    expect(stats.chart!.kind).toBe("bar");
    expect(stats.chart!.unit).toBe("percent");
    expect(stats.chart!.x).toEqual(occupancy.chart!.x);
    expect(stats.chart!.series[0]!.values).toEqual(occupancy.chart!.series[0]!.values);
  });
});
