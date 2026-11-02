import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

/* ══════════════════════════════════════════════════════════════════
   GOOGLE IS ASKED ONCE A MINUTE (the owner's D27-387, the load test)

   Every request waited about 280 ms for Google. The token is checked
   here each time; whether it was revoked is asked at most once a minute.
   What must not change: a cancelled sign-in stops within the minute, and
   a person removed in the PMS stops at once. This suite has no Firebase,
   so a stand-in answers (as signInSwitch.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const google = vi.hoisted(() => ({ local: 0, asked: 0, revoked: false }));

vi.mock("firebase-admin/app", () => ({
  cert: () => ({}), initializeApp: () => ({}), getApps: () => [{}],
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string, checkRevoked?: boolean) => {
      if (checkRevoked) {
        google.asked += 1;
        if (google.revoked) throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" });
      } else {
        google.local += 1;
      }
      /* "<uid>|<iat>": a token of its own for each device. */
      const [uid, iat] = token.split("|");
      return { uid, iat: Number(iat), auth_time: 1_790_000_000 };
    },
  }),
}));

process.env["FIREBASE_SERVICE_ACCOUNT"] = "{}";
const { app } = await import("../src/server.ts");
const { closePool } = await import("../src/db.ts");

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const UID = "test-uid-google-minute";
const ask = async (token: string) =>
  (await app.request("/api/hotels", { headers: { authorization: `Bearer ${token}` } })).status;

beforeAll(async () => {
  await sql(
    `insert into staff (email, full_name, firebase_uid) values ('google-minute@fidato.in', 'GOOGLETEST', $1)
     on conflict (email) do update set is_active = true`, [UID]);
});

afterEach(() => {
  vi.useRealTimers();
  google.revoked = false;
});

afterAll(async () => {
  await sql("update staff set is_active = false where firebase_uid = $1", [UID]);
  await closePool();
});

describe("the check with Google", () => {
  it("is made once a minute, while the token is checked on every request", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_800_000_000_000 });
    google.local = google.asked = 0;
    expect(await ask(`${UID}|1`)).toBe(200);
    expect(await ask(`${UID}|1`)).toBe(200);
    expect(await ask(`${UID}|1`)).toBe(200);
    expect(google).toMatchObject({ local: 3, asked: 1 });

    vi.setSystemTime(1_800_000_000_000 + 59_000);
    expect(await ask(`${UID}|1`)).toBe(200);
    expect(google.asked).toBe(1);

    vi.setSystemTime(1_800_000_000_000 + 60_000);
    expect(await ask(`${UID}|1`)).toBe(200);
    expect(google.asked).toBe(2);
  });

  it("stops a cancelled sign-in within the minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_810_000_000_000 });
    expect(await ask(`${UID}|2`)).toBe(200);
    google.revoked = true;
    expect(await ask(`${UID}|2`), "inside the minute").toBe(200);
    vi.setSystemTime(1_810_000_000_000 + 60_000);
    expect(await ask(`${UID}|2`), "the minute is up").toBe(401);
  });

  it("asks for each device: a good one does not carry a cancelled one", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_820_000_000_000 });
    expect(await ask(`${UID}|3`)).toBe(200);
    google.revoked = true;
    expect(await ask(`${UID}|4`), "another token is asked for itself").toBe(401);
  });

  it("refuses when Google cannot be asked, as it did before", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_830_000_000_000 });
    google.revoked = true;
    expect(await ask(`${UID}|5`)).toBe(401);
  });

  it("does not delay removing somebody in the PMS: that acts at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_840_000_000_000 });
    expect(await ask(`${UID}|6`)).toBe(200);
    const asked = google.asked;
    await sql("update staff set is_active = false where firebase_uid = $1", [UID]);
    try {
      expect(await ask(`${UID}|6`)).toBe(401);
      expect(google.asked, "inside the minute, Google was not asked").toBe(asked);
    } finally {
      await sql("update staff set is_active = true where firebase_uid = $1", [UID]);
    }
  });
});
