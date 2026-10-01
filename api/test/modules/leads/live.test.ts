import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { connected, settings } from "../../../src/modules/leads/live.ts";

/* ══════════════════════════════════════════════════════════════════
   LEADS, READ LIVE (D27-170), against a faked leads app

   The fake answers Firestore's REST calls the way Google does, over
   made-up leads shaped like the app's (n8n/3-build-firestore-commit.js,
   src/leads/marketingApi.js) - never a real person. It stands in through
   M2R_EMULATOR, which the server refuses in production. The database is
   this run's scratch copy, at a property this file provisions.

   Proved: another hotel's lead is never shown; the app's id (it holds the
   guest's number) never leaves the server; staff notes are not shown; a
   guest erased in the app does not pre-fill a booking (D27-108); every
   read is written down; the owner's cap stops the reads before any is
   made; the booking takes its source by channel and keeps its campaign.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const CODE = `LV${String(process.pid).slice(-2)}`;
const OURS = "made-up-hotel-ours";
const HOST = "http://leads-app.test";
let hotelId: string;
let clerk: string;

/* ── The fake leads app ─────────────────────────────────────────── */

type Fields = Record<string, unknown>;
const leads = new Map<string, Fields>();
const messages = new Map<string, { id: string; f: Fields }[]>();
const other = new Map<string, Fields>(); // hotels/{id}/marketing/campaigns, hotels/{id}/spend/{month}
const ROOT = "projects/demo-leads/databases/(default)/documents";
const asked: string[] = [];
/** The whole call refused, as Google answers a project or database that is not there. */
let notFound = false;

const enc = (v: unknown): unknown =>
  v === null ? { nullValue: null }
    : typeof v === "boolean" ? { booleanValue: v }
    : typeof v === "number" ? { integerValue: String(v) }
    : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
    : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v as Fields).map(([k, x]) => [k, enc(x)])) } }
    : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? { timestampValue: v }
    : { stringValue: String(v) };
const doc = (path: string, f: Fields) => ({ name: `${ROOT}/${path}`, fields: (enc(f) as { mapValue: { fields: unknown } }).mapValue.fields });

const fake = (async (url: string, init: RequestInit) => {
  if (!url.startsWith(`${HOST}/v1/${ROOT}`)) throw new Error(`not the leads app: ${url}`);
  const path = decodeURIComponent(url.slice(`${HOST}/v1/${ROOT}`.length));
  asked.push(path);
  const body = JSON.parse(String(init.body));
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
  const none = [{ readTime: "2026-09-29T05:00:00Z" }];
  if (path === ":runQuery") {
    const q = body.structuredQuery;
    const hotel = q.where.fieldFilter.value.stringValue;
    const rows = [...leads].filter(([, f]) => f["hotelId"] === hotel && f["lastMessageAt"])
      .sort(([, a], [, b]) => String(b["lastMessageAt"]).localeCompare(String(a["lastMessageAt"]))).slice(0, q.limit);
    return json(rows.length ? rows.map(([id, f]) => ({ document: doc(`conversations/${id}`, f) })) : none);
  }
  const sub = /^\/conversations\/(.+):runQuery$/.exec(path);
  if (sub) {
    const rows = [...(messages.get(sub[1]!) ?? [])].reverse().slice(0, body.structuredQuery.limit);
    return json(rows.length ? rows.map((m) => ({ document: doc(`conversations/${sub[1]}/messages/${m.id}`, m.f) })) : none);
  }
  if (path === ":batchGet") {
    if (notFound) return new Response("{}", { status: 404 });
    return json(body.documents.map((name: string) => {
      const p = name.slice(ROOT.length + 1);
      const f = p.startsWith("conversations/") ? leads.get(p.split("/")[1]!) : other.get(p);
      return f ? { found: doc(p, f) } : { missing: name };
    }));
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

const get = (path: string, staff = clerk) =>
  app.request(`/api/hotels/${CODE}${path}`, { headers: { "x-dev-staff-id": staff } });
const readsToday = async () => Number((await sql("select app.leads_reads_today() as n")).rows[0].n);
const tokenOf = async (name: string) => {
  const body = await (await get("/leads")).json() as { leads: { ref: string; name: string }[] };
  return body.leads.find((l) => l.name === name)!.ref;
};

beforeAll(async () => {
  vi.stubGlobal("fetch", fake);
  process.env["M2R_EMULATOR"] = HOST;
  process.env["M2R_HOTELS"] = `${CODE}=${OURS}`;
  process.env["M2R_DAILY_READS"] = "5000";
  process.env["M2R_APP_URL"] = "https://leads-app.test/";

  const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const client = await db.connect();
  try {
    await client.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await client.query("select app.provision_property_unchecked($1,'Leads Live Test','Nowhere')::text as id", [CODE])).rows[0].id;
    clerk = (await client.query(
      `insert into staff (email, full_name, firebase_uid) values ($1, 'Leads Live Clerk', $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`lv-desk-${process.pid}@fidato.in`, `test-uid-lv-${process.pid}`])).rows[0].id;
    await client.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'front_desk') on conflict do nothing", [clerk, hotelId]);
  } finally {
    client.release();
    await db.end();
  }

  leads.set("ours__910000000001", {
    hotelId: OURS, contactName: "Asha Test", contactPhone: "+910000000001", status: "NEW",
    routingMethod: "campaign", source: "ad", campaignId: "ad-777", attributionStatus: "CAMPAIGN",
    receivedAt: "2026-09-29T04:00:00.000Z", lastMessageAt: "2026-09-29T04:05:00.000Z",
    lastMessagePreview: "Room for two?", updatedAt: "2026-09-29T04:05:00.000Z",
  });
  messages.set("ours__910000000001", [
    { id: "m1", f: { direction: "in", type: "text", text: "Room for two?", receivedAt: "2026-09-29T04:00:00.000Z" } },
    { id: "m2", f: { direction: "note", type: "text", text: "staff only note", receivedAt: "2026-09-29T04:01:00.000Z" } },
    { id: "m3", f: { direction: "out", type: "text", text: "Yes, we have a room.", receivedAt: "2026-09-29T04:05:00.000Z" } },
  ]);
  leads.set("theirs__910000000002", {
    hotelId: "made-up-hotel-theirs", contactName: "Not Ours", contactPhone: "+910000000002", status: "NEW",
    lastMessageAt: "2026-09-29T04:02:00.000Z", updatedAt: "2026-09-29T04:02:00.000Z",
  });
  other.set(`hotels/${OURS}/marketing/campaigns`, {
    campaigns: { meta_120001: { name: "Made-up autumn offer", platform: "meta", campaignId: "120001", adSetIds: [], adIds: ["ad-777"] } },
  });
  other.set(`hotels/${OURS}/spend/2026-09`, {
    month: "2026-09", campaigns: { meta_120001: { days: { d20260901: { spend: 1200.5 }, d20260902: { spend: 800 } } } },
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const k of ["M2R_EMULATOR", "M2R_HOTELS", "M2R_DAILY_READS", "M2R_APP_URL"]) delete process.env[k];
  await closePool();
});

describe("leads, read live (D27-170)", () => {
  it("lists this hotel's leads only, by token, and never the app's id", async () => {
    const res = await get("/leads");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { connected: boolean; leads: { name: string; channel: string; ref: string }[] };
    expect(body.connected).toBe(true);
    expect(body.leads.map((l) => [l.name, l.channel])).toEqual([["Asha Test", "meta_ads"]]);
    expect(body.leads[0]!.ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(text).not.toContain("ours__");
    expect(text).not.toContain("Not Ours");
  });

  it("shows the conversation without staff notes, and links to reply in the app", async () => {
    const body = await (await get(`/leads/${await tokenOf("Asha Test")}`)).json() as
      { messages: { direction: string; body: string }[]; replyUrl: string };
    expect(body.messages.map((m) => [m.direction, m.body])).toEqual([["in", "Room for two?"], ["out", "Yes, we have a room."]]);
    expect(body.replyUrl).toBe("https://leads-app.test/inbox/ours__910000000001");
  });

  it("answers a token only at the hotel it was given for", async () => {
    const token = await tokenOf("Asha Test");
    const res = await app.request(`/api/hotels/5EL/leads/${token}`, { headers: { "x-dev-staff-id": clerk } });
    expect([403, 404]).toContain(res.status);
  });

  it("pre-fills a booking: source by channel, and the campaign its spend is filed under", async () => {
    const body = await (await get(`/leads/${await tokenOf("Asha Test")}/booking`)).json() as
      { name: string; phone: string; bookingSourceId: string | null; campaign: string | null };
    const meta = (await sql("select id::text from booking_sources where name = 'Meta Ads'")).rows[0].id;
    expect(body).toMatchObject({ name: "Asha Test", phone: "+910000000001", bookingSourceId: meta, campaign: "meta_120001" });
  });

  it("does not pre-fill a booking for a guest erased in the app (D27-108)", async () => {
    const token = await tokenOf("Asha Test");
    const kept = leads.get("ours__910000000001")!;
    leads.delete("ours__910000000001");
    try {
      const res = await get(`/leads/${token}/booking`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("Asha");
    } finally {
      leads.set("ours__910000000001", kept);
    }
  });

  it("writes every read down, as Google counts them", async () => {
    const before = await readsToday();
    asked.length = 0;
    await get(`/leads/${await tokenOf("Asha Test")}/booking`);
    expect(asked.length).toBeGreaterThan(0);
    expect(await readsToday()).toBeGreaterThan(before);
  });

  it("stops at the owner's cap before asking the app anything", async () => {
    process.env["M2R_DAILY_READS"] = String(await readsToday());
    asked.length = 0;
    try {
      const res = await get(`/leads/${await tokenOf("Asha Test").catch(() => "x")}/booking`);
      expect(res.status).toBe(429);
      expect(((await res.json()) as { atCap: boolean }).atCap).toBe(true);
      expect(asked).toEqual([]);
    } finally {
      process.env["M2R_DAILY_READS"] = "5000";
    }
  });

  it("puts a campaign's spend beside the stays that carry it", async () => {
    const guest = (await sql("insert into guests (full_name) values ('Leads Live Guest') returning id::text")).rows[0].id;
    await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status, campaign)
       values ($1, 'LV-' || $2, $3, (select id from room_types where hotel_id = $1 limit 1), '2026-09-10', '2026-09-12', 3000, 'confirmed', 'meta_120001')`,
      [hotelId, process.pid, guest]);
    const res = await app.request(`/api/hotels/${CODE}/marketing/numbers?month=2026-09`, {
      headers: { "x-dev-staff-id": (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { campaigns: { key: string; name: string; spend: number; bookings: number }[] };
    expect(body.campaigns).toEqual([expect.objectContaining({ key: "meta_120001", name: "Made-up autumn offer", spend: 2000.5, bookings: 1 })]);
  });

  /* D27-173: booked value. A stay arriving later, nothing charged yet, counts
     its nights at the booking's rate, before tax - with or without a room GST
     rule (a new property has none, D22-9; NIGHTS raised there until 29 Sep). */
  it("counts a future stay nothing is charged to at its booked rate, with or without a room GST rate", async () => {
    const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    const { month, arrive } = (await sql(
      `select to_char(d, 'YYYY-MM') as month, d::text as arrive
         from (select date_trunc('month', app.business_date($1) + 45)::date + 9 as d) x`, [hotelId])).rows[0];
    const guest = (await sql("insert into guests (full_name) values ('Leads Future Guest') returning id::text")).rows[0].id;
    await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status, campaign)
       values ($1, 'LVF-' || $2, $3, (select id from room_types where hotel_id = $1 limit 1), $4::date, $4::date + 2, 3000, 'confirmed', 'meta_120002')`,
      [hotelId, process.pid, guest, arrive]);
    const numbers = () => app.request(`/api/hotels/${CODE}/marketing/numbers?month=${month}`, { headers: { "x-dev-staff-id": owner } });

    const future = async () => {
      const res = await numbers();
      expect(res.status, await res.clone().text()).toBe(200);
      const body = await res.json() as { campaigns: { key: string; bookings: number; revenue: string | null }[] };
      return body.campaigns.find((l) => l.key === "meta_120002");
    };
    await sql("delete from tax_rules where hotel_id = $1 and kind = 'room'", [hotelId]);
    expect(await future()).toMatchObject({ bookings: 1, revenue: "6000.00" });
    await sql("insert into tax_rules (hotel_id, kind, over_amount, rate, note) values ($1, 'room', 0, 12, 'test')", [hotelId]);
    expect(await future()).toMatchObject({ bookings: 1, revenue: "6000.00" });
  });

  /* D27-186: Grand Lucent has no campaign list in the app yet. Google
     answers a document that is not there as "missing", inside a call that
     succeeded: that is no campaigns, and no error. A call refused whole
     with 404 is a wrong project or database, and must still be said. */
  it("reads a hotel with no campaign list as no campaigns, not as an error", async () => {
    const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    const numbers = async (month: string) => {
      const res = await app.request(`/api/hotels/${CODE}/marketing/numbers?month=${month}`, { headers: { "x-dev-staff-id": owner } });
      expect(res.status, await res.clone().text()).toBe(200);
      return await res.json() as { connected: boolean; inApp: boolean; appError: string | null; campaigns: unknown[] };
    };
    const kept = other.get(`hotels/${OURS}/marketing/campaigns`)!;
    other.delete(`hotels/${OURS}/marketing/campaigns`);
    try {
      expect(await numbers("2026-07")).toMatchObject({ connected: true, inApp: true, appError: null, campaigns: [] });
      notFound = true;
      expect((await numbers("2026-06")).appError).toContain("did not answer (404)");
    } finally {
      notFound = false;
      other.set(`hotels/${OURS}/marketing/campaigns`, kept);
    }
  });
});

/* ── The keyless login's settings (D27-186) ─────────────────────────── */
describe("the leads app's settings", () => {
  const rest = { M2R_HOTELS: "AMR=amrapali-kolhapur,GLM=grand-lucent-mathura", M2R_DAILY_READS: "5000" };

  it("is connected by the read-only login's email alone, and reads that login's own project", () => {
    const s = settings({ ...rest, M2R_IMPERSONATE: "pms-reader@demo-leads.iam.gserviceaccount.com" });
    expect(s?.projectId).toBe("demo-leads");
    expect(s?.host, "Google itself, no stand-in").toBeNull();
    expect([...s!.hotels]).toEqual([["amrapali-kolhapur", "AMR"], ["grand-lucent-mathura", "GLM"]]);
  });

  it("is not connected with neither a key nor an email, nor with an address that is not a service account's", () => {
    expect(connected(rest)).toBe(false);
    expect(settings(rest)).toBeNull();
    expect(connected({ ...rest, M2R_IMPERSONATE: "somebody@example.com" })).toBe(false);
  });
});
