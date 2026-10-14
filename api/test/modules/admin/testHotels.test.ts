import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

/* ══════════════════════════════════════════════════════════════════
   TEST HOTELS, THE API'S HALF (D27-296, the owner, 10 October)

   The database's half - the two sides of the group's guests, the mixing
   guard, the copy, the reset - is db/tests/modules/test-hotels.sql. Here:
   the three routes and who may use them, the people rules (a tester is
   never made out of somebody's sign-in, and giving a test hotel touches no
   sign-in account), each side read through the routes, nothing leaving a
   test hotel, the group's views leaving it out, and its documents marked.

   Firebase is stood in for, and every call to it is written down: the
   people tests read that list.

   Builds its own real hotel (THA) and test hotel (TTHA), and removes both.
   ══════════════════════════════════════════════════════════════════ */

const firebase: string[] = [];
vi.mock("../../../src/identity.ts", async (original) => {
  const real = await original<typeof import("../../../src/identity.ts")>();
  return {
    ...real,
    ensureAccount: async (email: string, _name: string, _password?: string, options: { adopt?: boolean } = {}) => {
      firebase.push(`ensureAccount ${email} adopt=${options.adopt ?? true}`);
      return { uid: `test-uid-${email}`, existed: false };
    },
    setAccountPassword: async (uid: string) => { firebase.push(`setAccountPassword ${uid}`); },
    setSignIn: async (uid: string) => { firebase.push(`setSignIn ${uid}`); },
  };
});

const { app } = await import("../../../src/server.ts");
const { closePool, withUser } = await import("../../../src/db.ts");
const { send } = await import("../../../src/sending.ts");
const { OUTSIDE, NOTHING_SENT } = await import("../../../src/testHotels.ts");
const { alertHotels } = await import("../../../src/modules/connections-health/alerts.ts");
const { voucherFacts } = await import("../../../src/modules/guest-messaging/voucherDocument.ts");
const { renderCsv, TEST_MARK } = await import("../../../src/reportRender.ts");
const { invoicePdf } = await import("../../../src/modules/guest-messaging/invoiceDocument.ts");
const zlib = await import("node:zlib");

/** The text a PDF draws, run by run: its streams inflated, the strings of
    each Tj and TJ joined (a kerned word is split across one TJ's strings). */
function pdfText(pdf: Buffer): string {
  const s = pdf.toString("latin1");
  const runs: string[] = [];
  let at = 0;
  while ((at = s.indexOf("stream", at)) >= 0) {
    const start = s.indexOf("\n", at) + 1;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const body = zlib.inflateSync(Buffer.from(s.slice(start, end).replace(/\r?\n$/, ""), "latin1"))
        .toString("latin1");
      for (const m of body.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
        const hex = m[1] !== undefined
          ? [...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]).join("")
          : m[2]!;
        runs.push(Buffer.from(hex, "hex").toString("latin1"));
      }
    } catch { /* not a deflated stream: an image, a font */ }
    at = end + "endstream".length;
  }
  return runs.join(" ");
}

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const RUN = Date.now();
let owner: string;
let gm: string;           // the real hotel's GM
let agra: string;         // somebody already here, with a sign-in
let tester: string;       // made at the test hotel
let real: string;
let test: string;
let realGuest: string;
let testGuest: string;
let groupGstin: { had: boolean; gstin: string | null };

const call = (by: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "x-dev-staff-id": by, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  agra = (await sql("select id::text from staff where email = 'agra@fidato.in'")).rows[0].id;
  await sql(`begin;
    select set_config('app.user_id', '${owner}', true);
    select app.provision_property_unchecked('THA', 'TH API Real', 'Nowhere');
    commit;`);
  real = (await sql("select id::text from hotels where code = 'THA'")).rows[0].id;
  gm = (await sql(
    `insert into staff (email, full_name, long_password) values ($1, 'THA GM', true)
     on conflict (email) do update set is_active = true returning id::text`,
    [`tha-gm-${RUN}@fidato.in`])).rows[0].id;
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'gm')", [gm, real]);
  const had = await sql("select gstin from group_settings where id = 1");
  groupGstin = { had: had.rows.length > 0, gstin: had.rows[0]?.gstin ?? null };
  await sql(`insert into group_settings (id, gstin) values (1, '27CCCCC0000C1Z5')
             on conflict (id) do update set gstin = excluded.gstin`);
});

afterAll(async () => {
  await sql(`begin;
    select set_config('app.user_id', '${owner}', true);
    select app.reset_test_hotel(id) from hotels where code = 'TTHA';
    select set_config('app.test_reset', (select id::text from hotels where code = 'TTHA'), true);
    select app.test_hotel_clear(id, 'setup') from hotels where code = 'TTHA';
    delete from staff_hotels where hotel_id in (select id from hotels where code in ('THA', 'TTHA'));
    alter table hotels disable trigger hotels_no_delete;
    delete from hotels where code = 'TTHA';
    delete from guest_links where hotel_id = (select id from hotels where code = 'THA');
    delete from reservations where hotel_id = (select id from hotels where code = 'THA');
    delete from hotels where code = 'THA';
    alter table hotels enable trigger hotels_no_delete;
    commit;`);
  await sql("update staff set is_active = false where email like $1", [`th%-${RUN}@fidato.in`]);
  if (groupGstin.had) await sql("update group_settings set gstin = $1 where id = 1", [groupGstin.gstin]);
  else await sql("delete from group_settings where id = 1");
  await closePool();
});

describe("making a test hotel (D27-296 (10), (12))", () => {
  it("is for the owner or a group administrator only - not the real hotel's GM", async () => {
    const res = await call(gm, "POST", "/api/admin/hotels/THA/test-hotel");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "Only the owner or a group administrator makes, resets or re-copies a test hotel." });
  });

  it("makes \"<name> · TEST\" as \"T<CODE>\" (D27-320), 201", async () => {
    const res = await call(owner, "POST", "/api/admin/hotels/THA/test-hotel");
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await res.json()).toEqual({ code: "TTHA", name: "TH API Real · TEST" });
    test = (await sql("select id::text from hotels where code = 'TTHA'")).rows[0].id;
  });

  it("one per real hotel: a second is refused, 409", async () => {
    const res = await call(owner, "POST", "/api/admin/hotels/THA/test-hotel");
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("TH API Real already has a test hotel: TTHA.");
  });

  it("a test hotel has none of its own, and an unknown code is 404", async () => {
    const own = await call(owner, "POST", "/api/admin/hotels/TTHA/test-hotel");
    expect(own.status).toBe(409);
    expect((await own.json() as { error: string }).error).toBe("TTHA is a test hotel. A test hotel is made for a real one.");
    expect((await call(owner, "POST", "/api/admin/hotels/ZZZQ/test-hotel")).status).toBe(404);
  });

  it("GET /api/hotels names the real hotel's code as testOf, null for a real one", async () => {
    const body = await (await call(owner, "GET", "/api/hotels")).json() as {
      hotels: Array<{ code: string; testOf: string | null; gstin: string | null }>;
    };
    expect(body.hotels.find((h) => h.code === "TTHA")).toMatchObject({ testOf: "THA", gstin: null });
    expect(body.hotels.find((h) => h.code === "THA")?.testOf).toBeNull();
  });

  it("a test hotel takes no GSTIN, PAN or FSSAI number, said in a sentence", async () => {
    const said = "A test hotel carries no GSTIN, PAN or FSSAI number: its documents are not valid ones.";
    const gst = await call(owner, "PATCH", "/api/admin/hotels/TTHA", { gstin: "27AAAAA0000A1Z5" });
    expect(gst.status).toBe(409);
    expect((await gst.json() as { reason: string }).reason).toBe(said);
    const pan = await call(owner, "PATCH", "/api/admin/hotels/TTHA", { pan: "AAAAA0000A" });
    expect((await pan.json() as { reason: string }).reason).toBe(said);
    const fssai = await call(owner, "PUT", "/api/hotels/TTHA/fssai", { fssai: "12345678901234" });
    expect(fssai.status).toBe(409);
    expect((await fssai.json() as { reason: string }).reason).toBe(said);
    /* Everything else of its profile is the testers' to change. */
    expect((await call(owner, "PATCH", "/api/admin/hotels/TTHA", { phone: "+911234567890" })).status).toBe(200);
  });

  it("the property list says which is whose", async () => {
    const body = await (await call(owner, "GET", "/api/admin/hotels")).json() as {
      hotels: Array<{ code: string; testOf: string | null; testHotel: string | null }>;
    };
    expect(body.hotels.find((h) => h.code === "TTHA")).toMatchObject({ testOf: "THA", testHotel: null });
    expect(body.hotels.find((h) => h.code === "THA")).toMatchObject({ testOf: null, testHotel: "TTHA" });
  });
});

describe("people in a test hotel (D27-296 (6), (10))", () => {
  it("only the owner or a group administrator adds somebody there - 403 for the real hotel's GM, nothing made", async () => {
    firebase.length = 0;
    const email = `thtest-gm-${RUN}@fidato.in`;
    const res = await call(gm, "POST", "/api/admin/staff", {
      email, name: "TH By GM", password: "a-real-password", hotelCode: "TTHA", role: "front_desk" });
    expect(res.status).toBe(403);
    expect((await res.json() as { error?: string; reason: string }).reason)
      .toBe("Only the owner or a group administrator adds somebody to a test hotel.");
    expect(firebase).toEqual([]);
    expect((await sql("select 1 from staff where email = $1", [email])).rows).toEqual([]);
  });

  it("a person added there is a tester, made with a NEW sign-in account, never an adopted one", async () => {
    firebase.length = 0;
    const email = `thtester-${RUN}@fidato.in`;
    const res = await call(owner, "POST", "/api/admin/staff", {
      email, name: "TH Tester", password: "a-real-password", hotelCode: "TTHA", role: "front_desk" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, testOnly: true });
    expect(firebase).toEqual([`ensureAccount ${email} adopt=false`]);
    tester = (await sql("select id::text from staff where email = $1 and test_only", [email])).rows[0].id;
  });

  it("somebody already here is never \"added\" to a test hotel - their password would change", async () => {
    firebase.length = 0;
    const res = await call(owner, "POST", "/api/admin/staff", {
      email: "agra@fidato.in", name: "Agra Clerk", password: "a-real-password", hotelCode: "TTHA", role: "front_desk" });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/^agra@fidato\.in already has a sign-in\. .*Give access/);
    expect(firebase).toEqual([]);
  });

  it("giving a test hotel as a second place is the owner's or a group administrator's - 403 for a GM", async () => {
    const res = await call(gm, "POST", `/api/admin/staff/${agra}/access`, { code: "TTHA", role: "front_desk" });
    expect(res.status).toBe(403);
  });

  it("and it never touches the person's sign-in account or password", async () => {
    firebase.length = 0;
    const res = await call(owner, "POST", `/api/admin/staff/${agra}/access`, { code: "TTHA", role: "front_desk" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(firebase).toEqual([]);
    expect((await sql(
      "select 1 from staff_hotels where staff_id = $1 and hotel_id = $2", [agra, test])).rows).toHaveLength(1);
  });

  it("a tester is never given a real hotel", async () => {
    const res = await call(owner, "POST", `/api/admin/staff/${tester}/access`, { code: "THA", role: "front_desk" });
    expect(res.status).toBe(403);
    expect((await res.json() as { reason: string }).reason).toBe("TH Tester was added for testing, and works only in test hotels.");
  });

  it("People shows who is a tester, and marks each test-hotel place with the hotel it copies", async () => {
    const body = await (await call(owner, "GET", "/api/admin/staff")).json() as {
      staff: Array<{ id: string; testOnly: boolean; access: Array<{ code: string; role: string; testOf: string | null }> }>;
      rosterAt: Array<{ code: string; testOf: string | null }>;
    };
    expect(body.staff.find((s) => s.id === tester)?.testOnly).toBe(true);
    const agraRow = body.staff.find((s) => s.id === agra);
    expect(agraRow?.testOnly).toBe(false);
    expect(agraRow?.access).toEqual(expect.arrayContaining([
      { code: "AGR", role: "front_desk", testOf: null },
      { code: "TTHA", role: "front_desk", testOf: "THA" },
    ]));
    expect(body.rosterAt.find((p) => p.code === "TTHA")?.testOf).toBe("THA");
    expect(body.rosterAt.find((p) => p.code === "THA")?.testOf).toBeNull();
  });
});

describe("each side reads only its own guests, through the routes (D27-296 (5))", () => {
  beforeAll(async () => {
    realGuest = (await sql(
      "insert into guests (full_name, phone) values ($1, '9822200001') returning id::text",
      [`THR Real ${RUN}`])).rows[0].id;
    testGuest = (await sql(
      "insert into guests (full_name, phone, test_hotel_id) values ($1, '9822200001', $2) returning id::text",
      [`THR Test ${RUN}`, test])).rows[0].id;
  });

  const search = async (code: string) =>
    ((await (await call(owner, "GET", `/api/hotels/${code}/crm/guests?q=THR`)).json()) as {
      guests: Array<{ id: string }> }).guests.map((g) => g.id);

  it("guest search in the test hotel finds its test guest and never the real one", async () => {
    const found = await search("TTHA");
    expect(found).toContain(testGuest);
    expect(found).not.toContain(realGuest);
  });

  it("and at the real hotel, never the test guest - whoever asks, the owner included", async () => {
    const found = await search("THA");
    expect(found).toContain(realGuest);
    expect(found).not.toContain(testGuest);
  });

  it("Guest 360 of a real guest is not there from the test hotel", async () => {
    expect((await call(owner, "GET", `/api/hotels/TTHA/crm/guests/${realGuest}`)).status).toBe(404);
    expect((await call(owner, "GET", `/api/hotels/THA/crm/guests/${realGuest}`)).status).toBe(200);
  });
});

describe("nothing leaves a test hotel (D27-296 (4))", () => {
  const fill = (pattern: string, code: string) => pattern
    .replace(":code", code)
    .replace(/:number\{[^}]*\}/, "THA-1")
    .replace(/:file\{.*\}$/, "day-book")
    .replace(/:[A-Za-z]+/g, randomUUID());

  it("every button on the list is a route the server has", () => {
    const mounted = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    const missing = Object.keys(OUTSIDE).filter((key) => !mounted.has(key));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(OUTSIDE))("%s answers 409 in a test hotel, before it runs", async (key, sentence) => {
    const [method, pattern] = key.split(" ") as [string, string];
    const res = await call(owner, method, fill(pattern, "TTHA"), method === "GET" ? undefined : {});
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe(sentence);
  });

  it.each(Object.keys(OUTSIDE))("%s is not refused that way at a real hotel", async (key) => {
    const [method, pattern] = key.split(" ") as [string, string];
    const res = await call(owner, method, fill(pattern, "THA"), method === "GET" ? undefined : {});
    const text = await res.text();
    expect(text).not.toContain("This is a test hotel");
  });

  it("loyalty and the channel manager cannot be switched on in a test hotel, said in a sentence", async () => {
    for (const [module, words] of [["loyalty", "loyalty"], ["channel_manager", "the channel manager"]] as const) {
      const res = await call(owner, "POST", `/api/hotels/TTHA/modules/${module}`, { enabled: true });
      expect(res.status, module).toBe(409);
      expect((await res.json() as { reason: string }).reason)
        .toBe(`This is a test hotel: ${words} cannot be switched on here.`);
    }
    /* The rest of its switches are the testers' (the restaurant, the hall). */
    expect((await call(owner, "POST", "/api/hotels/TTHA/modules/banquet", { enabled: true })).status).toBe(200);
  });

  it("the one door out refuses a test hotel's message, and writes the refusal down", async () => {
    const result = await withUser(owner, (client) => send(client, {
      channel: "whatsapp", kind: "voucher",
      hotel: { id: test, code: "TTHA", name: "TH API Real · TEST" },
      to: { name: "TH Guest", phone: "+919822200001" },
      about: { kind: "reservation", id: `th-${RUN}` },
    }));
    expect(result).toEqual({ ok: false, reason: NOTHING_SENT });
    const { rows } = await sql(
      "select status, detail from messages_sent where hotel_id = $1 and about_id = $2", [test, `th-${RUN}`]);
    expect(rows).toEqual([{ status: "failed", detail: NOTHING_SENT }]);
  });

  it("the health alerts' sweep never looks at a test hotel", async () => {
    const codes = (await alertHotels()).map((h) => h.code);
    expect(codes).toContain("THA");
    expect(codes).not.toContain("TTHA");
  });

  it("SU and the CRS cannot be connected to a test hotel at all, so their sweeps never meet one", async () => {
    await expect(sql("insert into channel_hotels (hotel_id, su_hotel_id) values ($1, 'SU-TTHA')", [test]))
      .rejects.toThrow(NOTHING_SENT);
    await expect(sql(
      "insert into crs_hotels (hotel_id, crs_hotel_id, booking_source_id) select $1, 'CRS-TTHA', id from booking_sources limit 1",
      [test])).rejects.toThrow(NOTHING_SENT);
  });

  it("the guest's own page never sends a test hotel's guest to DigiLocker, where it is set up", async () => {
    const link = async (hotel: string, guest: string) => {
      const { rows: rt } = await sql("select id::text from room_types where hotel_id = $1 limit 1", [hotel]);
      const { rows: stay } = await sql(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate)
         values ($1, app.next_reference($1), $2, $3, current_date + 5, current_date + 6, 1000) returning id::text`,
        [hotel, guest, rt[0].id]);
      const token = `th-token-${RUN}-${randomUUID()}`;
      const hash = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
      await sql(
        `insert into guest_links (hotel_id, reservation_id, token_hash, origin, expires_at)
         values ($1, $2, $3, 'desk', now() + interval '1 day')`, [hotel, stay[0].id, hash]);
      return token;
    };
    const saved = ["DIGILOCKER_CLIENT_ID", "DIGILOCKER_CLIENT_SECRET", "DIGILOCKER_REDIRECT_URI"]
      .map((k) => [k, process.env[k]] as const);
    process.env["DIGILOCKER_CLIENT_ID"] = "th-client";
    process.env["DIGILOCKER_CLIENT_SECRET"] = "th-secret";
    process.env["DIGILOCKER_REDIRECT_URI"] = "https://example.invalid/th";
    try {
      const testToken = await link(test, testGuest);
      const realToken = await link(real, realGuest);
      const opened = await (await app.request(`/api/guest/${testToken}`)).json() as {
        hotel: { test: boolean }; digilocker: boolean };
      expect(opened.hotel.test).toBe(true);
      expect(opened.digilocker).toBe(false);
      const begun = await app.request(`/api/guest/${testToken}/digilocker`, { method: "POST" });
      expect(begun.status).toBe(409);
      expect((await begun.json() as { error: string }).error).toBe(NOTHING_SENT);
      /* The same door, for a real hotel's booking, is open. */
      const realOpened = await (await app.request(`/api/guest/${realToken}`)).json() as {
        hotel: { test: boolean }; digilocker: boolean };
      expect(realOpened.hotel.test).toBe(false);
      expect(realOpened.digilocker).toBe(true);
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});

describe("kept apart from everything real (D27-296 (11))", () => {
  it("System health lists the real hotels and never a test one", async () => {
    const body = await (await call(owner, "GET", "/api/hotels/THA/system-health")).json() as {
      hotels?: Array<{ code: string }> };
    const codes = JSON.stringify(body);
    expect(codes).toContain("\"THA\"");
    expect(codes).not.toContain("\"TTHA\"");
  });
});

describe("a test hotel's documents are TEST · NOT VALID, without a GSTIN (D27-296 (8))", () => {
  it("its reports say so in every file, and carry no GSTIN", async () => {
    const res = await call(owner, "GET", "/api/hotels/TTHA/reports/no-show.csv");
    expect(res.status, await res.clone().text()).toBe(200);
    const lines = (await res.text()).split(/\r?\n/);
    expect(lines[1]).toBe(TEST_MARK);
    const realCsv = await (await call(owner, "GET", "/api/hotels/THA/reports/no-show.csv")).text();
    expect(realCsv).not.toContain(TEST_MARK);
  });

  it("the renderers print the mark for a test hotel's document only", () => {
    const doc = {
      report: "no-show", title: "No show", orientation: "portrait", facts: [], sections: [], footnotes: [],
      property: { code: "TTHA", name: "TH API Real · TEST", address: null, gstin: null, test: true },
    } as unknown as Parameters<typeof renderCsv>[0];
    const by = { name: "x", at: new Date(), timezone: "Asia/Kolkata" };
    expect(renderCsv(doc, by)).toContain(TEST_MARK);
    const { test: _test, ...realProperty } = doc.property;
    expect(renderCsv({ ...doc, property: realProperty }, by)).not.toContain(TEST_MARK);
  });

  it("its voucher is marked and prints neither the hotel's GSTIN nor the group office's", async () => {
    const { rows: rt } = await sql("select id::text from room_types where hotel_id = $1 limit 1", [test]);
    const { rows: stay } = await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2, $3, current_date + 9, current_date + 10, 1000, 'confirmed')
       returning id::text`, [test, testGuest, rt[0].id]);
    const facts = await withUser(owner, (client) => voucherFacts(client, stay[0].id));
    expect(facts?.test).toBe(true);
    expect(facts?.hotel.gstin).toBeNull();
    expect(facts?.group?.gstin ?? null).toBeNull();

    const { rows: realRt } = await sql("select id::text from room_types where hotel_id = $1 limit 1", [real]);
    const { rows: realStay } = await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2, $3, current_date + 9, current_date + 10, 1000, 'confirmed')
       returning id::text`, [real, realGuest, realRt[0].id]);
    const realFacts = await withUser(owner, (client) => voucherFacts(client, realStay[0].id));
    expect(realFacts?.test).toBeUndefined();
    expect(realFacts?.group?.gstin).toBe("27CCCCC0000C1Z5");

    /* And the View voucher the desk downloads says it, in the PDF itself. */
    const testPdf = await call(owner, "GET", `/api/hotels/TTHA/stays/${stay[0].id}/voucher.pdf`);
    expect(testPdf.status).toBe(200);
    const testText = pdfText(Buffer.from(await testPdf.arrayBuffer()));
    expect(testText).toContain(TEST_MARK);
    expect(testText).not.toContain("27CCCCC0000C1Z5");
    const realPdf = await call(owner, "GET", `/api/hotels/THA/stays/${realStay[0].id}/voucher.pdf`);
    const realText = pdfText(Buffer.from(await realPdf.arrayBuffer()));
    expect(realText).toContain("RESERVATION VOUCHER");
    expect(realText).not.toContain(TEST_MARK);
    expect(realText).toContain("27CCCCC0000C1Z5");
  });

  it("its tax invoice PDF is marked and prints neither the hotel's GSTIN nor the company's", async () => {
    const facts = {
      number: "TTHA/2026-27/00001", finYear: "2026-27", issuedAt: "10 Oct 2026, 10:00", businessDate: "2026-10-10",
      placeOfSupply: "Maharashtra", sacCode: "996311", vatBill: null, total: 1120, taxableValue: 1000,
      cgst: { rate: 6, amount: 60 }, sgst: { rate: 6, amount: 60 }, issuedBy: "TH",
      supplier: { name: "TH API Real · TEST", address: null, city: null, state: null, gstin: "27AAAAA0000A1Z5" },
      recipient: { name: "TH Co", address: null, gstin: "27DDDDD0000D1Z5" },
      lines: [{ description: "Room", date: "2026-10-10", amount: 1000, taxRate: 12, taxAmount: 120 }],
    } as unknown as Parameters<typeof invoicePdf>[0];
    const testText = pdfText(await invoicePdf(facts, true));
    expect(testText).toContain(TEST_MARK);
    expect(testText).not.toContain("27AAAAA0000A1Z5");
    expect(testText).not.toContain("27DDDDD0000D1Z5");
    const realText = pdfText(await invoicePdf(facts));
    expect(realText).not.toContain(TEST_MARK);
    expect(realText).toContain("27DDDDD0000D1Z5");
  });
});

describe("reset and re-copy (D27-296 (3))", () => {
  it("are the owner's or a group administrator's", async () => {
    expect((await call(gm, "POST", "/api/admin/hotels/TTHA/test-reset", { confirm: "RESET" })).status).toBe(403);
    expect((await call(tester, "POST", "/api/admin/hotels/TTHA/test-recopy", { confirm: "RE-COPY" })).status).toBe(403);
  });

  it("need the word typed: 400 without it", async () => {
    const res = await call(owner, "POST", "/api/admin/hotels/TTHA/test-reset", { confirm: "reset" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/^Type RESET to confirm\./);
    expect((await call(owner, "POST", "/api/admin/hotels/TTHA/test-recopy", { confirm: "RESET" })).status).toBe(400);
  });

  it("refuse a real hotel, 409", async () => {
    const res = await call(owner, "POST", "/api/admin/hotels/THA/test-reset", { confirm: "RESET" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("THA is a real hotel. Only a test hotel is reset.");
  });

  it("a reset clears the test activity and its guests, and keeps the testers - 200 { removed }", async () => {
    const res = await call(owner, "POST", "/api/admin/hotels/TTHA/test-reset", { confirm: "RESET" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { removed: number };
    expect(body.removed).toBeGreaterThanOrEqual(3);
    expect((await sql("select 1 from reservations where hotel_id = $1", [test])).rows).toEqual([]);
    expect((await sql("select 1 from guests where id = $1", [testGuest])).rows).toEqual([]);
    expect((await sql("select 1 from guests where id = $1", [realGuest])).rows).toHaveLength(1);
    expect((await sql("select 1 from staff_hotels where staff_id = $1 and hotel_id = $2", [tester, test])).rows)
      .toHaveLength(1);
    expect((await sql(
      "select actor::text from audit_log where hotel_id = $1 and action = 'TEST_RESET'", [test])).rows)
      .toEqual([{ actor: owner }]);
  });

  it("a re-copy brings the real hotel's setup again - 200 { removed, copied }", async () => {
    await sql("insert into room_types (hotel_id, code, name) values ($1, 'THX', 'TH Extra')", [real]);
    const res = await call(owner, "POST", "/api/admin/hotels/TTHA/test-recopy", { confirm: "RE-COPY" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { removed: number; copied: number };
    expect(body.copied).toBeGreaterThan(0);
    expect(typeof body.removed).toBe("number");
    expect((await sql("select 1 from room_types where hotel_id = $1 and code = 'THX'", [test])).rows).toHaveLength(1);
    expect((await sql("select 1 from staff_hotels where staff_id = $1 and hotel_id = $2", [tester, test])).rows)
      .toHaveLength(1);
  });
});
