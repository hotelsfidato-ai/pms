import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES, READ_RULES, whoMay } from "../../../src/roleGate.ts";
import { forgetKnocksForTests, hashForTests } from "../../../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PROPERTY'S PROFILE (phase 2 of the settings plan; D27-249, D27-257)

   Four more registration numbers; the five highlights and three policy
   texts, plain; the child ages, words only; ONE amenities list for the
   group (the owner or an Admin keeps it), each hotel switching its own on.
   The guest's page shows the highlights, the amenities and the map point
   behind the code.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "PROPTEST";
const people: Record<"gm" | "desk" | "admin", string> = { gm: "", desk: "", admin: "" };
let ownerId = "";
let stayId = "";
let guestId = "";
let phoneWas: string | null = null;
let link = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;
type Profile = {
  registrations: { label: string; number: string }[]; texts: Record<string, string>;
  childFreeAge: number | null; childMaxAge: number | null;
};
const profile = async () => (await (await call(people.gm, "GET", "/property-profile")).json()) as Profile;
type Amenity = { id: string; name: string; icon: string; isActive: boolean; on: boolean; used: boolean };
const amenities = async (who = people.gm) =>
  (await (await call(who, "GET", "/amenities")).json()) as { amenities: Amenity[]; mayKeep: boolean };

async function unlockWith(token: string): Promise<string> {
  await sql(
    `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
     select s.link_id, s.reservation_id, encode(digest('424242','sha256'),'hex'), 'xx0000',
            now() + interval '10 minutes'
       from app.guest_link_stay($1) s`, [hashForTests(token)]);
  const res = await app.request(`/api/guest/${token}/verify`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "424242" }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { unlock: string }).unlock;
}

beforeAll(async () => {
  ownerId = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const [who, role] of [["gm", "gm"], ["desk", "front_desk"], ["admin", "admin"]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`property-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
      [row!.id, role]);
  }
  const [stay] = await sql<{ id: string; guest: string }>(
    `select r.id::text, r.guest_id::text as guest from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'confirmed' order by r.reference desc limit 1`);
  ({ id: stayId, guest: guestId } = stay!);
  phoneWas = (await sql<{ phone: string | null }>("select phone from guests where id = $1", [guestId]))[0]!.phone;
  await sql("update guests set phone = '9876500066' where id = $1", [guestId]);
  const made = await app.request(`/api/hotels/5EL/stays/${stayId}/guest-link`, {
    method: "POST", headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" }, body: "{}",
  });
  expect(made.status, await made.clone().text()).toBe(200);
  link = ((await made.json()) as { link: string }).link.split("/g/")[1]!;
});

beforeEach(() => { forgetKnocksForTests(); });

afterAll(async () => {
  await sql("delete from guest_links where reservation_id = $1", [stayId]);
  await sql("update guests set phone = $2 where id = $1", [guestId, phoneWas]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("who keeps the property's profile", () => {
  it("is the owner, an Admin or the GM, as for the logo; everybody there reads it", () => {
    for (const route of ["PUT /api/hotels/:code/registrations", "PUT /api/hotels/:code/texts/:kind",
                         "PUT /api/hotels/:code/child-ages", "PUT /api/hotels/:code/amenities/:id",
                         "POST /api/hotels/:code/amenities", "PATCH /api/hotels/:code/amenities/:id",
                         "PUT /api/hotels/:code/amenities/order", "DELETE /api/hotels/:code/amenities/:id"]) {
      expect(whoMay(WRITE_RULES[route]!), route).toEqual(whoMay(WRITE_RULES["PUT /api/hotels/:code/logo"]!));
    }
    expect(whoMay(READ_RULES["GET /api/hotels/:code/property-profile"]!))
      .toEqual(whoMay(READ_RULES["GET /api/hotels/:code/group"]!));
  });

  it("refuses the desk, and writes nothing", async () => {
    expect((await call(people.desk, "PUT", "/texts/about", { body: "x" })).status).toBe(403);
    expect((await profile()).texts).toEqual({});
  });
});

describe("registration numbers", () => {
  it("keeps up to four, each with its label", async () => {
    const four = [1, 2, 3, 4].map((n) => ({ label: `Licence ${n}`, number: `AB-${n}` }));
    expect((await call(people.gm, "PUT", "/registrations", { registrations: four })).status).toBe(200);
    expect((await profile()).registrations).toEqual(four);
  });

  it.each([
    ["a fifth", [1, 2, 3, 4, 5].map((n) => ({ label: `L${n}`, number: `N${n}` })), /at most four/],
    ["a number with no label", [{ label: " ", number: "X1" }], /label and a number/],
    ["a label over 40 characters", [{ label: "x".repeat(41), number: "X1" }], /40 characters/],
  ])("refuses %s, and keeps what was there", async (_, registrations, why) => {
    const before = (await profile()).registrations;
    const res = await call(people.gm, "PUT", "/registrations", { registrations });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(why);
    expect((await profile()).registrations).toEqual(before);
  });
});

describe("the hotel's texts", () => {
  it("keeps a highlight as typed, paragraphs and all, and records the change", async () => {
    const about = "A heritage stay near the temple.\n\nTwenty rooms around a courtyard.";
    expect((await call(people.gm, "PUT", "/texts/about", { body: `  ${about}  ` })).status).toBe(200);
    expect((await profile()).texts["about"]).toBe(about);
    const [logged] = await sql<{ n: string }>(
      "select count(*)::text as n from audit_log where table_name = 'hotel_texts'");
    expect(Number(logged!.n)).toBeGreaterThan(0);
  });

  it("removes a text sent blank, refuses one over 2000 characters and a kind it does not keep", async () => {
    await call(people.gm, "PUT", "/texts/parking", { body: "Free parking for twelve cars." });
    expect((await call(people.gm, "PUT", "/texts/parking", { body: "  " })).status).toBe(200);
    expect((await profile()).texts["parking"]).toBeUndefined();

    const long = await call(people.gm, "PUT", "/texts/family", { body: "x".repeat(2001) });
    expect(long.status).toBe(409);
    expect(await reason(long)).toBe("A text is at most 2000 characters.");
    expect((await call(people.gm, "PUT", "/texts/menu", { body: "x" })).status).toBe(404);
  });
});

describe("the child ages (words only)", () => {
  it("keeps free up to 5 and a child up to 12, clears with nothing, refuses them the wrong way round", async () => {
    expect((await call(people.gm, "PUT", "/child-ages", { free: 5, max: 12 })).status).toBe(200);
    expect(await profile()).toMatchObject({ childFreeAge: 5, childMaxAge: 12 });

    const wrong = await call(people.gm, "PUT", "/child-ages", { free: 12, max: 5 });
    expect(wrong.status).toBe(409);
    expect(await reason(wrong)).toBe("The free age must be below the child age.");
    expect(await profile()).toMatchObject({ childFreeAge: 5, childMaxAge: 12 });

    expect((await call(people.gm, "PUT", "/child-ages", { free: null, max: null })).status).toBe(200);
    expect(await profile()).toMatchObject({ childFreeAge: null, childMaxAge: null });
  });
});

describe("ONE amenities list", () => {
  it("starts with twenty names and none switched on here", async () => {
    const { amenities: list } = await amenities();
    expect(list).toHaveLength(20);
    expect(list.filter((a) => a.on)).toEqual([]);
  });

  it("is switched on and off by the hotel's GM", async () => {
    const wifi = (await amenities()).amenities.find((a) => a.name === "Free Wi-Fi")!;
    expect((await call(people.gm, "PUT", `/amenities/${wifi.id}`, { on: true })).status).toBe(200);
    expect((await amenities()).amenities.find((a) => a.id === wifi.id)).toMatchObject({ on: true, used: true });
  });

  it("is added to and renamed by the owner or an Admin, not the GM", async () => {
    expect((await amenities(people.gm)).mayKeep).toBe(false);
    const refused = await call(people.gm, "POST", "/amenities", { name: "Rooftop garden" });
    expect(refused.status).toBe(403);
    expect(await reason(refused)).toBe("Only the owner or an Admin changes the amenities list.");

    expect((await amenities(people.admin)).mayKeep).toBe(true);
    const added = await call(people.admin, "POST", "/amenities", { name: "Rooftop garden" });
    expect(added.status, await added.clone().text()).toBe(200);
    const { id } = (await added.json()) as { id: string };
    const twice = await call(ownerId, "POST", "/amenities", { name: "rooftop GARDEN" });
    expect(twice.status).toBe(409);
    expect(await reason(twice)).toBe("That amenity is on the list already.");

    expect((await call(ownerId, "PATCH", `/amenities/${id}`, { name: "Rooftop terrace" })).status).toBe(200);
    expect((await amenities()).amenities.find((a) => a.id === id)?.name).toBe("Rooftop terrace");
  });

  it("is deleted only when no hotel uses it, and put in order", async () => {
    const list = (await amenities()).amenities;
    const wifi = list.find((a) => a.name === "Free Wi-Fi")!;
    const used = await call(ownerId, "DELETE", `/amenities/${wifi.id}`);
    expect(used.status).toBe(409);
    expect(await reason(used)).toBe("A hotel has this amenity switched on. Switch it off there first, or turn it Off here.");

    const terrace = list.find((a) => a.name === "Rooftop terrace")!;
    expect((await call(ownerId, "DELETE", `/amenities/${terrace.id}`)).status).toBe(200);

    const ids = (await amenities()).amenities.map((a) => a.id).reverse();
    expect((await call(ownerId, "PUT", "/amenities/order", { ids })).status).toBe(200);
    expect((await amenities()).amenities.map((a) => a.id)).toEqual(ids);
  });
});

describe("the guest's page", () => {
  it("shows the highlights, the amenities on here and the map point behind the code - never the policy texts", async () => {
    await call(people.gm, "PUT", "/texts/parking", { body: "Free parking." });
    await sql("update hotels set latitude = 17.525800, longitude = 76.203200 where code = '5EL'");
    const unlock = await unlockWith(link);
    const res = await app.request(`/api/guest/${link}/about`, { headers: { authorization: `Guest ${unlock}` } });
    expect(res.status, await res.clone().text()).toBe(200);
    const about = (await res.json()) as {
      texts: Record<string, string>; amenities: { name: string; icon: string }[];
      map: { latitude: number; longitude: number } | null;
    };
    expect(about.texts).toEqual({ about: "A heritage stay near the temple.\n\nTwenty rooms around a courtyard." });
    expect(about.amenities).toEqual([{ name: "Free Wi-Fi", icon: "wifi" }]);
    expect(about.map).toEqual({ latitude: 17.5258, longitude: 76.2032 });

    expect((await app.request(`/api/guest/${link}/about`)).status).toBe(404);
  });

  it("⚠ its definer answers nothing to the link's hash without this phone's unlock (OCI-5)", async () => {
    await unlockWith(link);
    for (const unlock of [null, hashForTests("an-unlock-nobody-was-given")]) {
      expect(await sql("select * from app.guest_about($1, $2)", [hashForTests(link), unlock])).toEqual([]);
    }
  });
});
