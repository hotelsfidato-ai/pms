import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES, whoMay } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   A HOTEL'S OWN DETAILS (the owner's D27-213 and D27-214)

   A hotel's GM and Admin may edit their OWN hotel's details; until now
   only a group administrator could. The hotel's NAME stays the group
   owner's, like its code. Every change is recorded with who and when
   (the hotels_audit trigger). Another hotel's GM, and reception, change
   nothing.

   The hotel-level Admin is the case 168 fixed underneath: the write
   policy left that role out, so a save wrote nothing.

   THE PROFILE (phase 2): PIN, PAN, website, reservations phone, property
   type, stars and the map point - each refused in a sentence when it is
   not what it says; a blank clears, a key not sent is left alone. And
   the hotel's OWN LOGO: the group logo's rules, for whoever manages
   that hotel; every reader of the group's logo is handed it as well.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "HPROFILE";
const GSTIN = "09AAGCF5655F1ZI";

const people: Record<"gm" | "admin" | "desk" | "elsewhere", string> =
  { gm: "", admin: "", desk: "", elsewhere: "" };
let was: Record<string, unknown> = {};
let ownerId = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const patch = (who: string, body: unknown, code = "AGR") =>
  app.request(`/api/admin/hotels/${code}`, {
    method: "PATCH",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const stored = async () => (await sql<{
  name: string; phone: string | null; gstin: string | null; address_line: string | null;
}>("select name, phone, gstin, address_line from hotels where code = 'AGR'"))[0]!;

beforeAll(async () => {
  was = (await sql<Record<string, unknown>>(
    "select name, phone, gstin, address_line, city, state, email::text from hotels where code = 'AGR'"))[0]!;
  ownerId = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const at: [keyof typeof people, string, string][] = [
    ["gm", "AGR", "gm"], ["admin", "AGR", "admin"],
    ["desk", "AGR", "front_desk"], ["elsewhere", "PUN", "gm"],
  ];
  for (const [who, hotel, role] of at) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`hprofile-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $3 from hotels where code = $2",
      [row!.id, hotel, role]);
  }
});

afterAll(async () => {
  await sql(
    `update hotels set name = $1, phone = $2, gstin = $3, address_line = $4,
            address_line_2 = null, pin = null, website = null, pan = null,
            reservations_phone = null, property_type = null, star_rating = null,
            latitude = null, longitude = null
      where code = 'AGR'`,
    [was["name"], was["phone"], was["gstin"], was["address_line"]]);
  await sql("delete from hotel_logos where hotel_id = (select id from hotels where code = 'AGR')");
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("a hotel's own details", () => {
  it("are saved by its GM, and the change is recorded under their name", async () => {
    const res = await patch(people.gm, {
      name: was["name"], addressLine: "1 Fort Road", phone: "0562 111 2222", gstin: GSTIN,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toMatchObject({
      address_line: "1 Fort Road", phone: "0562 111 2222", gstin: GSTIN,
    });
    /* The GSTIN prints on every invoice: who changed it, and when, is kept. */
    const log = await sql<{ n: string }>(
      `select count(*)::text as n from audit_log
        where table_name = 'hotels' and actor = $1 and after->>'gstin' = $2`,
      [people.gm, GSTIN]);
    expect(Number(log[0]!.n)).toBeGreaterThan(0);
  });

  it("are saved by its Admin - the save really writes (168)", async () => {
    const res = await patch(people.admin, { phone: "0562 333 4444" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stored()).phone).toBe("0562 333 4444");
  });

  it("keep their NAME for the group's owner: a GM renaming it is refused", async () => {
    const res = await patch(people.gm, { name: "Renamed By Its GM", phone: "0562 555 6666" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/name.*group/i);
    expect(await stored()).toMatchObject({ name: was["name"], phone: "0562 333 4444" });

    const owner = await patch(ownerId, { name: "Agra, by the owner" });
    expect(owner.status, await owner.clone().text()).toBe(200);
    expect((await stored()).name).toBe("Agra, by the owner");
  });

  it("are not another hotel's GM's to change", async () => {
    const before = await stored();
    const res = await patch(people.elsewhere, { phone: "0000" });
    expect([403, 404, 409]).toContain(res.status);
    expect(await stored()).toEqual(before);
  });

  it("nor reception's", async () => {
    const before = await stored();
    const res = await patch(people.desk, { phone: "0000" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("group administrator");
    expect(await stored()).toEqual(before);
  });
});

/* ── Phase 2: the profile's own fields ─────────────────────────────── */

const profile = async () => (await sql<Record<string, unknown>>(
  `select address_line_2, pin, website, pan, reservations_phone, property_type, star_rating,
          latitude::text, longitude::text
     from hotels where code = 'AGR'`))[0]!;
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

describe("the hotel's profile", () => {
  const FULL = {
    addressLine2: "Near the East Gate", pin: "282001", website: "www.example.com",
    pan: "aagcf5655f", reservationsPhone: "+91 562 000 0000",
    propertyType: "heritage_hotel", starRating: 4, latitude: "27.175", longitude: 78.0421,
  };

  it("is saved by the GM and read back: the PAN in capitals, the map point to six places", async () => {
    const res = await patch(people.gm, FULL);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await profile()).toEqual({
      address_line_2: "Near the East Gate", pin: "282001", website: "www.example.com",
      pan: "AAGCF5655F", reservations_phone: "+91 562 000 0000",
      property_type: "heritage_hotel", star_rating: 4,
      latitude: "27.175000", longitude: "78.042100",
    });
    const read = await app.request("/api/admin/hotels/AGR", { headers: { "x-dev-staff-id": people.gm } });
    expect(((await read.json()) as { property: Record<string, unknown> }).property).toMatchObject({
      addressLine2: "Near the East Gate", pin: "282001", website: "www.example.com",
      pan: "AAGCF5655F", reservationsPhone: "+91 562 000 0000",
      propertyType: "heritage_hotel", starRating: 4,
      latitude: "27.175000", longitude: "78.042100",
    });
  });

  it.each([
    [{ pin: "28200" }, "A PIN code is six digits, and does not start with 0."],
    [{ pin: "082001" }, "A PIN code is six digits, and does not start with 0."],
    [{ pan: "AAGCF5655" }, "A PAN is ten characters: five letters, four digits, then a letter."],
    [{ website: "not a site" }, "A website is an address such as www.example.com."],
    [{ propertyType: "motel" }, "Pick the property type from the list."],
    [{ starRating: 6 }, "Stars are a whole number from 1 to 5, or not set."],
    [{ starRating: "0" }, "Stars are a whole number from 1 to 5, or not set."],
    [{ latitude: "27.1" }, "A map point is both a latitude and a longitude, or neither."],
    [{ latitude: "91", longitude: "78" }, "The latitude is a number between -90 and 90."],
    [{ latitude: "27", longitude: "181" }, "The longitude is a number between -180 and 180."],
    [{ latitude: "north", longitude: "78" }, "The latitude is a number between -90 and 90."],
  ])("refuses %j in a sentence, and keeps what was there", async (body, sentence) => {
    const before = await profile();
    const res = await patch(people.gm, { ...body, phone: "0562 999 9999" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(sentence);
    expect(await profile()).toEqual(before);
    expect((await stored()).phone).not.toBe("0562 999 9999");
  });

  it("clears a field sent blank, and leaves alone a field not sent", async () => {
    const res = await patch(people.admin, { website: "", starRating: null, latitude: "", longitude: "" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await profile()).toMatchObject({
      website: null, star_rating: null, latitude: null, longitude: null,
      pin: "282001", pan: "AAGCF5655F", property_type: "heritage_hotel",
    });
  });
});

/* ── Phase 2: the hotel's own logo ─────────────────────────────────── */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this hotel's own picture"),
]);
const logo = (who: string, method: string, bytes?: Buffer, code = "AGR") =>
  app.request(`/api/hotels/${code}/logo`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(bytes ? { body: JSON.stringify({ data: bytes.toString("base64") }) } : {}),
  });
const storedLogo = async () => (await sql<{ logo_type: string; logo: Buffer; changed_by: string | null }>(
  `select logo_type, logo, changed_by::text from hotel_logos
    where hotel_id = (select id from hotels where code = 'AGR')`))[0] ?? null;
const read = async (who: string, code = "AGR") =>
  (await (await app.request(`/api/hotels/${code}/group`, { headers: { "x-dev-staff-id": who } })).json()) as
    { hotelLogo: { type: string; data: string } | null };

describe("a hotel's own logo", () => {
  it("is changed by exactly the owner, an administrator and the GM", () => {
    for (const route of ["PUT /api/hotels/:code/logo", "DELETE /api/hotels/:code/logo"]) {
      expect(whoMay(WRITE_RULES[route]!), route).toEqual(["owner", "admin", "gm"]);
    }
  });

  it("is none to begin with", async () => {
    expect((await read(people.desk)).hotelLogo).toBeNull();
  });

  it("is refused to reception, and to another hotel's GM, and nothing is written", async () => {
    expect((await logo(people.desk, "PUT", PNG)).status).toBe(403);
    expect([403, 404]).toContain((await logo(people.elsewhere, "PUT", PNG)).status);
    expect(await storedLogo()).toBeNull();
  });

  it("takes a PNG from the hotel's Admin, under their name, and reception reads it back", async () => {
    const res = await logo(people.admin, "PUT", PNG);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await storedLogo()).toEqual({ logo_type: "image/png", logo: PNG, changed_by: people.admin });
    expect((await read(people.desk)).hotelLogo).toEqual({ type: "image/png", data: PNG.toString("base64") });
    /* It is THIS hotel's: another hotel still has none. */
    expect((await read(people.elsewhere, "PUN")).hotelLogo).toBeNull();
  });

  it.each([
    ["a JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]), "The logo must be a PNG or an SVG picture."],
    ["a file over 200 KB", Buffer.concat([PNG, Buffer.alloc(200 * 1024)]), "The logo is 201 KB. The most is 200 KB."],
    ["an SVG carrying a script", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), null],
  ])("refuses %s, and keeps the logo there", async (_, bytes, sentence) => {
    const res = await logo(people.gm, "PUT", bytes);
    expect(res.status).toBe(409);
    if (sentence) expect(await reason(res)).toBe(sentence);
    expect((await storedLogo())?.logo).toEqual(PNG);
  });

  it("is not removed by reception; the GM removes it", async () => {
    expect((await logo(people.desk, "DELETE")).status).toBe(403);
    expect((await storedLogo())?.logo).toEqual(PNG);
    expect((await logo(people.gm, "DELETE")).status).toBe(200);
    expect(await storedLogo()).toBeNull();
    expect((await read(people.desk)).hotelLogo).toBeNull();
  });
});
