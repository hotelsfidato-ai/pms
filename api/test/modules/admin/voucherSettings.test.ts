import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { READ_RULES, WRITE_RULES, whoMay } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE VOUCHER PRINTS, SET IN SETTINGS (the owner's D27-215, D27-216)

   A hotel's BANK DETAILS: seen and changed by whoever manages that hotel
   (its owner, GM or Admin, or a group administrator) and by nobody else -
   reception has no use for an account number. Each field is refused in a
   sentence when it is not what it says; every change is recorded, and the
   GROUP OWNER'S BELL says so for seven days, for every hotel, whichever
   one is open - without the account number.

   The GROUP'S OFFICE DETAILS, beside its name and logo; the hotel's
   RESERVATIONS CONTACT and its HOUSE POLICIES, on its profile.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "VSET";
const people: Record<"gm" | "admin" | "desk" | "elsewhere", string> = { gm: "", admin: "", desk: "", elsewhere: "" };
let owner = "";
let was: { policies: string[]; contact: string | null; group: Record<string, unknown>[] };

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const BANK = {
  accountName: "Test Hotels Private Limited", accountNumber: "0000 1111 2222", bankName: "Test Bank",
  branch: "Agra Cantt", ifsc: "test0001234", upi: "testhotel@testbank",
};
const bank = (who: string, method: string, body?: unknown, code = "AGR") =>
  call(who, method, `/api/hotels/${code}/bank-details`, body);
const storedBank = async (code = "AGR") => (await sql<Record<string, unknown>>(
  `select account_name, account_number, bank_name, branch, ifsc, upi_id, changed_by::text
     from hotel_bank_details where hotel_id = (select id from hotels where code = $1)`, [code]))[0] ?? null;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const hotel = (await sql<{ house_policies: string[]; reservations_contact: string | null }>(
    "select house_policies, reservations_contact from hotels where code = 'AGR'"))[0]!;
  was = { policies: hotel.house_policies, contact: hotel.reservations_contact,
    group: await sql("select * from group_settings") };
  await sql("delete from group_settings");
  await sql("delete from hotel_bank_details where hotel_id in (select id from hotels where code in ('AGR', 'PUN'))");
  await sql("delete from audit_log where table_name = 'hotel_bank_details'");
  const at: [keyof typeof people, string, string][] = [
    ["gm", "AGR", "gm"], ["admin", "AGR", "admin"], ["desk", "AGR", "front_desk"], ["elsewhere", "PUN", "gm"],
  ];
  for (const [who, hotel_, role] of at) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`vset-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $3 from hotels where code = $2",
      [row!.id, hotel_, role]);
  }
});

afterAll(async () => {
  await sql("delete from hotel_bank_details where hotel_id in (select id from hotels where code in ('AGR', 'PUN'))");
  await sql("delete from audit_log where table_name = 'hotel_bank_details'");
  await sql("update hotels set house_policies = $1, reservations_contact = $2 where code = 'AGR'",
    [was.policies, was.contact]);
  await sql("delete from group_settings");
  for (const row of was.group) {
    const cols = Object.keys(row);
    await sql(`insert into group_settings (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      cols.map((c) => row[c]));
  }
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("a hotel's bank details", () => {
  it("are changed by exactly the owner, an administrator and the GM; the read is the route's own", () => {
    for (const route of ["PUT /api/hotels/:code/bank-details", "DELETE /api/hotels/:code/bank-details"]) {
      expect(whoMay(WRITE_RULES[route]!), route).toEqual(["owner", "admin", "gm"]);
    }
    expect(READ_RULES["GET /api/hotels/:code/bank-details"]).toMatchObject({ kind: "own" });
  });

  it("are none to begin with, for the hotel's GM", async () => {
    const res = await bank(people.gm, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bank: null });
  });

  it("are saved by the GM as they will print: the IFSC in capitals, the account number without its spaces", async () => {
    const res = await bank(people.gm, "PUT", BANK);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await storedBank()).toEqual({
      account_name: "Test Hotels Private Limited", account_number: "000011112222", bank_name: "Test Bank",
      branch: "Agra Cantt", ifsc: "TEST0001234", upi_id: "testhotel@testbank", changed_by: people.gm,
    });
    expect(((await (await bank(people.admin, "GET")).json()) as { bank: Record<string, unknown> }).bank).toMatchObject({
      accountName: "Test Hotels Private Limited", accountNumber: "000011112222", bankName: "Test Bank",
      branch: "Agra Cantt", ifsc: "TEST0001234", upi: "testhotel@testbank", changedBy: `${TAG} gm`,
    });
  });

  it.each([
    [{ accountName: " " }, "Whose name is the account in? It prints on the voucher."],
    [{ accountName: "x".repeat(101) }, "The account name is 101 characters. The most is 100."],
    [{ accountNumber: "12345678" }, "An account number is 9 to 18 digits."],
    [{ accountNumber: "1234-5678-90AB" }, "An account number is 9 to 18 digits."],
    [{ bankName: "" }, "Which bank is the account with?"],
    [{ ifsc: "TEST1001234" }, "An IFSC is eleven characters: four letters, a zero, then six letters or digits."],
    [{ ifsc: "TES0001234" }, "An IFSC is eleven characters: four letters, a zero, then six letters or digits."],
    [{ upi: "not a upi id" }, "A UPI ID looks like name@bank."],
    [{ branch: "x".repeat(101) }, "The branch is 101 characters. The most is 100."],
  ])("refuse %j in a sentence, and keep what was there", async (wrong, sentence) => {
    const before = await storedBank();
    const res = await bank(people.admin, "PUT", { ...BANK, ...wrong });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(sentence);
    expect(await storedBank()).toEqual(before);
  });

  it("are not reception's to see or change", async () => {
    const before = await storedBank();
    expect((await bank(people.desk, "GET")).status).toBe(403);
    const put = await bank(people.desk, "PUT", { ...BANK, accountName: "Somebody Else" });
    expect(put.status).toBe(403);
    expect(await reason(put)).toBe(
      "Changing the hotel's bank details is for the owner, an administrator or the general manager. Ask one of them.");
    expect((await bank(people.desk, "DELETE")).status).toBe(403);
    expect(await storedBank()).toEqual(before);
  });

  it("nor another hotel's GM's", async () => {
    const before = await storedBank();
    expect([403, 404]).toContain((await bank(people.elsewhere, "GET")).status);
    expect([403, 404]).toContain((await bank(people.elsewhere, "PUT", { ...BANK, accountName: "Somebody Else" })).status);
    expect([403, 404]).toContain((await bank(people.elsewhere, "DELETE")).status);
    expect(await storedBank()).toEqual(before);
  });

  it("drop the branch and the UPI ID when they are sent blank", async () => {
    const res = await bank(people.gm, "PUT", { ...BANK, branch: "", upi: " " });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await storedBank()).toMatchObject({ branch: null, upi_id: null });
  });

  it("record every change, with who", async () => {
    const log = await sql<{ action: string; actor: string }>(
      `select action, actor::text from audit_log
        where table_name = 'hotel_bank_details' and hotel_id = (select id from hotels where code = 'AGR')
        order by at`);
    expect(log.map((l) => [l.action, l.actor])).toEqual([["INSERT", people.gm], ["UPDATE", people.gm]]);
  });

  it("are removed by the hotel's Admin", async () => {
    expect((await bank(people.admin, "DELETE")).status).toBe(200);
    expect(await storedBank()).toBeNull();
    expect(await (await bank(people.gm, "GET")).json()).toEqual({ bank: null });
  });
});

/* D27-216: the group owner's bell. */
describe("the group owner's bell, when a hotel's bank details change", () => {
  const bell = async (who: string, code: string) =>
    (await (await call(who, "GET", `/api/hotels/${code}/notifications`)).json()) as
      Array<{ id: string; title: string; body: string; link: string }>;
  const about = <T extends { id: string }>(notes: T[]) => notes.filter((n) => n.id.startsWith("bank-details-"));

  it("tells the owner, standing in another hotel, that Pune's were set - and nobody else", async () => {
    await sql("delete from audit_log where table_name = 'hotel_bank_details'");
    expect(about(await bell(owner, "5EL"))).toEqual([]);

    const res = await bank(people.elsewhere, "PUT", { ...BANK, accountNumber: "999988887777" }, "PUN");
    expect(res.status, await res.clone().text()).toBe(200);

    const notes = about(await bell(owner, "5EL"));
    expect(notes).toHaveLength(1);
    const pune = (await sql<{ name: string }>("select name from hotels where code = 'PUN'"))[0]!.name;
    expect(notes[0]!.title).toBe(`${pune}: bank details set`);
    expect(notes[0]!.body).toContain(`${TAG} elsewhere`);
    expect(notes[0]!.link).toBe("/h/PUN/settings/taxes-and-billing");
    /* Which hotel, who, when - never the account. */
    expect(JSON.stringify(notes[0])).not.toMatch(/999988887777|TEST0001234|Test Bank/);

    /* The GM who changed them, in their own hotel; and reception. */
    expect(about(await bell(people.elsewhere, "PUN"))).toEqual([]);
    expect(about(await bell(people.desk, "AGR"))).toEqual([]);
    expect(about(await bell(people.gm, "AGR"))).toEqual([]);
  });

  it("says the newest change at a hotel, once, and drops it after seven days", async () => {
    expect((await bank(people.elsewhere, "PUT", { ...BANK, accountNumber: "111122223333" }, "PUN")).status).toBe(200);
    expect((await bank(owner, "DELETE", undefined, "PUN")).status).toBe(200);
    const notes = about(await bell(owner, "AGR"));
    expect(notes.map((n) => n.title)).toEqual([expect.stringMatching(/: bank details removed$/)]);

    await sql("update audit_log set at = now() - interval '8 days' where table_name = 'hotel_bank_details'");
    expect(about(await bell(owner, "AGR"))).toEqual([]);
  });
});

describe("the group's office details", () => {
  const OFFICE = {
    address: "1 Office Road, Pune 411001", phone: "+91 20 0000 0000", email: "office@example.test",
    website: "www.example.test", gstin: "27aaaaa0000a1z5", instagram: "@testgroup",
  };
  const office = (who: string, body: unknown) => call(who, "PUT", "/api/hotels/AGR/group/office", body);
  const read = async (who: string) =>
    ((await (await call(who, "GET", "/api/hotels/AGR/group")).json()) as { office: Record<string, unknown> }).office;

  it("are changed by exactly the owner, an administrator and the GM", () => {
    expect(whoMay(WRITE_RULES["PUT /api/hotels/:code/group/office"]!)).toEqual(["owner", "admin", "gm"]);
  });

  it("are none to begin with", async () => {
    expect(await read(people.desk)).toEqual({
      address: null, phone: null, email: null, website: null, gstin: null, instagram: null });
  });

  it("are saved by the GM, the GSTIN in capitals, and everybody who prints reads them", async () => {
    const res = await office(people.gm, OFFICE);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await read(people.desk)).toEqual({ ...OFFICE, gstin: "27AAAAA0000A1Z5" });
  });

  it.each([
    [{ address: "x".repeat(201) }, "The office address is 201 characters. The most is 200."],
    [{ phone: "x".repeat(41) }, "The office phone is 41 characters. The most is 40."],
    [{ email: "not an address" }, "That does not look like an email address."],
    [{ website: "not a site" }, "A website is an address such as www.example.com."],
    [{ gstin: "27AAAAA0000A1Z" }, "That does not look like a GSTIN - fifteen characters, starting with the two-digit state code."],
    [{ instagram: "x".repeat(81) }, "The Instagram address is 81 characters. The most is 80."],
  ])("refuse %j in a sentence, and keep what was there", async (wrong, sentence) => {
    const before = await read(people.gm);
    const res = await office(people.gm, wrong);
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(sentence);
    expect(await read(people.gm)).toEqual(before);
  });

  it("clear what is sent blank, and leave alone what is not sent", async () => {
    expect((await office(people.admin, { website: "", instagram: " " })).status).toBe(200);
    expect(await read(people.gm)).toEqual({ ...OFFICE, gstin: "27AAAAA0000A1Z5", website: null, instagram: null });
  });

  it("are not reception's to change", async () => {
    const res = await office(people.desk, { phone: "0000" });
    expect(res.status).toBe(403);
    expect((await read(people.gm))["phone"]).toBe("+91 20 0000 0000");
  });
});

describe("the hotel's reservations contact and house policies", () => {
  const patch = (who: string, body: unknown) => call(who, "PATCH", "/api/admin/hotels/AGR", body);
  const stored = async () => (await sql<{ reservations_contact: string | null; house_policies: string[] }>(
    "select reservations_contact, house_policies from hotels where code = 'AGR'"))[0]!;

  it("are saved by the GM - a policy a line, trimmed, blank lines dropped - and read back", async () => {
    const res = await patch(people.gm, {
      reservationsContact: " Meera Kulkarni ",
      housePolicies: ["  Pets are welcome. ", "", "No smoking in the rooms.", "   "],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toEqual({
      reservations_contact: "Meera Kulkarni",
      house_policies: ["Pets are welcome.", "No smoking in the rooms."],
    });
    const property = ((await (await call(people.gm, "GET", "/api/admin/hotels/AGR")).json()) as
      { property: Record<string, unknown> }).property;
    expect(property).toMatchObject({
      reservationsContact: "Meera Kulkarni", housePolicies: ["Pets are welcome.", "No smoking in the rooms."],
    });
  });

  it.each([
    [{ housePolicies: Array.from({ length: 9 }, (_, i) => `Policy ${i + 1}.`) },
      "A hotel has at most 8 house policies. This is 9."],
    [{ housePolicies: ["Short.", "x".repeat(201)] }, "House policy 2 is 201 characters. The most is 200."],
    [{ housePolicies: "Pets are welcome." }, "House policies are a list, one policy a line."],
    [{ reservationsContact: "x".repeat(81) }, "The reservations contact is 81 characters. The most is 80."],
  ])("refuse %j in a sentence, and keep what was there", async (wrong, sentence) => {
    const before = await stored();
    const res = await patch(people.admin, wrong);
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(sentence);
    expect(await stored()).toEqual(before);
  });

  it("can be emptied: no contact, no house policies, and they stay so", async () => {
    expect((await patch(people.admin, { reservationsContact: "", housePolicies: [] })).status).toBe(200);
    expect(await stored()).toEqual({ reservations_contact: null, house_policies: [] });
  });
});
