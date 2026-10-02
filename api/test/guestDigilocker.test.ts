import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { forgetKnocksForTests } from "../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   DIGILOCKER (D27-235 2.5) - prepared, switched off

   OFF while any of its three settings is missing: nothing offered, every
   route answers like an unknown link. ON (here, with a stand-in for
   DigiLocker's token endpoint - the Authorized Partner API v2.2's
   /oauth2/2/token): the guest is sent to DigiLocker with PKCE, comes back
   with a code and the state, and the door unlocks this phone only when the
   DigiLocker account's mobile is the booking's - and leaves the masked
   Aadhaar and the name waiting for the desk. Never confirmed by itself.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const CODE = `DL${String(process.pid).slice(-1)}${String(process.pid).slice(-2, -1)}`;
const TOKEN = "a-booking-link-for-digilocker-tests-0123456789";
const NOTHING = "This link is not usable. Ask the desk for a new one.";
let hotelId: string;
let stay: string;

const SETTINGS = {
  DIGILOCKER_CLIENT_ID: "TESTCLIENT",
  DIGILOCKER_CLIENT_SECRET: "only-this-test-knows",
  DIGILOCKER_REDIRECT_URI: "http://localhost:5173/g-digilocker",
};
const on = () => Object.assign(process.env, SETTINGS);
const off = () => { for (const k of Object.keys(SETTINGS)) delete process.env[k]; };

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, string>) =>
  `${b64url({ alg: "RS256" })}.${b64url({ aud: "TESTCLIENT", ...claims })}.signature`;

/* DigiLocker's token endpoint, stood in for; every other fetch goes through. */
let tokenCalls: URLSearchParams[] = [];
let tokenAnswer: () => Response;
function standIn() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://digilocker.meripehchaan.gov.in/public/oauth2/2/token") {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return tokenAnswer();
    }
    return real(input, init);
  });
}

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/guest${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function start(): Promise<URL> {
  const res = await call(`/${TOKEN}/digilocker`, "POST");
  expect(res.status, await res.clone().text()).toBe(200);
  return new URL(((await res.json()) as { url: string }).url);
}

beforeAll(async () => {
  const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  hotelId = (await db.query("select app.provision_property_unchecked($1,'DigiLocker API','Nowhere')::text as id",
    [CODE])).rows[0].id;
  const guest = (await db.query("insert into guests (full_name, phone) values ('DLTEST Guest', '+91 90000 11122') returning id::text"))
    .rows[0].id;
  stay = (await db.query(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
             app.business_date($1), app.business_date($1) + 2, 2000, 'confirmed') returning id::text`,
    [hotelId, guest])).rows[0].id;
  await db.query(
    `insert into guest_links (hotel_id, reservation_id, token_hash, origin, expires_at)
     values ($1, $2, $3, 'desk', now() + interval '1 day')`,
    [hotelId, stay, createHash("sha256").update(TOKEN).digest("hex")]);
  await db.end();
});

beforeEach(async () => {
  forgetKnocksForTests();
  tokenCalls = [];
  await sql("delete from guest_detail_submissions where reservation_id = $1", [stay]);
});
afterEach(() => { off(); vi.restoreAllMocks(); });

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("delete from guest_detail_submissions where hotel_id = $1", [hotelId]);
  await db.query("delete from guest_unlocks where link_id in (select id from guest_links where hotel_id = $1)", [hotelId]);
  await db.query("delete from guest_links where hotel_id = $1", [hotelId]);
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotelId]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.end();
  await closePool();
});

describe("DigiLocker, switched off", () => {
  it("offers nothing and answers every route like an unknown link", async () => {
    expect(await (await call(`/${TOKEN}/digilocker`)).json()).toEqual({ offered: false });
    const begun = await call(`/${TOKEN}/digilocker`, "POST");
    expect([begun.status, await begun.json()]).toEqual([404, { error: NOTHING }]);
    const finished = await call("/digilocker/finish", "POST", { code: "x", state: "y" });
    expect([finished.status, await finished.json()]).toEqual([404, { error: NOTHING }]);
  });
});

describe("DigiLocker, switched on (a stand-in DigiLocker)", () => {
  beforeEach(() => { on(); standIn(); });

  it("is offered on a live link, and sends the guest to DigiLocker with PKCE", async () => {
    expect(await (await call(`/${TOKEN}/digilocker`)).json()).toEqual({ offered: true });
    const url = await start();
    expect(url.origin + url.pathname).toBe("https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code", client_id: "TESTCLIENT", redirect_uri: SETTINGS.DIGILOCKER_REDIRECT_URI,
      code_challenge_method: "S256", scope: "openid", acr: "aadhaar",
    });
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(await (await call("/no-such-link/digilocker")).json()).toEqual({ offered: false });
  });

  it("unlocks this phone for the booking's own mobile, and leaves the masked ID for the desk", async () => {
    tokenAnswer = () => Response.json({ access_token: "t", token_type: "Bearer",
      id_token: idToken({ phone_number: "9000011122", masked_aadhaar: "xxxxxxxx4321", given_name: "DL Guest" }) });
    const url = await start();
    const res = await call("/digilocker/finish", "POST", { code: "the-code", state: url.searchParams.get("state") });
    const body = await res.json() as { verified: boolean; unlock: string };
    expect(body.verified).toBe(true);

    const sentToDigiLocker = tokenCalls[0]!;
    expect(Object.fromEntries(sentToDigiLocker)).toMatchObject({
      grant_type: "authorization_code", code: "the-code", client_id: "TESTCLIENT",
      client_secret: "only-this-test-knows", redirect_uri: SETTINGS.DIGILOCKER_REDIRECT_URI,
    });
    const verifier = sentToDigiLocker.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));

    const page = await app.request(`/api/guest/${TOKEN}`, { headers: { authorization: `Guest ${body.unlock}` } });
    expect((await page.json() as { verified: boolean }).verified).toBe(true);
    const waiting = await sql(
      `select id_type, id_number, source, id_name, status from guest_detail_submissions where reservation_id = $1`, [stay]);
    expect(waiting.rows).toEqual([{ id_type: "aadhaar", id_number: "xxxxxxxx4321", source: "digilocker",
                                   id_name: "DL Guest", status: "waiting" }]);

    const again = await call("/digilocker/finish", "POST", { code: "the-code", state: url.searchParams.get("state") });
    expect(again.status, "a state answers once").toBe(404);
  });

  it("refuses another mobile, and keeps nothing", async () => {
    tokenAnswer = () => Response.json({ access_token: "t",
      id_token: idToken({ phone_number: "9999999999", masked_aadhaar: "xxxxxxxx4321", given_name: "Someone" }) });
    const url = await start();
    const res = await call("/digilocker/finish", "POST", { code: "c", state: url.searchParams.get("state") });
    expect(res.status).toBe(401);
    expect((await res.json() as { verified: boolean }).verified).toBe(false);
    const kept = await sql("select count(*)::int as n from guest_detail_submissions where reservation_id = $1", [stay]);
    expect(kept.rows[0].n).toBe(0);
  });

  it("refuses a token meant for another client, and a DigiLocker that says no", async () => {
    tokenAnswer = () => Response.json({ access_token: "t",
      id_token: `${b64url({})}.${b64url({ aud: "SOMEONE-ELSE", phone_number: "9000011122", masked_aadhaar: "xxxxxxxx4321" })}.s` });
    let url = await start();
    expect((await call("/digilocker/finish", "POST", { code: "c", state: url.searchParams.get("state") })).status).toBe(401);

    tokenAnswer = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    url = await start();
    expect((await call("/digilocker/finish", "POST", { code: "c", state: url.searchParams.get("state") })).status).toBe(404);
  });
});
