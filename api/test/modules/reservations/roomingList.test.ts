import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { fileDate } from "../../../src/modules/reservations/roomingList.ts";

/* ══════════════════════════════════════════════════════════════════
   A GROUP'S ROOMING LIST (D27-383 item 8)

     reading a file   an Excel or a CSV: columns matched, each row tied to
                      a room by its Booking or by type and dates, every
                      problem listed - and NOTHING saved
     saving           all or none: one wrong row saves no name; the names
                      become the guests of their bookings
     who              whoever may change a booking; a viewer is refused
     the copy         a PDF, an Excel and a CSV, with no phone numbers
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "RMLT";
let hotelId: string;
let typeName: string;
let typeId: string;
let source: string;
let groupId: string;
let refs: string[] = [];
const staff = new Map<string, string>();

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`rmlt-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-rmlt-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
  return id;
};

const call = (role: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const guests = async () => (await sql(
  `select r.reference, g.full_name as guest, g.phone from reservations r join guests g on g.id = r.guest_id
    where r.group_id = $1 order by r.reference`, [groupId])).rows;
const read = (name: string, data: Buffer) =>
  call("front_desk", "POST", `/groups/${groupId}/rooming-list/read`, { name, data: data.toString("base64") });

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  const t = (await sql(`select id::text, name from room_types where hotel_id = $1 and is_active order by sort_order limit 1`,
    [hotelId])).rows[0];
  typeId = t.id; typeName = t.name;
  source = (await sql("select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  for (const role of ["front_desk", "read_only"]) staff.set(role, await person(role));
  const made = await call("front_desk", "POST", "/bookings", {
    guestName: `${TAG} Host`, checkIn: "2031-03-10", checkOut: "2031-03-12", bookingSourceId: source,
    groupName: `${TAG} Wedding`,
    lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, rooms: 3, agreedRate: 3000 }],
  });
  const body = (await made.json()) as { groupId: string; bookings: { reference: string }[] };
  groupId = body.groupId;
  refs = body.bookings.map((b) => b.reference).sort();
});

afterAll(async () => {
  const ids = (await sql("select id::text from reservations where group_id = $1", [groupId])).rows.map((r) => r.id);
  const people = (await sql("select guest_id::text as id from reservations where group_id = $1", [groupId])).rows.map((r) => r.id);
  await sql("delete from folios where reservation_id = any($1::uuid[]) or group_id = $2", [ids, groupId]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("delete from reservation_groups where id = $1", [groupId]);
  await sql("alter table guests disable trigger guests_no_delete");
  try { await sql("delete from guests where id = any($1::uuid[]) or full_name like $2", [people, `${TAG} %`]); }
  finally { await sql("alter table guests enable trigger guests_no_delete"); }
  const s = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [s]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [s]);
  await closePool();
});

describe("a rooming list", () => {
  it("lists the group's rooms with type, dates, plan and who pays", async () => {
    const res = await call("front_desk", "GET", `/groups/${groupId}/rooming-list`);
    const body = (await res.json()) as { rows: { reference: string; roomType: string; mealPlan: string; whoPays: string; editable: boolean }[] };
    expect(body.rows.map((r) => [r.reference, r.roomType, r.mealPlan, r.whoPays, r.editable]))
      .toEqual(refs.map((ref) => [ref, typeName, "EP", "guest", true]));
  });

  it("reads a CSV: every problem listed, and nothing saved", async () => {
    const csv = [
      "Booking,Guest name,Phone,Room type,Arrival,Departure",
      `${refs[0]},Asha Rao,98765 43210,${typeName},10/03/2031,12/03/2031`,
      `${refs[1]},,,,,`,
      `FH-NOPE-1,Somebody,,,,`,
      `${refs[2]},Ravi Iyer,12,,,`,
      `${refs[0]},Twice,,,,`,
      `${refs[2]},Wrong Date,,${typeName},11/03/2031,12/03/2031`,
    ].join("\r\n");
    const res = await read("rooming.csv", Buffer.from(csv));
    const body = (await res.json()) as { ok: boolean; problems: { reason: string }[] };
    expect(body.ok).toBe(false);
    expect(body.problems.map((p) => p.reason)).toEqual([
      "Row 3: no guest name.",
      "Row 4: FH-NOPE-1 is not one of this group's rooms.",
      expect.stringMatching(/^Row 5: "12" is not a phone number/),
      `Row 6: ${refs[0]} is named twice, on rows 2 and 6.`,
      expect.stringMatching(new RegExp(`^Row 7: ${refs[2]} is a .* from 10 Mar 2031 to 12 Mar 2031 on EP, not what the file says`)),
    ]);
    expect((await guests()).every((g) => g.guest === `${TAG} Host`)).toBe(true);
  });

  it("reads an Excel file the group sent, matched by type and dates without a Booking column", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Rooming");
    sheet.addRow(["S.No", "Name of guest", "Mobile", "Category", "Check-in", "Check-out", "Plan", "Who pays"]);
    sheet.addRow([1, "Asha Rao", "98765 43210", typeName, new Date(Date.UTC(2031, 2, 10)), new Date(Date.UTC(2031, 2, 12)), "EP", "Guest"]);
    sheet.addRow([2, "Vikram Shah", "", typeName.toUpperCase(), "10-03-2031", "12 Mar 2031", "", ""]);
    const res = await read("rooming.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    const body = (await res.json()) as { ok: boolean; rows: { reference: string; guestName: string }[]; problems: unknown[] };
    expect(body.problems).toEqual([]);
    expect(body.rows.map((r) => [r.reference, r.guestName])).toEqual([[refs[0], "Asha Rao"], [refs[1], "Vikram Shah"]]);
    expect((await guests()).every((g) => g.guest === `${TAG} Host`)).toBe(true);

    const tooMany = new ExcelJS.Workbook();
    const s2 = tooMany.addWorksheet("x");
    s2.addRow(["Guest", "Room type", "Arrival", "Departure", "Who pays"]);
    for (const n of ["A", "B", "C", "D"]) s2.addRow([`${n} Guest`, typeName, "2031-03-10", "2031-03-12", ""]);
    s2.addRow(["E Guest", typeName, "2031-03-10", "2031-03-12", "Host"]);
    const over = (await (await read("more.xlsx", Buffer.from(await tooMany.xlsx.writeBuffer()))).json()) as { problems: { reason: string }[] };
    expect(over.problems.map((p) => p.reason)).toEqual([
      expect.stringMatching(/^Row 5: no .* room of this group from 10 Mar 2031 to 12 Mar 2031 is left to name\.$/),
      expect.stringMatching(/^Row 6: no .* left to name\.$/),
    ]);
  });

  it("refuses a file that is not one, and an old .xls, in words", async () => {
    expect(((await (await read("photo.jpg", Buffer.from("x"))).json()) as { reason: string }).reason)
      .toMatch(/is not an Excel \(.xlsx\) or CSV file/);
    expect(((await (await read("old.xls", Buffer.from("x"))).json()) as { reason: string }).reason)
      .toMatch(/old Excel file/);
  });

  it("saves all or none: one wrong row saves no name", async () => {
    const list = (await (await call("front_desk", "GET", `/groups/${groupId}/rooming-list`)).json()) as
      { rows: { reservationId: string; reference: string }[] };
    const id = (ref: string) => list.rows.find((r) => r.reference === ref)!.reservationId;
    const bad = await call("front_desk", "PUT", `/groups/${groupId}/rooming-list`, { rows: [
      { reservationId: id(refs[0]!), guestName: "Asha Rao", phone: "98765 43210" },
      { reservationId: id(refs[1]!), guestName: "", phone: "" },
    ] });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { problems: string[] }).problems).toEqual([`${refs[1]}: no guest name.`]);
    expect((await guests()).every((g) => g.guest === `${TAG} Host`)).toBe(true);

    expect((await call("read_only", "PUT", `/groups/${groupId}/rooming-list`, { rows: [
      { reservationId: id(refs[0]!), guestName: "Asha Rao" }] })).status).toBe(403);

    const good = await call("front_desk", "PUT", `/groups/${groupId}/rooming-list`, { rows: [
      { reservationId: id(refs[0]!), guestName: `${TAG} Asha Rao`, phone: "98765 43210" },
      { reservationId: id(refs[1]!), guestName: `${TAG} Vikram Shah`, phone: "" },
    ] });
    expect(good.status, await good.clone().text()).toBe(200);
    expect(await guests()).toEqual([
      { reference: refs[0], guest: `${TAG} Asha Rao`, phone: "98765 43210" },
      { reference: refs[1], guest: `${TAG} Vikram Shah`, phone: null },
      { reference: refs[2], guest: `${TAG} Host`, phone: null },
    ]);
  });

  it("a room that has arrived keeps its guest: renaming it is refused", async () => {
    const r = (await sql("select id::text from reservations where reference = $1", [refs[2]])).rows[0].id;
    await sql("update reservations set status = 'checked_in' where id = $1", [r]);
    const res = await call("front_desk", "PUT", `/groups/${groupId}/rooming-list`, { rows: [
      { reservationId: r, guestName: "Late Name" }] });
    expect(((await res.json()) as { reason: string }).reason).toMatch(/has arrived; its guest is changed at the desk/);
    await sql("update reservations set status = 'confirmed' where id = $1", [r]);
  });

  it("prints and downloads: a PDF, an Excel and a CSV, with the names and no phone", async () => {
    const pdf = await call("read_only", "GET", `/groups/${groupId}/rooming-list?as=pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const xlsx = await call("front_desk", "GET", `/groups/${groupId}/rooming-list?as=xlsx`);
    expect(xlsx.headers.get("content-disposition")).toMatch(/5EL-rooming-list-RMLT-Wedding\.xlsx/);
    const csv = await (await call("front_desk", "GET", `/groups/${groupId}/rooming-list?as=csv`)).text();
    expect(csv).toContain(`${TAG} Asha Rao`);
    expect(csv).not.toContain("98765");
  });
});

describe("a date as a group writes it", () => {
  it("reads day first, as India does, and refuses what is not a date", () => {
    expect(["2031-03-10", "10/03/2031", "10-03-2031", "10.3.2031", "10 Mar 2031", "10-March-2031"].map(fileDate))
      .toEqual(Array(6).fill("2031-03-10"));
    expect([fileDate("31/02/2031"), fileDate("03/31/2031"), fileDate("tomorrow")]).toEqual([null, null, null]);
  });
});
