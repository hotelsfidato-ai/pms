import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import {
  ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, canAccess,
} from "../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ROLE LISTS ARE ONE LIST

   ⚠ THIS TEST EXISTS BECAUSE THEY WERE TWO, AND THEY HAD DRIFTED.

   `src/lib/permissions.ts` offered owner, admin, manager, front_desk,
   housekeeping, finance and viewer. `staff_hotels_role_valid` allowed
   owner, gm, front_desk, housekeeping, pos, stores, finance and
   read_only. Three of the roles on the admin screen — Admin, Manager
   and Viewer — were in no version of the constraint, so assigning any
   of them returned a 500 saying "Something went wrong."

   Nobody found it because Akkalkot has one staff row carrying a role
   and it happens to be `front_desk`. It would have been found by the
   first person hired into any other job.

   The lists are identical now, and the ONLY thing that keeps them that
   way is this file. A role added to the database and not to the matrix
   grants nothing; a role added to the matrix and not the database
   cannot be assigned. Both fail here instead.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

let dbRoles: string[];
let ownerUid: string;

beforeAll(async () => {
  const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    const { rows } = await pool.query<{ roles: string[] }>(
      "select app.assignable_roles() as roles",
    );
    dbRoles = rows[0]!.roles;

    const staff = await pool.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    );
    ownerUid = staff.rows[0]!.uid;
  } finally {
    await pool.end();
  }
});

afterAll(async () => {
  await closePool();
});

describe("the roles", () => {
  it("are the SAME list in the database and the interface", () => {
    /* Sorted and compared as sets — the order of a picker is a
       presentation choice, the membership is not. */
    expect([...ASSIGNABLE_ROLES].sort()).toEqual([...dbRoles].sort());
  });

  it("every role the database allows can actually be assigned", async () => {
    /* ⚠ THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL FAULT. Not "the
       lists match" — the lists could match and the endpoint could still
       reject. This drives the real endpoint, once per role. */
    const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
    let target: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        "select id::text from staff where email = 'pune@fidato.in'",
      );
      target = rows[0]!.id;
    } finally {
      await pool.end();
    }

    const failures: string[] = [];
    for (const role of dbRoles) {
      const res = await app.request(`/api/admin/staff/${target}/access`, {
        method: "POST",
        headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
        body: JSON.stringify({ code: "AGR", role }),
      });
      if (res.status !== 200) failures.push(`${role} → ${res.status}`);
    }

    await app.request(`/api/admin/staff/${target}/access/AGR`, {
      method: "DELETE",
      headers: { "x-dev-staff-id": ownerUid },
    });

    expect(failures, failures.join(", ")).toHaveLength(0);
  });

  it("refuses an unknown role in a sentence, not a 500", async () => {
    const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
    let target: string;
    try {
      const { rows } = await pool.query<{ id: string }>(
        "select id::text from staff where email = 'pune@fidato.in'",
      );
      target = rows[0]!.id;
    } finally {
      await pool.end();
    }

    const res = await app.request(`/api/admin/staff/${target}/access`, {
      method: "POST",
      headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
      body: JSON.stringify({ code: "AGR", role: "wizard" }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    /* It NAMES what is allowed. A refusal that does not say what would
       have worked leaves somebody guessing. */
    expect(body.reason).toContain("wizard");
    expect(body.reason).toContain("front_desk");
  });

  it("every assignable role has a label, a description and a matrix entry", () => {
    /* A role in the list with no matrix entry grants NOTHING — somebody
       is hired, assigned it, signs in, and the product is empty with no
       error anywhere. That is the shape of half the defects in this
       project's history. */
    for (const role of ASSIGNABLE_ROLES) {
      expect(ROLE_LABELS[role], `${role} has no label`).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role], `${role} has no description`).toBeTruthy();
      /* Asked through `canAccess`, which is what every screen calls.
         A role with no matrix entry answers false to everything: the
         person signs in and the product is empty, with no error
         anywhere. Every role must reach at least the dashboard. */
      expect(canAccess(role, "dashboard"), `${role} cannot see anything`)
        .toBe(true);
    }
  });

  it("labels are the words staff use, not the stored identifiers", () => {
    /* The owner asked for their own vocabulary. The stored value stays
       an identifier because twenty places reference it; the label is
       what a person reads. */
    expect(ROLE_LABELS["front_desk"]).toBe("Reception");
    expect(ROLE_LABELS["finance"]).toBe("Accountant");
    expect(ROLE_LABELS["gm"]).toBe("General Manager");
    expect(ROLE_LABELS["stores"]).toBe("Store Manager");
  });
});
