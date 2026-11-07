import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { lineUp, type Hotel } from "../../../src/modules/reports/group.ts";
import { col, type ReportDoc } from "../../../src/modules/reports/document.ts";

/* ══════════════════════════════════════════════════════════════════
   GROUP REPORTS (D27-383 item 6)

   A property's line is its own report's figures; the total adds like with
   like; and nothing is shown to somebody for a property they may not open,
   or may not read that report at. THE REFUSALS ARE THE POINT: a file that
   only proved the owner gets a report would pass with no guard at all.

   5EL is the demo (Maharashtra, GSTIN 27), PUN the suite's (Maharashtra,
   27), AGR the suite's (Uttar Pradesh, 09).
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let owner: string;
let asOn: string;
const people = new Map<string, string>();

const person = async (key: string, roles: [string, string][]) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`grp-${key}@fidato.in`, `GRPTEST ${key}`, `test-uid-grp-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const [hotel, role] of roles) {
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = $3`,
      [id, role, hotel]);
  }
  people.set(key, id);
  return id;
};

const ask = (who: string, path: string) => app.request(path, { headers: { "x-dev-staff-id": who } });
const group = async (who: string, key: string, q: string) => {
  const res = await ask(who, `/api/group/reports/${key}?${q}`);
  return { status: res.status, body: (await res.json()) as ReportDoc & { error?: string } };
};
const rowOf = (doc: ReportDoc, section: string, label: string) =>
  doc.sections.find((s) => s.key === section)!.rows.find((r) => r.cells["label"] === label)!;

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  asOn = (await sql("select to_char(app.business_date(id), 'YYYY-MM-DD') as d from hotels where code = '5EL'")).rows[0].d;
  await person("gm5", [["5EL", "gm"]]);
  await person("rm", [["5EL", "revenue_manager"], ["PUN", "revenue_manager"]]);
  await person("desk", [["5EL", "gm"], ["PUN", "housekeeping"]]);
});

afterAll(async () => {
  const ids = [...people.values()];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("each property's line is its own report", () => {
  it("the Manager report: 5EL's line is its own Manager report's figures, and the total adds them", async () => {
    const { status, body } = await group(owner, "manager", `hotels=5EL,PUN&asOn=${asOn}`);
    expect(status).toBe(200);
    const own = (await (await ask(owner, `/api/hotels/5EL/reports/manager?asOn=${asOn}`)).json()) as ReportDoc;
    const pick = (section: string, label: string, at: string) =>
      own.sections.find((s) => s.key === section)!.rows.find((r) => r.cells["label"] === label)!.cells[at];
    const name = own.property.name;
    for (const at of ["today", "ptd", "ytd"]) {
      const line = rowOf(body, at, name).cells;
      expect(line["sold"]).toBe(pick("room-summary", "Sold Room", at));
      expect(line["room"]).toBe(pick("room-charges", "Room Charges", at));
      expect(line["adr"]).toBe(pick("statistics", "Average Daily Rate (ADR)", at));
      expect(line["tax"]).toBe(pick("tax", "Total", at));
      const pun = body.sections.find((s) => s.key === at)!.rows.find((r) => r.cells["label"] === "Fidato Pune")!.cells;
      const sum = body.sections.find((s) => s.key === at)!.rows.find((r) => r.kind === "total")!.cells;
      expect(sum["sold"]).toBeCloseTo(Number(line["sold"]) + Number(pun["sold"]), 2);
      /* Both in Maharashtra: the tax is like with like, so it is added. */
      expect(sum["tax"]).toBeCloseTo(Number(line["tax"]) + Number(pun["tax"]), 2);
    }
    expect(body.property.code).toBe("GROUP");
  });

  it("Monthly statistics: 5EL's line is the Total of its own Monthly statistics", async () => {
    const month = asOn.slice(0, 7);
    const { status, body } = await group(owner, "monthly-statistics", `hotels=5EL,AGR&month=${month}`);
    expect(status).toBe(200);
    const own = (await (await ask(owner, `/api/hotels/5EL/reports/monthly-statistics?month=${month}`)).json()) as ReportDoc;
    const theirs = own.sections[0]!.rows.find((r) => r.kind === "total")!.cells;
    const line = rowOf(body, "month", own.property.name).cells;
    expect({ ...line, label: "Total" }).toEqual(theirs);
    /* 5EL in Maharashtra, AGR in Uttar Pradesh: their GST is never added. */
    const sum = body.sections[0]!.rows.find((r) => r.kind === "total")!.cells;
    expect(sum["tax"]).toBeNull();
    expect(sum["room"]).toBeCloseTo(Number(line["room"]), 2);
    expect(body.footnotes.join(" ")).toMatch(/not added across GST states \(MH, UP\)/);
  });

  it("Money owed by age, Room revenue and occupancy and Restaurant sales each answer with a line per property", async () => {
    for (const key of ["dues-by-age", "room-revenue", "restaurant-sales"]) {
      const { status, body } = await group(owner, key, `hotels=5EL,PUN&asOn=${asOn}`);
      expect(status, key).toBe(200);
      for (const s of body.sections) {
        expect(s.rows.map((r) => r.kind), `${key} ${s.key}`).toEqual(["row", "row", "total"]);
      }
    }
  });

  it("downloads as a PDF, an .xlsx and a CSV", async () => {
    for (const ext of ["pdf", "xlsx", "csv"]) {
      const res = await ask(owner, `/api/group/reports/manager.${ext}?hotels=5EL,PUN&asOn=${asOn}`);
      expect(res.status, ext).toBe(200);
      expect(res.headers.get("content-disposition")).toContain(`GROUP-manager-${asOn}.${ext}`);
    }
  });
});

describe("nothing is shown for a property the person may not open", () => {
  it("refuses a GM at 5EL who names AGR too, saying so, with no figures", async () => {
    const { status, body } = await group(people.get("gm5")!, "manager", "hotels=5EL,AGR");
    expect(status).toBe(403);
    expect(body.error).toBe("AGR is not a property you work at, so its figures are not shown.");
    expect(body.sections).toBeUndefined();
  });

  it("says the same of a property that does not exist", async () => {
    const { status, body } = await group(people.get("gm5")!, "manager", "hotels=5EL,ZZZ");
    expect(status).toBe(403);
    expect(body.error).toBe("ZZZ is not a property you work at, so its figures are not shown.");
  });

  it("refuses money owed to a revenue manager, who reads reports but not money owed (D27-147)", async () => {
    const { status, body } = await group(people.get("rm")!, "dues-by-age", "hotels=5EL,PUN");
    expect(status).toBe(403);
    expect(body.error).toMatch(/^At .+: Reading money owed and taken is for /);
    /* ...and lets the same person read the Manager report of both. */
    expect((await group(people.get("rm")!, "manager", "hotels=5EL,PUN")).status).toBe(200);
  });

  it("refuses a property where the person's role may not read the report, naming it", async () => {
    const { status, body } = await group(people.get("desk")!, "manager", "hotels=5EL,PUN");
    expect(status).toBe(403);
    expect(body.error).toMatch(/^At Fidato Pune: Reading reports is for /);
  });

  it("refuses a download where the person may read but not download", async () => {
    /* The Viewer reads reports and holds no export. */
    const viewer = await person("viewer", [["5EL", "read_only"], ["PUN", "read_only"]]);
    expect((await group(viewer, "manager", "hotels=5EL,PUN")).status).toBe(200);
    const res = await ask(viewer, "/api/group/reports/manager.pdf?hotels=5EL,PUN");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/^At .+: downloading reports is for /);
  });

  it("asks for a property and a known report", async () => {
    expect((await group(owner, "manager", "hotels=")).status).toBe(400);
    expect((await group(owner, "no-such", "hotels=5EL")).status).toBe(404);
  });
});

describe("the total adds like with like", () => {
  const H = (code: string, currency: string, gst: string): Hotel => ({
    id: code, code, name: code, currency, businessDate: "2029-01-01", gst, state: gst, role: "owner", test: false,
  });
  const columns = [col("label", "Property", "text"), col("room", "Room Charges"), col("tax", "Tax"),
    col("sold", "Sold Room", "count"), col("available", "Available", "count"), col("occupancy", "Occ", "percent")];
  const rates = { occupancy: { of: ["sold", "available"], f: (t: Record<string, number>) => Math.round((t["sold"]! / t["available"]!) * 10000) / 100 } };

  it("a property with a figure missing: a dash, and the total says it is incomplete", () => {
    const { rows, notes } = lineUp(columns, [
      { hotel: H("A", "INR", "27"), cells: { room: 100, tax: 12, sold: 2, available: 10 } },
      { hotel: H("B", "INR", "27"), cells: { room: 50, tax: null, sold: 1, available: 10 } },
    ], rates);
    const sum = rows[2]!;
    expect(sum.cells).toMatchObject({ label: "Total - incomplete", room: 150, tax: null, sold: 3, available: 20, occupancy: 15 });
    expect(notes[0]).toBe("Total - incomplete: B has no Tax.");
    expect(rows[1]!.cells["tax"]).toBeNull();
  });

  it("a rate is a dash when a figure it is made of is missing", () => {
    const { rows } = lineUp(columns, [
      { hotel: H("A", "INR", "27"), cells: { room: 100, tax: 12, sold: null, available: 10 } },
      { hotel: H("B", "INR", "27"), cells: { room: 50, tax: 6, sold: 1, available: 10 } },
    ], rates);
    expect(rows[2]!.cells["occupancy"]).toBeNull();
  });

  it("money is never added across currencies: a total each", () => {
    const { rows, notes } = lineUp(columns, [
      { hotel: H("A", "INR", "27"), cells: { room: 100, tax: 12, sold: 2, available: 10 } },
      { hotel: H("N", "NPR", "np"), cells: { room: 900, tax: 90, sold: 1, available: 5 } },
    ], rates);
    expect(rows.filter((r) => r.kind === "total").map((r) => [r.cells["label"], r.cells["room"]]))
      .toEqual([["Total, INR", 100], ["Total, NPR", 900]]);
    expect(notes.join(" ")).toMatch(/never added across currencies/);
  });

  it("tax is never added across GST states; the rest is", () => {
    const { rows } = lineUp(columns, [
      { hotel: H("A", "INR", "27"), cells: { room: 100, tax: 12, sold: 2, available: 10 } },
      { hotel: H("U", "INR", "09"), cells: { room: 50, tax: 6, sold: 1, available: 10 } },
    ], rates);
    expect(rows[2]!.cells).toMatchObject({ label: "Total", room: 150, tax: null });
  });
});
