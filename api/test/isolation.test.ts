import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { pool, withUser, closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ISOLATION — the tests CP7 is actually measured by

   These run against the live local Postgres, as `pms_app`, with RLS
   in force. They are not unit tests with a mocked database: a mock
   would pass while the real thing leaked, which is the failure mode
   worth catching.

   Start the cluster first — `db/tests/run.sh` rebuilds and seeds it.
   ══════════════════════════════════════════════════════════════════ */

let agraStaffId: string;
let ownerStaffId: string;
let puneStaffId: string;
let puneHotelId: string;
let agraHotelId: string;

beforeAll(async () => {
  const staff = await pool.query<{ id: string; email: string }>(
    "select id, email from staff order by email",
  );

  /* Read as the connecting role with no session set. The `staff_self`
     policy is `id = app.current_user_id()`, which is null here — so if
     this returns rows, RLS is NOT in force and every test below would
     pass for the wrong reason. */
  expect(
    staff.rows.length,
    "staff rows readable with no session set - RLS is not in force. " +
      "Check DATABASE_URL connects as pms_app, not postgres.",
  ).toBe(0);

  /* Identify the fixtures out of band, the way the API never does. */
  const admin = new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });
  const ids = await admin.query<{ id: string; email: string }>(
    "select id, email from staff order by email",
  );
  const hotels = await admin.query<{ id: string; code: string }>(
    "select id, code from hotels",
  );
  await admin.end();

  agraStaffId = ids.rows.find((r) => r.email === "agra@fidato.in")!.id;
  ownerStaffId = ids.rows.find((r) => r.email === "owner@fidato.in")!.id;
  puneStaffId = ids.rows.find((r) => r.email === "pune@fidato.in")!.id;
  puneHotelId = hotels.rows.find((r) => r.code === "PUN")!.id;
  agraHotelId = hotels.rows.find((r) => r.code === "AGR")!.id;
});

afterAll(async () => {
  await closePool();
});

interface HotelsBody {
  scope: {
    staffId: string;
    email: string;
    fullName: string;
    isGroupAdmin: boolean;
    hotels: Array<{ hotelId: string; role: string }>;
  };
  hotels: Array<{ id: string; code: string; name: string }>;
}

const asStaff = (id: string, path = "/api/hotels") =>
  app.request(path, { headers: { "x-dev-staff-id": id } });

const bodyOf = async (res: Response) => (await res.json()) as HotelsBody;

describe("withUser", () => {
  it("scopes the setting to the transaction, not the session", async () => {
    /* THE test. `set_config(..., false)` would leave app.user_id on the
       pooled client, and the next caller to receive it would run as the
       previous one. Both calls are forced onto a single connection by
       exhausting the pool to one. */
    const first = await withUser(agraStaffId, async (c) => {
      const { rows } = await c.query("select app.current_user_id() as id");
      return rows[0].id;
    });
    expect(first).toBe(agraStaffId);

    /* Same physical connection, no session set. */
    const leaked = await pool.query<{ id: string | null }>(
      "select app.current_user_id() as id",
    );
    expect(
      leaked.rows[0]?.id,
      "app.user_id survived the transaction - set_config was called with " +
        "is_local=false. The next request on this connection runs as the " +
        "previous clerk.",
    ).toBeNull();
  });

  it("rolls back and re-throws when the body fails", async () => {
    await expect(
      withUser(agraStaffId, async () => {
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    /* The connection is usable afterwards — a transaction left open
       would poison every later borrower of this client. */
    const { rows } = await pool.query<{ ok: number }>("select 1 as ok");
    expect(rows[0]?.ok).toBe(1);
  });
});

describe("GET /api/hotels", () => {
  it("refuses a request with no credentials", async () => {
    const res = await app.request("/api/hotels");
    expect(res.status).toBe(401);
  });

  it("gives the Agra clerk their grants, and only their grants", async () => {
    const res = await asStaff(agraStaffId);
    expect(res.status).toBe(200);

    const body = await bodyOf(res);
    expect(body.scope.email).toBe("agra@fidato.in");
    expect(body.scope.isGroupAdmin).toBe(false);

    /* This asserted `toBe(1)` until the demo property was loaded and
       granted the clerk a second. The number was never the point — it
       was standing in for "however many grants the fixture happens to
       give", which is not a fact about the system.

       What matters: the list is non-empty (staff_hotels was deny-all
       before migration 018, and an empty list is that silent failure),
       and every entry is a grant this person actually holds. */
    expect(
      body.scope.hotels.length,
      "no staff_hotels rows - migration 018 has not been applied",
    ).toBeGreaterThan(0);

    const granted = await withUser(agraStaffId, async (c) => {
      const { rows } = await c.query<{ hotel_id: string }>(
        "select hotel_id from staff_hotels where staff_id = $1",
        [agraStaffId],
      );
      return new Set(rows.map((r) => r.hotel_id));
    });

    expect(new Set(body.scope.hotels.map((h) => h.hotelId))).toEqual(granted);
  });

  it("gives the owner every property, through the policy", async () => {
    const res = await asStaff(ownerStaffId);
    const body = await bodyOf(res);

    expect(body.scope.isGroupAdmin).toBe(true);
    expect(body.hotels.length).toBeGreaterThan(1);

    /* A group admin holds no staff_hotels rows and still reaches
       everything. The empty list must not read as "no properties". */
    expect(body.scope.hotels).toEqual([]);
  });

  it("does not leak one clerk's identity into the next request", async () => {
    /* Sequential requests reuse pooled connections. If the first
       request's session survived, the second would answer as Agra. */
    await asStaff(agraStaffId);
    const res = await asStaff(ownerStaffId);
    const body = await bodyOf(res);
    expect(body.scope.email).toBe("owner@fidato.in");
  });

  it("refuses a subject with no staff record", async () => {
    const res = await asStaff("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });
});

describe("row-level security", () => {
  it("hides another property's reservations from the Agra clerk", async () => {
    const foreign = await withUser(agraStaffId, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n
           from reservations
          where hotel_id = $1`,
        [puneHotelId],
      );
      return Number(rows[0]!.n);
    });
    expect(foreign).toBe(0);
  });

  it("refuses a cross-tenant write", async () => {
    /* The first version of this test selected its source rows FROM the
       other property. RLS hid them, so the INSERT inserted nothing and
       succeeded — a vacuous pass, the exact trap MEMORY.md already
       records. The source rows are now ones the clerk CAN see; only
       the hotel_id being written is foreign.

       So the row count is asserted first. A test that inserts nothing
       can never fail. */
    const sourceRows = await withUser(agraStaffId, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n
           from guests g, room_types rt
          where rt.hotel_id = $1`,
        [agraHotelId],
      );
      return Number(rows[0]!.n);
    });
    expect(sourceRows, "no visible source rows - the insert would be vacuous")
      .toBeGreaterThan(0);

    await expect(
      withUser(agraStaffId, async (c) => {
        await c.query(
          `insert into reservations
             (hotel_id, reference, guest_id, room_type_id,
              check_in, check_out, agreed_rate)
           select $1, 'X-CROSS-TENANT', g.id, rt.id,
                  date '2027-03-01', date '2027-03-02', 3000
             from guests g, room_types rt
            where rt.hotel_id = $2
            limit 1`,
          [puneHotelId, agraHotelId],
        );
      }),
    ).rejects.toThrow();

    /* And nothing landed. A rejection that still wrote would be worse
       than no check at all. */
    const written = await withUser(ownerStaffId, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select count(*)::text as n from reservations where reference = 'X-CROSS-TENANT'",
      );
      return Number(rows[0]!.n);
    });
    expect(written).toBe(0);
  });

  it("lets a clerk read only their own access rows", async () => {
    const rows = await withUser(agraStaffId, async (c) => {
      const { rows } = await c.query<{ staff_id: string }>(
        "select staff_id from staff_hotels",
      );
      return rows;
    });

    /* The count belongs to the fixture; the invariant belongs to the
       policy. Assert the invariant — and that there was something to
       filter, or the check passes on an empty table. */
    expect(rows.length, "no rows at all - nothing was actually filtered")
      .toBeGreaterThan(0);
    expect(rows.every((r) => r.staff_id === agraStaffId)).toBe(true);

    /* And that somebody else's rows exist to have been hidden — read
       as that somebody, because the policy is self-only.

       ⚠ The group ADMIN also reads zero here. `staff_hotels_self` is
         `staff_id = app.current_user_id()` and an admin holds no rows
         of their own, so nobody can see anyone else's access at all.
         That is safe, and it means the Users and Roles admin screens
         cannot show who may reach what. Recorded in HANDOVER.md. */
    const pune = await withUser(puneStaffId, async (c) => {
      const { rows } = await c.query<{ staff_id: string }>(
        "select staff_id from staff_hotels",
      );
      return rows;
    });
    expect(pune.length).toBeGreaterThan(0);
    expect(pune.every((r) => r.staff_id === puneStaffId)).toBe(true);
  });
});

/* 30 September (the rates lane's measurement): a person signs in with a
   Firebase uid, and `app.current_user_id()` took its exception path and a
   staff lookup on EVERY call - once per policy, per query. withUser now
   resolves the uid once, so the rest of the transaction reads a staff id.
   An unknown uid stays as it was given, and is still nobody. */
describe("withUser resolves the person once", () => {
  it("a Firebase uid becomes the staff id for the rest of the transaction", async () => {
    const seen = await withUser("dev-owner", async (client) => {
      const { rows } = await client.query<{ setting: string; me: string | null }>(
        "select current_setting('app.user_id', true) as setting, app.current_user_id()::text as me");
      return rows[0]!;
    });
    expect(seen.me, "dev-owner is a linked dev identity").toBeTruthy();
    expect(seen.setting).toBe(seen.me);
  });

  it("an unknown uid stays as given, and is nobody", async () => {
    const seen = await withUser("nobody-with-this-uid", async (client) => {
      const { rows } = await client.query<{ setting: string; me: string | null }>(
        "select current_setting('app.user_id', true) as setting, app.current_user_id()::text as me");
      return rows[0]!;
    });
    expect(seen.setting).toBe("nobody-with-this-uid");
    expect(seen.me).toBeNull();
  });
});
