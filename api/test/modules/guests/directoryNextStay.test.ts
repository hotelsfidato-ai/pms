import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S NEXT STAY IS NOT A VOIDED BOOKING (the owner's D27-326 (1))

   The guest directory's "back on ..." left out a cancelled booking and let a
   voided one through, so a booking entered twice and voided still said the
   guest was coming back. Void is left out as cancelled is. Run at 5EL, a
   year ahead, with two guests of this file's own.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const tag = `NXT-${process.pid}`;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let ahead = "";

/** A guest of this file with one booking a year ahead, in `status`. */
async function guestWith(who: string, status: "confirmed" | "void" | "cancelled") {
  await sql(
    `with g as (insert into guests (full_name) values ($1) returning id),
          h as (select id, app.business_date(id) + 365 as d from hotels where code = '5EL'),
          o as (select id from staff where email = 'owner@fidato.in')
     insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, void_reason, voided_by, voided_at)
     select h.id, $2, g.id,
            (select id from room_types where hotel_id = h.id order by code limit 1),
            h.d, h.d + 2, 2000, $3,
            case when $3 = 'void' then 'Entered twice' end,
            case when $3 = 'void' then o.id end,
            case when $3 = 'void' then now() end
       from g, h, o`,
    [`${tag} ${who}`, `${tag}-${who}`, status]);
}

const nextStay = async (who: string) => {
  const res = await app.request("/api/hotels/5EL/guests", { headers: { "x-dev-staff-id": "dev-owner" } });
  expect(res.status).toBe(200);
  const rows = (await res.json()) as Array<{ name: string; nextStay: string | null }>;
  const row = rows.find((r) => r.name === `${tag} ${who}`);
  expect(row, `${who} is in the directory`).toBeTruthy();
  return row!.nextStay;
};

beforeAll(async () => {
  ahead = (await sql<{ d: string }>(
    "select (app.business_date(id) + 365)::text as d from hotels where code = '5EL'"))[0]!.d;
  await guestWith("coming", "confirmed");
  await guestWith("voided", "void");
  await guestWith("cancelled", "cancelled");
});

afterAll(async () => {
  await sql("delete from reservations where reference like $1", [`${tag}-%`]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [`${tag} %`]);
    await db.query("alter table guests enable trigger guests_no_delete");
  } finally { await db.end(); }
  await closePool();
});

describe("a guest's next stay in the directory", () => {
  it("is a confirmed booking ahead", async () => {
    expect(await nextStay("coming")).toBe(ahead);
  });

  it("is never a cancelled one, nor a voided one", async () => {
    expect(await nextStay("cancelled")).toBeNull();
    expect(await nextStay("voided")).toBeNull();
  });
});
