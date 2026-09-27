import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES, whoMay } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP'S LOGO (the owner's D27-53, 27 September)

   One logo for the whole group, printed on every bill. Changed by the
   owner, an administrator or the GM (the owner's answer, 27 September);
   read by everybody who prints a bill. A PNG or an SVG by its CONTENT,
   200 KB at most, and never an SVG that carries a script. Every refusal
   leaves what was there. The database's own guard, without this route in
   front of it, is db/tests/modules/admin.sql ("the group's logo").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "LOGOTEST";
const people: Record<"gm" | "desk" | "nowhere", string> = { gm: "", desk: "", nowhere: "" };

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, body?: unknown) =>
  app.request("/api/hotels/5EL/group-logo", {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const upload = (who: string, bytes: Buffer) => call(who, "PUT", { data: bytes.toString("base64") });
const stored = async () =>
  (await sql<{ image_type: string; image: Buffer }>("select image_type, image from group_logo"))[0] ?? null;
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("a tiny picture"),
]);
const SVG = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<rect width="10" height="10" fill="#FE611F"/></svg>\n');

beforeAll(async () => {
  await sql("delete from group_logo");
  for (const [who, role] of [["gm", "gm"], ["desk", "front_desk"], ["nowhere", null]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`logo-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    if (role) {
      await sql(
        "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
        [row!.id, role]);
    }
  }
});

afterAll(async () => {
  await sql("delete from group_logo");
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("the group's logo", () => {
  it("is changed by exactly the owner, an administrator and the GM (the owner, 27 September)", () => {
    for (const method of ["PUT", "DELETE"]) {
      expect(whoMay(WRITE_RULES[`${method} /api/hotels/:code/group-logo`]!)).toEqual(["owner", "admin", "gm"]);
    }
  });

  it("is none to begin with: a new copy prints the hotel's name", async () => {
    const res = await call(people.desk, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logo: null });
  });

  it("is refused to reception, in the gate's words, and nothing is written", async () => {
    const res = await upload(people.desk, PNG);
    expect(res.status).toBe(403);
    expect(await reason(res)).toBe(
      "Changing the group's logo is for the owner, an administrator or the general manager. "
      + "Ask one of them.");
    expect(await stored()).toBeNull();
  });

  it("is refused to somebody rostered nowhere, as no such property, and nothing is written", async () => {
    expect((await upload(people.nowhere, PNG)).status).toBe(404);
    expect((await call(people.nowhere, "GET")).status).toBe(404);
    expect(await stored()).toBeNull();
  });

  it("takes a PNG from the GM, and reception reads it back as it was sent", async () => {
    const res = await upload(people.gm, PNG);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toEqual({ image_type: "image/png", image: PNG });
    const read = await call(people.desk, "GET");
    expect(await read.json()).toEqual({ logo: { type: "image/png", data: PNG.toString("base64") } });
  });

  it.each([
    ["a text file", Buffer.from("just some words, not a picture")],
    ["a JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])],
    ["a web page", Buffer.from("<html><body><svg></svg></body></html>")],
    ["nothing at all", Buffer.alloc(0)],
  ])("refuses %s, whatever it was called, and keeps the logo there", async (_, bytes) => {
    const res = await upload(people.gm, bytes);
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/^(The logo must be a PNG or an SVG picture\.|No file was sent\.)$/);
    expect((await stored())?.image).toEqual(PNG);
  });

  it("refuses a file over 200 KB, and keeps the logo there", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(200 * 1024)]);
    const res = await upload(people.gm, big);
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("The logo is 201 KB. The most is 200 KB.");
    expect((await stored())?.image).toEqual(PNG);
  });

  it.each([
    ["a script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["an event handler", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
    ["an embedded page", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>x</p></foreignObject></svg>'],
    ["a javascript link", '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>'],
    ["an entity", '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>'],
  ])("refuses an SVG carrying %s, and keeps the logo there", async (_, text) => {
    const res = await upload(people.gm, Buffer.from(text));
    expect(res.status).toBe(409);
    expect((await stored())?.image).toEqual(PNG);
  });

  it("takes an SVG, known by its content, in place of the PNG", async () => {
    const res = await upload(people.gm, SVG);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toEqual({ image_type: "image/svg+xml", image: SVG });
  });

  it("is not removed by reception", async () => {
    expect((await call(people.desk, "DELETE")).status).toBe(403);
    expect((await stored())?.image).toEqual(SVG);
  });

  it("is removed by the GM, and bills go back to the hotel's name", async () => {
    expect((await call(people.gm, "DELETE")).status).toBe(200);
    expect(await stored()).toBeNull();
    expect(await (await call(people.desk, "GET")).json()).toEqual({ logo: null });
  });
});
