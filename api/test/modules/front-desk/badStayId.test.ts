import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* A stay id that is not an id answers "No such stay.", never a 500
   (30 September, the booking and bill lane: GET /stays/:bad-id/inclusions). */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";

beforeAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  } finally { await db.end(); }
});
afterAll(closePool);

describe("a stay's inclusions, asked with a bad id", () => {
  for (const [method, path] of [
    ["GET", "/stays/not-a-uuid/inclusions"],
    ["POST", "/stays/not-a-uuid/inclusions"],
    ["DELETE", "/stays/not-a-uuid/inclusions/x"],
  ] as const) {
    it(`${method} is no such stay`, async () => {
      const res = await app.request(`/api/hotels/5EL${path}`, {
        method,
        headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ name: "Breakfast" }) } : {}),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "No such stay." });
    });
  }
});
