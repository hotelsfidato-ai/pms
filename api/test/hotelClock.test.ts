import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { openTillDay } from "./drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   EVERY CLOCK TIME ON THE HOTEL'S CLOCK (MEMORY 297, 428)

   The hotel's server keeps its database in GMT; this database runs in UTC
   to ask the same question (scripts/with-test-db.sh). On 25 October the
   KOTs at Amrapali printed 18:21 for 23:51: the KOT's time, and about 40
   other times a person reads, were formatted with no zone. A time shown
   to a person goes through app.hotel_clock - read back here from a KOT,
   and held for all the code by reading the source.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CLOCKT";
let waiter = "";
let orderId = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : { method: "POST", headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body) });

beforeAll(async () => {
  const [s] = await sql<{ id: string }>(
    `insert into staff (email, full_name) values ('clock-waiter@fidato.in', 'CLOCKT Waiter')
     on conflict (email) do update set is_active = true returning id::text`);
  waiter = s!.id;
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'pos' from hotels where code = '5EL'
     on conflict (staff_id, hotel_id) do update set role = excluded.role`, [waiter]);
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = $1", [waiter]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("a clock time is the hotel's (MEMORY 428)", () => {
  it("the KOT prints the hotel's time, not the server's GMT", async () => {
    expect((await sql<{ tz: string }>("select current_setting('timezone') as tz"))[0]!.tz, "this database asks as the server does").toBe("UTC");
    const menu = (await (await call(waiter, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
    const tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
    const opened = await call(waiter, "/till/orders/batch", { outlet: "REST", table: `${TAG} 1`, lines: [{ itemId: tikka, qty: 1 }], send: true });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const sent = (await opened.json()) as { id: string; kotNo: number };
    orderId = sent.id;
    /* 18:21 GMT on 24 October is 23:51 in Akkalkot. */
    await sql("update pos_order_lines set kot_sent_at = '2026-10-24 18:21:00+00' where order_id = $1", [orderId]);
    const kot = await call(waiter, `/till/orders/${orderId}/kot/${sent.kotNo}`);
    expect(kot.status, await kot.clone().text()).toBe(200);
    expect(((await kot.json()) as { sentAt: string }).sentAt).toBe("24/10/26 23:51");
  });

  it("no code formats a clock time without the hotel's zone", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    /* A time of day kept as a time (a check-in hour), or a moment printed
       with its own offset (OF), carries no zone to lose. */
    const timeOfDay = /check_in_time|check_out_time|night_audit_opens_at|expected_arrival/;
    const bare: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!/to_char\(/.test(line) || !/HH24|HH12/.test(line)) return;
        if (/at time zone|hotel_clock|OF'/.test(line) || timeOfDay.test(line)) return;
        bare.push(`${relative(root, f)}:${i + 1}`);
      });
    }
    expect(bare, "a time shown to a person goes through app.hotel_clock(hotel, moment, format)").toEqual([]);
  });
});
