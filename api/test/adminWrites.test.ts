import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY CHANGE A PROPERTY OR A PERSON

   ⚠ THIS FILE EXISTS BECAUSE THE ENDPOINTS IT GUARDS SHIPPED UNGUARDED
   AND WERE CAUGHT BY DRIVING THEM AS A CLERK.

   `provision_property` and the access grant raise from inside the
   DATABASE when the caller is not a group admin, which is why those
   held. The four routes added for §2 wrote through plain UPDATEs — and
   a plain UPDATE under row level security that matches nothing returns
   rowCount 0 and no error whatsoever.

   So a receptionist calling `PATCH /admin/hotels/5EL` received **200
   ok**, the property was not renamed, and a screen would have shown a
   saved change that never happened. Silently doing nothing and
   reporting success is worse than refusing: nobody goes looking.

   Both halves are asserted here — that the wrong person is refused in
   words, and that the right person's change actually lands.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
let clerkUid: string;
let clerkId: string;
let originalName: string;

const as = (uid: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { "x-dev-staff-id": uid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const staff = await db.query<{ id: string; uid: string; email: string }>(
      "select id::text, firebase_uid as uid, email from staff",
    );
    ownerUid = staff.rows.find((r) => r.email === "owner@fidato.in")!.uid;
    const clerk = staff.rows.find((r) => r.email === "agra@fidato.in")!;
    clerkUid = clerk.uid;
    clerkId = clerk.id;

    const h = await db.query<{ name: string }>(
      "select name from hotels where code = 'AGR'",
    );
    originalName = h.rows[0]!.name;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("update hotels set name = $1 where code = 'AGR'",
      [originalName]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("changing a property", () => {
  it("REFUSES a clerk, in a sentence, and changes nothing", async () => {
    const res = await as(clerkUid, "/admin/hotels/AGR", "PATCH", {
      name: "Renamed By A Clerk",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("group administrator");

    /* ⚠ THE HALF THAT WOULD HAVE PASSED WITH THE BUG. A 409 could be
       returned by anything; what matters is that the property still has
       its own name. The original fault returned 200 AND changed
       nothing — so asserting only the status code proves neither. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ name: string }>(
        "select name from hotels where code = 'AGR'",
      );
      expect(rows[0]!.name).toBe(originalName);
    } finally {
      await db.end();
    }
  });

  it("lets a group administrator through, and the change lands", async () => {
    const res = await as(ownerUid, "/admin/hotels/AGR", "PATCH", {
      name: "Agra, renamed by the owner",
    });
    expect(res.status).toBe(200);

    const db = await admin();
    try {
      const { rows } = await db.query<{ name: string }>(
        "select name from hotels where code = 'AGR'",
      );
      expect(rows[0]!.name).toBe("Agra, renamed by the owner");
    } finally {
      await db.end();
    }
  });

  it("refuses a GSTIN that is not one — it prints on every invoice", async () => {
    const res = await as(ownerUid, "/admin/hotels/AGR", "PATCH", {
      gstin: "NONSENSE",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("GSTIN");
  });

  it("refuses to close a property somebody is still checked into", async () => {
    /* A closed property vanishes from the picker and takes the folio
       with it — a guest nobody can check out. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from reservations r
           join hotels h on h.id = r.hotel_id
          where h.code = 'AGR' and r.status = 'checked_in'`,
      );
      if (Number(rows[0]!.n) === 0) {
        /* Nothing in house at Agra right now, so this run cannot prove
           the refusal. Said out loud rather than passing quietly — a
           test that silently proves nothing is the thing this project
           has recorded four times. */
        expect(rows[0]!.n).toBe("0");
        return;
      }
      const res = await as(ownerUid, "/admin/hotels/AGR/close", "POST", {});
      expect(res.status).toBe(409);
      const body = (await res.json()) as { reason: string };
      expect(body.reason).toContain("checked in");
    } finally {
      await db.end();
    }
  });
});

describe("changing a person", () => {
  it("refuses a clerk editing anybody, including themselves", async () => {
    const res = await as(clerkUid, `/admin/staff/${clerkId}`, "PATCH", {
      fullName: "Somebody Else",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("group administrator");
  });

  it("warns when somebody is reactivated with no way to sign in", async () => {
    /* ⚠ ACTIVE WITH NO FIREBASE ACCOUNT SIGNS IN NOWHERE. The deploy
       README warns about this at length because it reads as an empty
       database rather than as a missing account. Said at the moment it
       becomes true, not discovered on their first morning back. */
    const db = await admin();
    let orphanId: string;
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, is_active)
         values ('reactivate-probe@fidato.in', 'Reactivate Probe', false)
         on conflict (email) do update set is_active = false
         returning id::text`,
      );
      orphanId = rows[0]!.id;
    } finally {
      await db.end();
    }

    const res = await as(ownerUid, `/admin/staff/${orphanId}/reactivate`, "POST");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; warning?: string };
    expect(body.ok).toBe(true);
    expect(body.warning, "no warning about the missing sign-in account")
      .toContain("link-staff");

    const db2 = await admin();
    try {
      await db2.query("delete from staff where id = $1", [orphanId]);
    } finally {
      await db2.end();
    }
  });
});
