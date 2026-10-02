import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES, whoMay } from "../../../src/roleGate.ts";
import { forgetKnocksForTests, hashForTests } from "../../../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   A PHOTO GALLERY PER HOTEL (the owner's D27-243, D27-244, 2 October)

   Uploaded on Settings → Property by the GM or Admin of that hotel, or the
   owner for any; a caption, an order, a delete. Kept in Postgres
   (hotel_photos), so the nightly dump carries them. The page makes each
   picture small before it is sent; the server is the guard: a JPEG by its
   own bytes, at most 1600 px on its long side and 600 KB, the camera's
   Exif (where it was taken) taken out, twenty a hotel.

   On the guest's page: the list behind the code (rule 8, its own definer),
   each picture on the link alone, as the logo is - an <img> cannot carry
   the unlock, and the pictures are the hotel's, never the guest's.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "GALLERYTEST";
const people: Record<"gm" | "desk" | "agraGm", string> = { gm: "", desk: "", agraGm: "" };
let ownerId = "";
let stayId = "";
let guestId = "";
let phoneWas: string | null = null;
let link = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown, code = "5EL") =>
  app.request(`/api/hotels/${code}/gallery${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const add = (who: string, bytes: Buffer, caption?: string, code = "5EL") =>
  call(who, "POST", "", { data: bytes.toString("base64"), ...(caption === undefined ? {} : { caption }) }, code);
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;
type Listed = { id: string; caption: string | null; width: number; height: number };
const list = async (who = people.gm) =>
  ((await (await call(who, "GET", "")).json()) as { photos: Listed[] }).photos;
const count = async () => Number((await sql<{ n: string }>(
  "select count(*)::text as n from hotel_photos p join hotels h on h.id = p.hotel_id where h.code = '5EL'"))[0]!.n);

const asGuest = (path: string, unlock?: string, headers: Record<string, string> = {}) =>
  app.request(`/api/guest/${link}${path}`, {
    headers: { ...(unlock ? { authorization: `Guest ${unlock}` } : {}), ...headers },
  });

/** A JPEG's headers as a camera writes them: an Exif block naming where it
    was taken, a frame of `width` × `height`, the scan, the end. The server
    reads segments, not pixels, so this is what it is asked about. */
function jpeg(width: number, height: number, scanBytes = 64): Buffer {
  const seg = (marker: number, body: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xe1, Buffer.from("Exif\0\0GPS 17.5258N 76.2032E", "latin1")),
    seg(0xc0, frame),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(scanBytes, 0x2a),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function unlockWith(token: string): Promise<string> {
  await sql(
    `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
     select s.link_id, s.reservation_id, encode(digest('424242','sha256'),'hex'), '…0000',
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
  await sql("delete from hotel_photos");
  for (const [who, role, code] of [["gm", "gm", "5EL"], ["desk", "front_desk", "5EL"], ["agraGm", "gm", "AGR"]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`gallery-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = $3",
      [row!.id, role, code]);
  }

  /* A guest in house at 5 Elements, with a link of their own. */
  const [stay] = await sql<{ id: string; guest: string }>(
    `select r.id::text, r.guest_id::text as guest from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'checked_in' order by r.reference limit 1`);
  ({ id: stayId, guest: guestId } = stay!);
  phoneWas = (await sql<{ phone: string | null }>("select phone from guests where id = $1", [guestId]))[0]!.phone;
  await sql("update guests set phone = '9876500044' where id = $1", [guestId]);
  const made = await app.request(`/api/hotels/5EL/stays/${stayId}/guest-link`, {
    method: "POST", headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" }, body: "{}",
  });
  expect(made.status, await made.clone().text()).toBe(200);
  link = ((await made.json()) as { link: string }).link.split("/g/")[1]!;
});

beforeEach(() => { forgetKnocksForTests(); });

afterAll(async () => {
  await sql("delete from hotel_photos");
  await sql("delete from guest_links where reservation_id = $1", [stayId]);
  await sql("update guests set phone = $2 where id = $1", [guestId, phoneWas]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("who changes a hotel's photos", () => {
  it("is the owner, an administrator or the GM - the logo's three", () => {
    for (const route of ["POST /api/hotels/:code/gallery", "PATCH /api/hotels/:code/gallery/:id",
                         "PUT /api/hotels/:code/gallery/order", "DELETE /api/hotels/:code/gallery/:id"]) {
      expect(whoMay(WRITE_RULES[route]!), route).toEqual(["owner", "admin", "gm"]);
    }
  });

  it("refuses the desk, and a GM of another hotel, and writes nothing", async () => {
    expect((await add(people.desk, jpeg(800, 600))).status).toBe(403);
    expect([403, 404]).toContain((await add(people.agraGm, jpeg(800, 600))).status);
    expect(await count()).toBe(0);
  });
});

describe("a photo the GM adds", () => {
  it("is kept with its size and caption, and without where it was taken", async () => {
    const res = await add(people.gm, jpeg(1600, 1067), "The pool at dusk");
    expect(res.status, await res.clone().text()).toBe(200);
    const { id } = (await res.json()) as { id: string };

    expect(await list()).toEqual([{ id, caption: "The pool at dusk", width: 1600, height: 1067 }]);
    const [kept] = await sql<{ photo: Buffer }>("select photo from hotel_photos where id = $1", [id]);
    expect(kept!.photo.includes(Buffer.from("GPS")), "the Exif block was kept").toBe(false);
    expect(kept!.photo.includes(Buffer.from("Exif")), "the Exif block was kept").toBe(false);
    expect(kept!.photo.includes(Buffer.from("JFIF")), "the picture's own segments were dropped").toBe(true);

    /* Settings draws it from the same bytes, read by anybody who works there. */
    const one = await call(people.desk, "GET", `/${id}`);
    expect(one.status).toBe(200);
    const body = (await one.json()) as { type: string; data: string };
    expect(body.type).toBe("image/jpeg");
    expect(Buffer.from(body.data, "base64").equals(kept!.photo)).toBe(true);
  });

  it.each([
    ["a PNG", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]), /must be a JPEG/],
    ["a JPEG whose segments do not add up", Buffer.concat([jpeg(800, 600).subarray(0, 30), Buffer.from([1, 2, 3])]), /must be a JPEG/],
    ["a JPEG with no end", jpeg(800, 600).subarray(0, -2), /must be a JPEG/],
    ["a camera's full-size file", jpeg(4032, 3024), /4032 × 3024 px\. The most is 1600 px/],
    ["over 600 KB", jpeg(1600, 1200, 620 * 1024), /The most is 600 KB/],
    ["nothing at all", Buffer.alloc(0), /must be a JPEG/],
  ])("refuses %s, and keeps nothing", async (_, bytes, why) => {
    const before = await count();
    const res = await add(people.gm, bytes);
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(why);
    expect(await count()).toBe(before);
  });

  it("refuses a caption over 120 characters", async () => {
    const res = await add(people.gm, jpeg(800, 600), "x".repeat(121));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("A caption is at most 120 characters.");
  });

  it("is captioned, put in order and deleted, and a blank caption is none", async () => {
    const second = ((await (await add(people.gm, jpeg(1200, 800), "Rooftop")).json()) as { id: string }).id;
    const [first] = await list();

    expect((await call(people.gm, "PATCH", `/${second}`, { caption: "  " })).status).toBe(200);
    expect((await list()).map((p) => p.caption)).toEqual(["The pool at dusk", null]);

    expect((await call(people.gm, "PUT", "/order", { ids: [second, first!.id] })).status).toBe(200);
    expect((await list()).map((p) => p.id)).toEqual([second, first!.id]);

    const half = await call(people.gm, "PUT", "/order", { ids: [second] });
    expect(half.status).toBe(409);
    expect(await reason(half)).toBe("The order must name each of this hotel's photos once.");

    expect((await call(people.gm, "DELETE", `/${second}`)).status).toBe(200);
    expect((await list()).map((p) => p.id)).toEqual([first!.id]);
    expect((await call(people.gm, "DELETE", `/${second}`)).status).toBe(404);
  });

  it("stops at twenty a hotel", async () => {
    while (await count() < 20) {
      expect((await add(people.gm, jpeg(800, 600))).status).toBe(200);
    }
    const res = await add(people.gm, jpeg(800, 600));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("This hotel has 20 photos, the most it may have. Delete one to add another.");
    expect(await count()).toBe(20);
  });

  it("is not another hotel's to read or change", async () => {
    const [mine] = await list();
    expect((await call(people.agraGm, "GET", `/${mine!.id}`, undefined, "AGR")).status).toBe(404);
    expect((await call(people.agraGm, "DELETE", `/${mine!.id}`, undefined, "AGR")).status).toBe(404);
  });
});

describe("the gallery on the guest's page", () => {
  it("lists the hotel's photos behind the code, in their order, and nothing without it", async () => {
    const unlock = await unlockWith(link);
    const behind = await asGuest("/gallery", unlock);
    expect(behind.status, await behind.clone().text()).toBe(200);
    const { photos } = (await behind.json()) as { photos: Listed[] };
    expect(photos.map((p) => p.id)).toEqual((await list()).map((p) => p.id));
    expect(Object.keys(photos[0]!).sort()).toEqual(["caption", "height", "id", "width"]);

    const linkAlone = (await (await asGuest("/gallery")).json()) as { photos?: Listed[] };
    expect(linkAlone.photos ?? []).toEqual([]);
  });

  it("⚠ its definer answers nothing to the link's hash without this phone's unlock (OCI-5)", async () => {
    await unlockWith(link);
    for (const unlock of [null, hashForTests("an-unlock-nobody-was-given")]) {
      expect(await sql("select * from app.guest_gallery($1, $2)", [hashForTests(link), unlock])).toEqual([]);
    }
  });

  it("serves each picture on the link alone, cached, and never another hotel's", async () => {
    const [first] = await list();
    const res = await asGuest(`/gallery/${first!.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    const [kept] = await sql<{ photo: Buffer }>("select photo from hotel_photos where id = $1", [first!.id]);
    expect(Buffer.from(await res.arrayBuffer()).equals(kept!.photo)).toBe(true);

    const again = await asGuest(`/gallery/${first!.id}`, undefined, { "if-none-match": res.headers.get("etag")! });
    expect(again.status).toBe(304);

    const [elsewhere] = await sql<{ id: string }>(
      `insert into hotel_photos (hotel_id, position, photo, width, height)
       select id, 0, $1, 800, 600 from hotels where code = 'AGR' returning id::text`, [jpeg(800, 600)]);
    for (const id of [elsewhere!.id, "not-a-photo"]) {
      const refused = await asGuest(`/gallery/${id}`);
      expect(refused.status, id).toBe(404);
      expect(refused.headers.get("content-type") ?? "").not.toMatch(/image/);
    }
  });

  it("counts pictures in their own bucket: 120 a minute a link, then the door's one sentence", async () => {
    const [first] = await list();
    for (let i = 0; i < 120; i += 1) {
      expect((await asGuest(`/gallery/${first!.id}`)).status, `picture ${i + 1}`).toBe(200);
    }
    expect((await asGuest(`/gallery/${first!.id}`)).status).toBe(404);
    /* The page's own opens are untouched by them. */
    const unlock = await unlockWith(link);
    expect((await asGuest("/gallery", unlock)).status).toBe(200);
  });

  it("is empty for a hotel with no photos, so the page draws nothing", async () => {
    await sql("delete from hotel_photos");
    const unlock = await unlockWith(link);
    expect(((await (await asGuest("/gallery", unlock)).json()) as { photos: Listed[] }).photos).toEqual([]);
  });
});
