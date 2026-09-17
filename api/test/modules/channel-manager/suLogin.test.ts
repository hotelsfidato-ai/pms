import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { readSuSettings, SU_HOSTS, type SuSettings } from "../../../src/modules/channel-manager/su/config.ts";
import {
  SuTokenHolder, TOKEN_ENDPOINT, TOKENS_PER_HOUR, RETRY_AFTER_FAILURE_MS,
} from "../../../src/modules/channel-manager/su/token.ts";
import { SuClient } from "../../../src/modules/channel-manager/su/client.ts";
import { useTransportForTests } from "../../../src/modules/channel-manager/su/runtime.ts";
import {
  TOKEN_SANDBOX, TOKEN_LIVE, AUTHORIZATION_REQUIRED, LIMIT_REACHED, ARI_SUCCESS,
  PRICE_REFUSED, scriptedSu, ok200,
} from "./suExamples.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 1 OF THE SU CONNECTION — THE LOGIN (D17-66)

   What must hold, in the order it would hurt:
   1. The secret and the token never reach an answer, a message or a
      screen — including when SU's own message would carry them.
   2. The secret is only ever sent to one of SU's two hosts.
   3. A token is reused, renewed before it lapses, and SU's 30 an hour
      are never spent by a loop.
   4. A test key cannot push to the live account, or the reverse.
   5. Only the owner reaches it (the `integration` grant is the owner's).

   SU itself is stood in for by the answers SU's documents give
   (./suExamples.ts). No test here reaches the internet.
   ══════════════════════════════════════════════════════════════════ */

const SECRET = "test-secret-DO-NOT-SHOW";
const CLIENT = "test-client-id";
const sandbox: SuSettings = {
  environment: "sandbox", baseUrl: SU_HOSTS.sandbox, clientId: CLIENT, clientSecret: SECRET,
};

const clock = (start = Date.UTC(2026, 8, 17, 10, 0, 0)) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe("SU settings", () => {
  it("names every missing setting and does not guess any", () => {
    const r = readSuSettings({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"]);
    expect(r.reason).not.toContain("—");
  });

  it("takes the host from SU's two, never from the settings", () => {
    const r = readSuSettings({
      SU_ENVIRONMENT: "sandbox", SU_CLIENT_ID: CLIENT, SU_CLIENT_SECRET: SECRET,
      SU_BASE_URL: "https://evil.example.com",
    });
    expect(r.ok && r.settings.baseUrl).toBe("https://connect-sandbox.su-api.com");
    const live = readSuSettings({ SU_ENVIRONMENT: "LIVE", SU_CLIENT_ID: CLIENT, SU_CLIENT_SECRET: SECRET });
    expect(live.ok && live.settings.baseUrl).toBe("https://connect.su-api.com");
  });

  it("refuses an environment that is neither test nor live, without echoing it", () => {
    const r = readSuSettings({ SU_ENVIRONMENT: "https://evil.example.com", SU_CLIENT_ID: CLIENT, SU_CLIENT_SECRET: SECRET });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("evil");
  });
});

describe("SU's token", () => {
  it("logs in with the client id and secret as SU documents, at SU's host", async () => {
    const su = scriptedSu(ok200(TOKEN_SANDBOX));
    const t = clock();
    const holder = new SuTokenHolder(sandbox, su.transport, t.now);
    const got = await holder.get();
    expect(got.ok).toBe(true);
    expect(su.sent).toHaveLength(1);
    expect(su.sent[0]!.method).toBe("GET");
    expect(su.sent[0]!.url).toBe("https://connect-sandbox.su-api.com" + TOKEN_ENDPOINT);
    expect(su.sent[0]!.headers).toEqual({ "client-id": CLIENT, "client-secret": SECRET });
  });

  it("reuses the token, and renews it five minutes before its hour is up", async () => {
    const su = scriptedSu(ok200(TOKEN_SANDBOX));
    const t = clock();
    const holder = new SuTokenHolder(sandbox, su.transport, t.now);
    await holder.get();
    t.advance(54 * 60_000);
    await holder.get();
    expect(su.sent).toHaveLength(1);
    t.advance(2 * 60_000); // 56 minutes in: inside the last five
    await holder.get();
    expect(su.sent).toHaveLength(2);
  });

  it("asks SU once however many callers want a token at the same moment", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const su = scriptedSu(async () => { await gate; return ok200(TOKEN_SANDBOX); });
    const holder = new SuTokenHolder(sandbox, su.transport);
    const all = Promise.all([holder.get(), holder.get(), holder.get()]);
    release();
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(su.sent).toHaveLength(1);
  });

  it("refuses a live token from test keys: the keys and SU_ENVIRONMENT disagree", async () => {
    const su = scriptedSu(ok200(TOKEN_LIVE));
    const holder = new SuTokenHolder(sandbox, su.transport);
    const got = await holder.get();
    expect(got.ok).toBe(false);
    expect(JSON.stringify(got)).not.toContain("live_eyJ");
  });

  it("never lets a secret SU echoed reach the message, and waits a minute before asking again", async () => {
    const su = scriptedSu(ok200({
      Status: "Fail", Errors: [{ Code: "401", ShortText: `Invalid client-secret ${SECRET} for ${CLIENT}` }],
    }));
    const t = clock();
    const holder = new SuTokenHolder(sandbox, su.transport, t.now);
    const first = await holder.get();
    expect(first.ok).toBe(false);
    expect(JSON.stringify(first)).not.toContain(SECRET);
    expect(JSON.stringify(first)).not.toContain(CLIENT);
    expect(!first.ok && first.reason).toContain("SU refused the login");

    await holder.get();
    expect(su.sent).toHaveLength(1);
    t.advance(RETRY_AFTER_FAILURE_MS);
    await holder.get();
    expect(su.sent).toHaveLength(2);
  });

  it("stops at SU's 30 logins an hour instead of spending the 31st", async () => {
    /* A token that lasts one second, so every get asks for a new one. */
    const su = scriptedSu(ok200({ ...TOKEN_SANDBOX, Data: { ...TOKEN_SANDBOX.Data, expire_in: "1" } }));
    const t = clock();
    const holder = new SuTokenHolder(sandbox, su.transport, t.now);
    for (let i = 0; i < TOKENS_PER_HOUR; i += 1) {
      expect((await holder.get()).ok).toBe(true);
      t.advance(60_000);
    }
    const refused = await holder.get();
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.kind).toBe("limit");
    expect(su.sent).toHaveLength(TOKENS_PER_HOUR);
    expect(holder.usedThisHour()).toBe(TOKENS_PER_HOUR);
  });

  it("says SU could not be reached, with nothing of the keys in it", async () => {
    const su = scriptedSu(Object.assign(new Error(`connect ECONNREFUSED ${SECRET}`), { name: "TypeError" }));
    const holder = new SuTokenHolder(sandbox, su.transport);
    const got = await holder.get();
    expect(!got.ok && got.kind).toBe("unreachable");
    expect(JSON.stringify(got)).not.toContain(SECRET);
  });
});

describe("a call to SU", () => {
  const make = (...answers: Parameters<typeof scriptedSu>) => {
    const su = scriptedSu(...answers);
    const tokens = new SuTokenHolder(sandbox, su.transport);
    return { su, client: new SuClient(sandbox, su.transport, tokens) };
  };

  it("is signed with the token as a Bearer header and sent as JSON", async () => {
    const { su, client } = make(ok200(TOKEN_SANDBOX), ok200(ARI_SUCCESS));
    const r = await client.post("/SUAPI/jservice/availability", { hotelid: "5EL" });
    expect(r.ok).toBe(true);
    const call = su.sent[1]!;
    expect(call.headers["authorization"]).toBe(`Bearer ${TOKEN_SANDBOX.Data.token}`);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call.body!)).toEqual({ hotelid: "5EL" });
    expect(call.headers).not.toHaveProperty("client-secret");
  });

  it("reads SU's refusal from a 200 answer, not from the status code", async () => {
    const { client } = make(ok200(TOKEN_SANDBOX), ok200(PRICE_REFUSED));
    const r = await client.post("/SUAPI/jservice/availability", {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.kind).toBe("refused");
    expect(!r.ok && r.code).toBe("873");
  });

  it("logs in again once when SU says Authorization Required, and not a second time", async () => {
    const { su, client } = make(
      ok200(TOKEN_SANDBOX), ok200(AUTHORIZATION_REQUIRED),
      ok200(TOKEN_SANDBOX), ok200(ARI_SUCCESS),
    );
    const r = await client.post("/SUAPI/jservice/availability", {});
    expect(r.ok).toBe(true);
    expect(su.sent.map((s) => s.url.endsWith(TOKEN_ENDPOINT))).toEqual([true, false, true, false]);

    const twice = make(
      ok200(TOKEN_SANDBOX), ok200(AUTHORIZATION_REQUIRED),
      ok200(TOKEN_SANDBOX), ok200(AUTHORIZATION_REQUIRED),
    );
    const r2 = await twice.client.post("/SUAPI/jservice/availability", {});
    expect(!r2.ok && r2.kind).toBe("login");
    expect(twice.su.sent).toHaveLength(4);
  });

  it("names SU's hourly cap as a limit to wait out", async () => {
    const { client } = make(ok200(TOKEN_SANDBOX), ok200(LIMIT_REACHED));
    const r = await client.post("/SUAPI/jservice/availability", {});
    expect(!r.ok && r.kind).toBe("limit");
  });
});

/* ── The two routes ──────────────────────────────────────────────── */

let ownerId: string;
let gmId: string;
let clerkId: string;
const SU_NAMES = ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"] as const;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const { rows: owner } = await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'");
    ownerId = owner[0]!.id;
    const mk = async (email: string, role: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true returning id::text`,
        [email, `CMTEST ${role}`, `test-uid-${email.replace(/\W/g, "")}`]);
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         select $1, id, $2 from hotels where code = '5EL'
         on conflict (staff_id, hotel_id) do update set role = excluded.role`,
        [rows[0]!.id, role]);
      return rows[0]!.id;
    };
    gmId = await mk("cm-gm@fidato.in", "gm");
    clerkId = await mk("cm-clerk@fidato.in", "front_desk");
  } finally { await db.end(); }
});

afterEach(() => {
  for (const n of SU_NAMES) delete process.env[n];
  useTransportForTests(null);
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from staff_hotels where staff_id = any($1)", [[gmId, clerkId]]);
    await db.query("update staff set is_active = false where id = any($1)", [[gmId, clerkId]]);
  } finally { await db.end(); }
  await closePool();
});

const as = (staffId: string, path: string, method = "GET") =>
  app.request(path, { method, headers: { "x-dev-staff-id": staffId } });

describe("GET and POST /api/channel-manager/su", () => {
  it("is refused to a GM and to reception, by the server and not only the screen", async () => {
    for (const who of [gmId, clerkId]) {
      const get = await as(who, "/api/channel-manager/su");
      expect(get.status).toBe(403);
      const post = await as(who, "/api/channel-manager/su/login", "POST");
      expect(post.status).toBe(403);
    }
  });

  it("tells the owner SU is not set up, naming what is missing", async () => {
    const res = await as(ownerId, "/api/channel-manager/su");
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean; missing: string[] };
    expect(body.configured).toBe(false);
    expect(body.missing).toEqual([...SU_NAMES]);

    const login = await as(ownerId, "/api/channel-manager/su/login", "POST");
    expect(login.status).toBe(409);
  });

  it("logs in for the owner and answers without the token, the id or the secret", async () => {
    process.env["SU_ENVIRONMENT"] = "sandbox";
    process.env["SU_CLIENT_ID"] = CLIENT;
    process.env["SU_CLIENT_SECRET"] = SECRET;
    const su = scriptedSu(ok200(TOKEN_SANDBOX));
    useTransportForTests(su.transport);

    const res = await as(ownerId, "/api/channel-manager/su/login", "POST");
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, environment: "sandbox", loginsThisHour: 1 });
    for (const hidden of [SECRET, CLIENT, TOKEN_SANDBOX.Data.token]) expect(text).not.toContain(hidden);

    const status = await (await as(ownerId, "/api/channel-manager/su")).text();
    expect(JSON.parse(status)).toMatchObject({ configured: true, environment: "sandbox" });
    expect(JSON.parse(status).lastLogin.ok).toBe(true);
    for (const hidden of [SECRET, CLIENT, TOKEN_SANDBOX.Data.token]) expect(status).not.toContain(hidden);
  });

  it("reports a refused login as SU's refusal, still without the keys", async () => {
    process.env["SU_ENVIRONMENT"] = "sandbox";
    process.env["SU_CLIENT_ID"] = CLIENT;
    process.env["SU_CLIENT_SECRET"] = SECRET;
    useTransportForTests(scriptedSu(ok200(AUTHORIZATION_REQUIRED)).transport);

    const res = await as(ownerId, "/api/channel-manager/su/login", "POST");
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text).reason).toContain("Authorization Required");
    expect(text).not.toContain(SECRET);
  });
});
