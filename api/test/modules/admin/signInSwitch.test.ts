import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/* ══════════════════════════════════════════════════════════════════
   DEACTIVATING SWITCHES OFF SIGN-IN (the owner's D27-275 part 4)

   Deactivate wrote staff.is_active and stopped: the Firebase account still
   signed in. Now it is disabled too, and Reactivate enables it. The
   database goes first: a Firebase failure leaves the person as the
   database has them, and the answer says the sign-in did not follow.
   This suite has no Firebase, so a stand-in answers and the server is told
   it has a service account (as lastSeen.test.ts). Without one (every other
   suite here) the switch is skipped and the request still answers 200
   (propertyAdmin.test.ts).
   ══════════════════════════════════════════════════════════════════ */

process.env["FIREBASE_SERVICE_ACCOUNT"] = "{}";

const firebase = vi.hoisted(() => ({
  calls: [] as Array<{ uid: string; disabled: unknown }>,
  fails: false,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    updateUser: async (uid: string, change: { disabled?: boolean }) => {
      if (firebase.fails) throw new Error("Firebase did not answer");
      firebase.calls.push({ uid, disabled: change.disabled });
      return { uid };
    },
    createUser: async () => {
      throw Object.assign(new Error("exists"), { code: "auth/email-already-exists" });
    },
    getUserByEmail: async () => ({ uid: "test-uid-d275-adopted" }),
  }),
}));
vi.mock("../../../src/auth.ts", async (original) => ({
  ...(await original<typeof import("../../../src/auth.ts")>()),
  firebaseApp: () => ({}),
}));

const { app } = await import("../../../src/server.ts");
const { closePool } = await import("../../../src/db.ts");
const { ensureAccount } = await import("../../../src/identity.ts");

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const UID = "test-uid-d275-person";
let ownerId: string;
let personId: string;

const act = (what: "deactivate" | "reactivate") =>
  app.request(`/api/admin/staff/${personId}/${what}`, {
    method: "POST",
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    body: "{}",
  });
const active = async () =>
  (await sql("select is_active from staff where id = $1", [personId])).rows[0].is_active as boolean;

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  personId = (await sql(
    `insert into staff (email, full_name, firebase_uid) values ('d275-signin@fidato.in', 'D275 Sign In', $1)
     on conflict (email) do update set is_active = true returning id::text`, [UID])).rows[0].id;
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'front_desk' from hotels where code = 'AGR'
     on conflict do nothing`, [personId]);
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = $1", [personId]);
  await sql("update staff set is_active = false where id = $1", [personId]);
  await closePool();
});

describe("deactivating and reactivating a person", () => {
  it("switches their sign-in off, and back on", async () => {
    firebase.calls = [];
    const off = await act("deactivate");
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await active()).toBe(false);
    expect(firebase.calls).toEqual([{ uid: UID, disabled: true }]);

    const on = await act("reactivate");
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await active()).toBe(true);
    expect(firebase.calls).toEqual([{ uid: UID, disabled: true }, { uid: UID, disabled: false }]);
  });

  it("keeps them deactivated when Firebase fails, and says the sign-in is still on", async () => {
    firebase.fails = true;
    try {
      const off = await act("deactivate");
      expect(off.status, await off.clone().text()).toBe(200);
      const body = (await off.json()) as { ok: boolean; warning?: string };
      expect(body.ok).toBe(true);
      expect(body.warning).toMatch(/sign-in could not be switched off/);
      expect(await active(), "the database must not follow Firebase back").toBe(false);

      const on = await act("reactivate");
      expect(((await on.json()) as { warning?: string }).warning).toMatch(/sign-in could not be switched back on/);
      expect(await active()).toBe(true);
    } finally {
      firebase.fails = false;
    }
  });

  it("switches a re-added person's sign-in back on (the Add person form adopts the account)", async () => {
    firebase.calls = [];
    const { uid } = await ensureAccount("d275-readded@fidato.in", "D275 Readded");
    expect(firebase.calls).toEqual([{ uid, disabled: false }]);
  });
});
