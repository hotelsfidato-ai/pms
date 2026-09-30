import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { open as openBundle } from "../src/aesZip.ts";
import { forgetKnocksForTests, hashForTests } from "../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S ID PHOTO (D27-207 to D27-212)

   The one door a stranger opens now takes identity documents, so this file
   is mostly about what it REFUSES and what NEVER happens:

     · nothing is taken before the code, with the link alone, or on a
       forwarded link - and nothing is stored when it is refused
     · only a JPEG or a PNG, by the file's own bytes; a size limit; the
       guest's tick
     · what leaves this server is an encrypted bundle and nothing else;
       where it was taken is stripped from a JPEG first
     · the guest never reads a photo back
     · at the desk: reception while the details wait, then only the owner,
       an administrator and the GM; every view written down; a changed
       byte, a swapped file and a wrong password all fail closed
     · Drive down: the guest is told to try again and NOTHING is kept; the
       desk still sees the typed details

   Google Drive and the CRS's n8n are stood in for by a server in this
   file, which keeps what it is sent so the test can look at it. Every
   name, number, password and image here is made up.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const NOTHING = "This link is not usable. Ask the desk for a new one.";
const TAG = "GUESTIDPHOTO";
const PASSWORD = "MadeUpPassword0123456789";
const STORE_SECRET = "only-this-test-run-knows-this";

let ownerId: string;
let deskId: string;
let gmId: string;
let housekeeperId: string;
let accountantId: string;
let elsewhereId: string;
let hotelId: string;
let guestId: string;
let stayId: string;
let otherStayId: string;
let link: string;
let unlock: string;
let otherLink: string;
let otherUnlock: string;

/* ── Made-up images ─────────────────────────────────────────────────
   A JPEG as a camera writes one: the picture's own segments, and an Exif
   segment (APP1) saying where it was taken. Nothing here is decoded; the
   door reads markers, as it should. */
const WHERE_TAKEN = "GPS-MADE-UP-17.5281N-76.2042E";
const segment = (marker: number, body: Buffer) => {
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = marker; head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};
const PICTURE = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 53 + 11) % 251));
const jpeg = (mark = "front") => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
  segment(0xe1, Buffer.from(`Exif\0\0${WHERE_TAKEN}`, "latin1")),
  segment(0xdb, Buffer.alloc(65, 7)),
  segment(0xda, Buffer.from(`made-up-${mark}`, "latin1")),
  PICTURE, Buffer.from([0xff, 0xd9]),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("made-up-png-bytes-".repeat(40)),
]);

/* ── The store, stood in for ──────────────────────────────────────── */
let server: Server;
const files = new Map<string, Buffer>();
let calls: { action: string; hotel?: string; name?: string; fileId?: string; base64?: string }[] = [];
let storeDown = false;
let deleteRefused = false;
let nextFile = 0;

const asStaff = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asGuest = (path: string, method = "GET", body?: unknown, held: string | null = null) =>
  app.request(`/api/guest${path}`, {
    method,
    headers: { "content-type": "application/json", ...(held ? { authorization: `Guest ${held}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Parts = { front?: Buffer | null; back?: Buffer | null; agreed?: boolean; type?: string };

/** A form upload as a browser sends it: the form's own bytes, and the
    length it declares. In-process there is no browser to count them. */
async function formRequest(url: string, parts: Parts, headers: Record<string, string>) {
  const form = new FormData();
  if (parts.front) form.append("front", new File([parts.front], "IMG_0001.jpg", { type: parts.type ?? "image/jpeg" }));
  if (parts.back) form.append("back", new File([parts.back], "IMG_0002.jpg", { type: parts.type ?? "image/jpeg" }));
  if (parts.agreed !== false) form.append("agreed", "yes");
  const shaped = new Request("http://form.test/", { method: "POST", body: form });
  const body = Buffer.from(await shaped.arrayBuffer());
  return app.request(url, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": shaped.headers.get("content-type")!,
      "content-length": String(body.length),
    },
    body,
  });
}
const send = (token: string, held: string | null, parts: Parts = { front: jpeg() }) =>
  formRequest(`/api/guest/${token}/id-photo`, parts, held ? { authorization: `Guest ${held}` } : {});
const deskAdds = (who: string, stay: string, parts: Parts = { front: jpeg("desk") }) =>
  formRequest(`/api/hotels/5EL/stays/${stay}/id-photo`, parts, { "x-dev-staff-id": who });

const tokenOf = (url: string) => url.split("/g/")[1]!;
const said = async (res: Response) => ((await res.json()) as { error: string }).error;

async function unlockWith(token: string): Promise<string> {
  await sql(
    `insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
     select s.link_id, s.reservation_id, encode(digest('424242','sha256'),'hex'), '…0000',
            now() + interval '10 minutes'
       from app.guest_link_stay($1) s`, [hashForTests(token)]);
  const res = await asGuest(`/${token}/verify`, "POST", { code: "424242" });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { unlock: string }).unlock;
}

const sendDetails = async (token: string, held: string) => {
  const res = await asGuest(`/${token}/details`, "POST",
    { idType: "passport", idNumber: "Z0000001", addressLine: "1 Made-up Road" }, held);
  expect(res.status, await res.clone().text()).toBe(200);
};

const rowsOf = async (stay = stayId) => (await sql(
  `select id::text, status, sides, drive_file_id, cipher_sha256, cipher_bytes, removed_reason,
          removed_by::text, uploaded_by::text, link_id is not null as by_guest, hotel_code,
          drive_delete_failed_at is not null as delete_failed, notice_version
     from guest_id_photos where reservation_id = $1 order by created_at`, [stay])).rows;
const storedRow = async (stay = stayId) => (await rowsOf(stay)).find((r) => r.status === "stored");

/** Everything of this file's, gone - so each test starts from nothing. */
async function clear() {
  const stays = [stayId, otherStayId];
  await sql("delete from guest_id_photo_views where photo_id in (select id from guest_id_photos where reservation_id = any($1::uuid[]))", [stays]);
  await sql("delete from guest_id_photos where reservation_id = any($1::uuid[])", [stays]);
  files.clear();
  calls = [];
  storeDown = false;
  deleteRefused = false;
}

const settings = () => {
  process.env["ID_PHOTO_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-id-photos`;
  process.env["ID_PHOTO_N8N_SECRET"] = STORE_SECRET;
  process.env["ID_PHOTO_PASSWORD_5EL"] = PASSWORD;
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const answer = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      };
      if (req.headers["x-fidato-secret"] !== STORE_SECRET) return answer(401, { error: "no secret" });
      const call = JSON.parse(raw) as (typeof calls)[number];
      calls.push(call);
      if (storeDown) return answer(503, { error: "Drive is not answering" });
      if (call.action === "store") {
        const id = `drive-file-${++nextFile}`;
        files.set(id, Buffer.from(call.base64!, "base64"));
        return answer(200, { fileId: id });
      }
      if (call.action === "fetch") {
        const file = files.get(call.fileId!);
        return file ? answer(200, { base64: file.toString("base64") }) : answer(404, { error: "no such file" });
      }
      if (call.action === "delete") {
        if (deleteRefused) return answer(500, { error: "Drive said no" });
        files.delete(call.fileId!);
        return answer(200, { deleted: true });
      }
      return answer(400, { error: "what?" });
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));

  ownerId = (await sql("select id::text as id from staff where email = 'owner@fidato.in'")).rows[0].id;
  elsewhereId = (await sql("select id::text as id from staff where email = 'pune@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text as id from hotels where code = '5EL'")).rows[0].id;
  const person = async (name: string, role: string) => {
    const email = `${TAG.toLowerCase()}-${name.toLowerCase()}@fidato.in`;
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1,$2,$3)
       on conflict (email) do update set is_active = true
       returning id::text as id`, [email, `${TAG} ${name}`, `test-uid-${email}`]);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1,$2,$3)", [rows[0].id, hotelId, role]);
    return rows[0].id as string;
  };
  deskId = await person("Desk", "front_desk");
  gmId = await person("Manager", "gm");
  housekeeperId = await person("Housekeeping", "housekeeping");
  accountantId = await person("Accounts", "finance");

  guestId = (await sql("insert into guests (full_name, phone) values ($1, '9876500033') returning id::text as id",
    [`${TAG} Guest`])).rows[0].id;
  const book = async (ref: string) => (await sql(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                               check_in, check_out, adults, status, source, agreed_rate)
     select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
            (now() at time zone 'Asia/Kolkata')::date + 20,
            (now() at time zone 'Asia/Kolkata')::date + 21,
            1, 'confirmed', 'direct', 1000
     returning id::text as id`, [hotelId, guestId, ref])).rows[0].id as string;
  stayId = await book("GIP-1");
  otherStayId = await book("GIP-2");

  const linkFor = async (stay: string) => {
    const made = await asStaff(ownerId, `/5EL/stays/${stay}/guest-link`, "POST", {});
    expect(made.status, await made.clone().text()).toBe(200);
    return tokenOf(((await made.json()) as { link: string }).link);
  };
  link = await linkFor(stayId);
  otherLink = await linkFor(otherStayId);
  unlock = await unlockWith(link);
  otherUnlock = await unlockWith(otherLink);
  await sendDetails(link, unlock);
});

beforeEach(async () => {
  forgetKnocksForTests();
  settings();
  await clear();
  /* The details wait for the desk again, whatever the test before did. */
  await sql("delete from guest_detail_submissions where reservation_id = $1", [stayId]);
  await sendDetails(link, unlock);
});

afterAll(async () => {
  await clear();
  for (const k of ["ID_PHOTO_N8N_URL", "ID_PHOTO_N8N_SECRET", "ID_PHOTO_PASSWORD_5EL"]) delete process.env[k];
  const stays = [stayId, otherStayId];
  await sql("delete from guest_detail_submissions where reservation_id = any($1::uuid[])", [stays]);
  await sql(`delete from guest_link_codes where link_id in
               (select id from guest_links where reservation_id = any($1::uuid[]))`, [stays]);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [stays]);
  await sql("delete from reservations where id = any($1::uuid[])", [stays]);
  await sql("delete from guest_documents where guest_id = $1", [guestId]);
  await sql("alter table guests disable trigger guests_no_delete");
  await sql("delete from guests where id = $1", [guestId]);
  await sql("alter table guests enable trigger guests_no_delete");
  const people = [deskId, gmId, housekeeperId, accountantId];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [people]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [people]);
  await new Promise<void>((done) => server.close(() => done()));
  await closePool();
});

/* ══ The guest's side ═══════════════════════════════════════════════ */

describe("the photo is behind the code, like everything else", () => {
  it("is refused before the code, with the link alone, and on a forwarded link - and nothing is stored", async () => {
    for (const [what, token, held] of [
      ["no unlock", link, null],
      ["an unlock nobody was given", link, "an-unlock-made-up-0123456789abcdefghijklmn"],
      ["another booking's unlock on this link", link, otherUnlock],
      ["a link that does not exist", "no-such-link", unlock],
    ] as const) {
      const res = await send(token, held);
      expect(res.status, what).toBe(404);
      expect(await said(res), what).toBe(NOTHING);
      const state = await asGuest(`/${token}/id-photo`, "GET", undefined, held);
      expect(state.status, what).toBe(404);
      expect(await said(state), what).toBe(NOTHING);
    }
    expect(calls, "the store was never asked").toEqual([]);
    expect(await rowsOf()).toEqual([]);
    expect(await rowsOf(otherStayId)).toEqual([]);
  });

  /* OCI-5: the door asks first, so a test through the door cannot see a
     function that forgot to. Asked here of the database itself, as the
     door's own role, with the link's hash and no unlock. */
  it("is asked for the unlock in every database function, not only at the door", async () => {
    const db = new (await import("pg")).default.Pool({ connectionString: process.env["DATABASE_URL"] });
    const hash = hashForTests(link);
    const other = hashForTests(otherUnlock);
    try {
      const made = await sql(
        `insert into guest_id_photos (hotel_id, hotel_code, reservation_id, guest_id, link_id, sides, notice_version)
         select $1, '5EL', $2, $3, (select id from guest_links where reservation_id = $2 limit 1), '{front}', 'test'
         returning id::text`, [hotelId, stayId, guestId]);
      const id = made.rows[0].id as string;
      for (const held of [null, "0".repeat(64), other]) {
        expect((await db.query("select * from app.guest_id_photo_begin($1, $2, '{front}', 'test')", [hash, held])).rows).toEqual([]);
        expect((await db.query("select app.guest_id_photo_stored($1, $2, $3, 'x', $4, 10) as done",
          [hash, held, id, "a".repeat(64)])).rows[0].done).toBeNull();
        await db.query("select app.guest_id_photo_abandon($1, $2, $3)", [hash, held, id]);
        await db.query("select app.guest_id_photo_delete_failed($1, $2, $3)", [hash, held, id]);
        expect((await db.query("select * from app.guest_id_photo_state($1, $2)", [hash, held])).rows).toEqual([]);
      }
      expect((await rowsOf()).map((r) => r.status), "untouched: still there, still pending").toEqual(["pending"]);
      /* And the table itself answers the door's role nothing at all. */
      expect((await db.query("select count(*)::int as n from guest_id_photos")).rows[0].n).toBe(0);
    } finally {
      await db.end();
    }
  });

  it("is not offered where the hotel has no password, a short one, or one with a symbol in it", async () => {
    for (const typed of [undefined, "", "TooShort0123456789", "Has-A-Symbol-0123456789abcd"]) {
      if (typed === undefined) delete process.env["ID_PHOTO_PASSWORD_5EL"];
      else process.env["ID_PHOTO_PASSWORD_5EL"] = typed;
      const state = (await (await asGuest(`/${link}/id-photo`, "GET", undefined, unlock)).json()) as { offered: boolean };
      expect(state.offered, String(typed)).toBe(false);
      const res = await send(link, unlock);
      expect(res.status, String(typed)).toBe(409);
      expect(await said(res)).toBe("This hotel is not taking ID photos online. Show your ID at the desk.");
    }
    settings();
    delete process.env["ID_PHOTO_N8N_URL"];
    expect((await send(link, unlock)).status, "no store").toBe(409);
    expect(calls).toEqual([]);
    expect(await rowsOf()).toEqual([]);
  });

  it("waits for the details: no photo before them, and none once the desk has checked them", async () => {
    await sql("delete from guest_detail_submissions where reservation_id = $1", [stayId]);
    const before = await send(link, unlock);
    expect(before.status).toBe(409);
    expect(await said(before)).toMatch(/Send your check-in details first/);

    await sendDetails(link, unlock);
    expect((await send(link, unlock)).status).toBe(200);
    const waiting = (await sql("select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId])).rows[0].id;
    expect((await asStaff(deskId, `/5EL/online-checkin/submissions/${waiting}/confirm`, "POST", {})).status).toBe(200);

    const after = await send(link, unlock, { front: jpeg("again") });
    expect(after.status, "confirmed: the guest adds nothing more").toBe(409);
    const state = (await (await asGuest(`/${link}/id-photo`, "GET", undefined, unlock)).json()) as { maySend: boolean; sent: unknown };
    expect(state.maySend).toBe(false);
    expect(state.sent, "and the one they sent is still theirs to know of").not.toBeNull();
    expect((await rowsOf()).filter((r) => r.status === "stored")).toHaveLength(1);
  });
});

describe("what the door takes", () => {
  it("takes a JPEG or a PNG by the file's own bytes, whatever it is called", async () => {
    for (const [what, bytes] of [
      ["a PDF called a photo", Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n")],
      ["a web page called a photo", Buffer.from("<html><script>alert(1)</script></html>")],
      ["an HEIC", Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40)])],
      ["nothing much", Buffer.from([0xff, 0xd8])],
    ] as const) {
      const res = await send(link, unlock, { front: bytes, type: "image/jpeg" });
      expect(res.status, what).toBe(400);
      expect(await said(res), what).toBe("That file is not a photo we can take. Send a JPEG or a PNG.");
    }
    expect(calls, "nothing reached the store").toEqual([]);
    expect(await rowsOf()).toEqual([]);

    /* And a PNG called a JPEG is a PNG. */
    expect((await send(link, unlock, { front: PNG, type: "image/jpeg" })).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("refuses a photo over 4 MB, and an upload over 9 MB before reading it", async () => {
    const big = Buffer.concat([jpeg(), Buffer.alloc(4 * 1024 * 1024)]);
    const one = await send(link, unlock, { front: big });
    expect(one.status).toBe(400);
    expect(await said(one)).toMatch(/too large/);

    /* The declared length alone decides: a small body saying it is huge. */
    const claimed = await app.request(`/api/guest/${link}/id-photo`, {
      method: "POST",
      headers: {
        authorization: `Guest ${unlock}`, "content-type": "multipart/form-data; boundary=x",
        "content-length": String(9 * 1024 * 1024 + 1),
      },
      body: "--x--",
    });
    expect(claimed.status).toBe(413);
    const undeclared = await app.request(`/api/guest/${link}/id-photo`, {
      method: "POST",
      headers: { authorization: `Guest ${unlock}`, "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    expect(undeclared.status, "no length declared is not a small upload").toBe(413);
    expect(calls).toEqual([]);
    expect(await rowsOf()).toEqual([]);
  });

  it("takes nothing without the guest's tick, and nothing without the front", async () => {
    const unticked = await send(link, unlock, { front: jpeg(), agreed: false });
    expect(unticked.status).toBe(400);
    expect(await said(unticked)).toBe("Tick the box to agree before sending the photo.");
    const backOnly = await send(link, unlock, { back: jpeg("back") });
    expect(backOnly.status).toBe(400);
    expect(await said(backOnly)).toBe("Choose the photo of the front of the ID.");
    expect(calls).toEqual([]);
    expect(await rowsOf()).toEqual([]);
  });

  it("stops at ten an hour from one link", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await send(link, unlock, { front: jpeg(`n${i}`) })).status, `photo ${i + 1}`).toBe(200);
    }
    const eleventh = await send(link, unlock);
    expect(eleventh.status).toBe(429);
    expect(await said(eleventh)).toMatch(/Ten photos have been sent/);
    expect(calls.filter((c) => c.action === "store")).toHaveLength(10);
  });
});

describe("what leaves this server", () => {
  it("is one encrypted bundle, named by its row, and nothing of the photo in the clear", async () => {
    const front = jpeg("front");
    const back = jpeg("back");
    const res = await send(link, unlock, { front, back });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ sent: true });

    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    const row = (await storedRow())!;
    expect(sent.action).toBe("store");
    expect(sent.hotel).toBe("5EL");
    expect(sent.name, "the row's id, and nothing of the guest").toBe(`${row.id}.zip`);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(`${TAG} Guest`);
    expect(wire).not.toContain("GIP-1");

    const bundle = Buffer.from(sent.base64!, "base64");
    expect(bundle.includes(PICTURE.subarray(100, 140)), "the picture is not in it, plain").toBe(false);
    expect(bundle.includes(Buffer.from("made-up-front")), "nor any of its words").toBe(false);
    expect(bundle.includes(Buffer.from("GIP-1"))).toBe(false);

    /* And it opens with the hotel's password - to the photos and a note. */
    const inside = openBundle(bundle, PASSWORD);
    expect(inside.map((e) => e.name)).toEqual(["about.txt", "front.jpg", "back.jpg"]);
    const about = inside[0]!.bytes.toString();
    expect(about).toContain("Hotel: 5EL");
    expect(about).toContain("Booking: GIP-1");
    expect(about).toContain(`Guest: ${TAG} Guest`);
    expect(about).toContain("Added by: the guest");
    expect(about).toContain(`Record: ${row.id}`);
    expect(inside[1]!.bytes.includes(PICTURE), "the front's picture, whole").toBe(true);
    expect(inside[2]!.bytes.includes(Buffer.from("made-up-back"))).toBe(true);
    expect(() => openBundle(bundle, "WrongPassword01234567890")).toThrow();

    /* The row: where it is and what it must hash to. Nothing of the image. */
    expect(row).toMatchObject({
      status: "stored", sides: ["front", "back"], hotel_code: "5EL", by_guest: true,
      cipher_sha256: createHash("sha256").update(bundle).digest("hex"), cipher_bytes: bundle.length,
    });
    expect(row.notice_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await sql("select count(*)::int as n from attachments where hotel_id = $1 and uploaded_at > now() - interval '1 minute'",
      [hotelId])).rows[0].n, "and it is not among the attachments anybody can list").toBe(0);
  });

  it("strips where the photo was taken from a JPEG, and keeps the picture", async () => {
    expect(jpeg().includes(Buffer.from(WHERE_TAKEN)), "the fixture does say where").toBe(true);
    expect((await send(link, unlock)).status).toBe(200);
    const front = openBundle(files.get((await storedRow())!.drive_file_id)!, PASSWORD)[1]!.bytes;
    expect(front.includes(Buffer.from(WHERE_TAKEN))).toBe(false);
    expect(front.includes(Buffer.from("Exif"))).toBe(false);
    expect(front.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(front.includes(Buffer.from("JFIF")), "the picture's own segments stay").toBe(true);
    expect(front.includes(PICTURE)).toBe(true);
  });

  it("refuses a JPEG whose segments do not add up, rather than guess", async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.from("short")]);
    const res = await send(link, unlock, { front: broken });
    expect(res.status).toBe(400);
    expect(await said(res)).toMatch(/could not be read/);
    expect(calls).toEqual([]);
  });

  it("deletes a replaced photo at once, and writes it down when Drive will not", async () => {
    expect((await send(link, unlock, { front: jpeg("first") })).status).toBe(200);
    const first = (await storedRow())!;
    expect(files.has(first.drive_file_id)).toBe(true);

    expect((await send(link, unlock, { front: jpeg("second") })).status).toBe(200);
    expect(files.has(first.drive_file_id), "the first is gone from Drive").toBe(false);
    let rows = await rowsOf();
    expect(rows.map((r) => [r.status, r.removed_reason, r.delete_failed])).toEqual([
      ["removed", "replaced", false], ["stored", null, false]]);

    deleteRefused = true;
    expect((await send(link, unlock, { front: jpeg("third") })).status, "the new one is still taken").toBe(200);
    rows = await rowsOf();
    expect(rows.map((r) => [r.status, r.delete_failed])).toEqual([
      ["removed", false], ["removed", true], ["stored", false]]);
    /* The guest still reads only that one is there. */
    const state = (await (await asGuest(`/${link}/id-photo`, "GET", undefined, unlock)).json()) as { sent: { sides: string[] } };
    expect(state.sent.sides).toEqual(["front"]);
  });

  it("keeps nothing anywhere when Drive is down, and says try again", async () => {
    storeDown = true;
    const res = await send(link, unlock);
    expect(res.status).toBe(503);
    expect(await said(res)).toBe("The photo could not be stored just now, and nothing was kept. "
      + "Try again shortly, or show your ID at the desk.");
    expect(await rowsOf(), "no row left behind").toEqual([]);
    expect(files.size).toBe(0);
  });
});

describe("the guest never reads a photo back", () => {
  it("is told only that it is there and since when", async () => {
    expect((await send(link, unlock, { front: jpeg(), back: jpeg("back") })).status).toBe(200);
    const row = (await storedRow())!;
    const res = await asGuest(`/${link}/id-photo`, "GET", undefined, unlock);
    const text = await res.clone().text();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["maySend", "notice", "offered", "removed", "sent"]);
    expect(body["sent"]).toMatchObject({ sides: ["front", "back"] });
    expect(text).not.toContain(row.drive_file_id);
    expect(text).not.toContain(row.cipher_sha256);
    expect(text).not.toContain(row.id);
    expect(text).not.toMatch(/base64|data:image/);
  });

  it("has no way to the image through the guest's door, or the desk's without a sign-in", async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const row = (await storedRow())!;
    for (const path of [`/${link}/id-photo/${row.id}`, `/${link}/id-photo/front`, `/${link}/id-photos`, `/${link}/id-photo/file`]) {
      const res = await asGuest(path, "GET", undefined, unlock);
      expect(res.status, path).toBe(404);
    }
    const unsigned = await app.request(`/api/hotels/5EL/online-checkin/id-photos/${row.id}`, {
      headers: { authorization: `Guest ${unlock}` } });
    expect(unsigned.status, "the guest's unlock is not a staff sign-in").toBe(401);
    expect(calls.filter((c) => c.action === "fetch"), "nothing was fetched from Drive").toEqual([]);
  });
});

/* ══ The desk's side ════════════════════════════════════════════════ */

describe("at the desk, while the details wait", () => {
  const view = (who: string, id: string) => asStaff(who, `/5EL/online-checkin/id-photos/${id}`);

  it("shows reception the photo beside the details, and writes the view down", async () => {
    const front = jpeg("front");
    expect((await send(link, unlock, { front, back: PNG })).status).toBe(200);
    const row = (await storedRow())!;

    const list = (await (await asStaff(deskId, "/5EL/online-checkin")).json()) as {
      waiting: { reference: string; photo: { id: string; sides: string[] } | null }[];
      idPhotos: { on: boolean; off: string | null; keeper: boolean };
    };
    expect(list.waiting.find((w) => w.reference === "GIP-1")!.photo).toMatchObject({ id: row.id, sides: ["front", "back"] });
    expect(list.idPhotos).toEqual({ on: true, off: null, keeper: false });

    const res = await view(deskId, row.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { photos: { side: string; image: string }[] };
    expect(body.photos.map((p) => p.side)).toEqual(["front", "back"]);
    const shown = Buffer.from(body.photos[0]!.image.replace("data:image/jpeg;base64,", ""), "base64");
    expect(shown.includes(PICTURE), "the picture the guest sent").toBe(true);
    expect(body.photos[1]!.image.startsWith("data:image/png;base64,")).toBe(true);

    const { rows } = await sql("select viewed_by::text from guest_id_photo_views where photo_id = $1", [row.id]);
    expect(rows.map((r) => r.viewed_by), "who opened it").toEqual([deskId]);
  });

  it("refuses housekeeping, the accountant and another hotel's clerk, and fetches nothing for them", async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const row = (await storedRow())!;
    for (const who of [housekeeperId, accountantId, elsewhereId]) {
      expect((await view(who, row.id)).status).toBe(403);
      expect((await asStaff(who, `/5EL/online-checkin/id-photos/${row.id}/remove`, "POST", { reason: "not_masked" })).status).toBe(403);
      expect((await asStaff(who, "/5EL/online-checkin/id-photos")).status).toBe(403);
    }
    expect(calls.filter((c) => c.action !== "store")).toEqual([]);
    expect((await sql("select count(*)::int as n from guest_id_photo_views where photo_id = $1", [row.id])).rows[0].n).toBe(0);
    expect((await storedRow())!.id, "still there").toBe(row.id);
    /* And the general attachments list has never heard of it. */
    const attached = await asStaff(ownerId, `/5EL/attachments?table=guest_id_photos&id=${row.id}`);
    expect(((await attached.json()) as { files: unknown[] }).files).toEqual([]);
  });

  it("fails closed on a changed byte, a swapped file and a changed password", async () => {
    expect((await send(link, unlock, { front: jpeg("mine") })).status).toBe(200);
    const row = (await storedRow())!;
    const good = files.get(row.drive_file_id)!;
    const refusedToOpen = async (what: string) => {
      const res = await view(deskId, row.id);
      expect(res.status, what).toBe(409);
      const text = await res.text();
      expect(text, what).toMatch(/could not be opened/);
      expect(text, what).not.toMatch(/data:image|base64/);
    };

    const changed = Buffer.from(good);
    changed[Math.floor(changed.length / 2)] = changed[Math.floor(changed.length / 2)]! ^ 0x01;
    files.set(row.drive_file_id, changed);
    await refusedToOpen("one byte changed");

    /* Another guest's bundle, valid and under the same password, put in its place. */
    await sendDetails(otherLink, otherUnlock);
    expect((await send(otherLink, otherUnlock, { front: jpeg("somebody-else") })).status).toBe(200);
    files.set(row.drive_file_id, files.get((await storedRow(otherStayId))!.drive_file_id)!);
    await refusedToOpen("a swapped file");

    files.set(row.drive_file_id, good);
    expect((await view(deskId, row.id)).status, "the right file opens again").toBe(200);
    process.env["ID_PHOTO_PASSWORD_5EL"] = "AnotherMadeUpPassword0987654321";
    await refusedToOpen("the password changed");
  });

  it("says the photo cannot be fetched when Drive is down, and still shows the typed details", async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const row = (await storedRow())!;
    storeDown = true;
    const res = await view(deskId, row.id);
    expect(res.status).toBe(503);
    expect(await said(res)).toMatch(/cannot be fetched right now/);
    const list = await asStaff(deskId, "/5EL/online-checkin");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { waiting: { reference: string }[] }).waiting.map((w) => w.reference)).toContain("GIP-1");
    const waiting = (await sql("select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId])).rows[0].id;
    expect((await asStaff(deskId, `/5EL/online-checkin/submissions/${waiting}/confirm`, "POST", {})).status, "check-in is not held up").toBe(200);
  });

  it("lets the desk remove an unmasked one: gone from Drive, who and why kept, and the guest is told", async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const row = (await storedRow())!;
    const remove = (body: unknown) => asStaff(deskId, `/5EL/online-checkin/id-photos/${row.id}/remove`, "POST", body);

    expect((await remove({})).status, "a reason is asked for").toBe(400);
    expect((await remove({ reason: "because" })).status, "one of the desk's three").toBe(400);
    const res = await remove({ reason: "not_masked" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ removed: true, deletedFromDrive: true });

    expect(files.has(row.drive_file_id)).toBe(false);
    expect((await rowsOf())[0]).toMatchObject({ status: "removed", removed_reason: "not_masked", removed_by: deskId, delete_failed: false });
    expect((await view(deskId, row.id)).status, "and nobody opens it again").toBe(403);
    expect((await view(ownerId, row.id)).status, "not even the owner: it is gone").toBe(404);

    const state = (await (await asGuest(`/${link}/id-photo`, "GET", undefined, unlock)).json()) as { sent: unknown; removed: string; maySend: boolean };
    expect(state.sent).toBeNull();
    expect(state.removed).toBe("The front desk removed your photo because the Aadhaar number was not covered. "
      + "Send it again with the first 8 digits hidden.");
    expect(state.maySend, "and they may send another").toBe(true);
  });
});

describe("a kept photo", () => {
  const keep = async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const waiting = (await sql("select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId])).rows[0].id;
    expect((await asStaff(deskId, `/5EL/online-checkin/submissions/${waiting}/confirm`, "POST", {})).status).toBe(200);
    return (await storedRow())!;
  };
  const kept = async (who: string) => asStaff(who, "/5EL/online-checkin/id-photos");

  it("is seen only by the owner, an administrator and the GM once the desk has confirmed", async () => {
    const row = await keep();
    expect((await asStaff(deskId, `/5EL/online-checkin/id-photos/${row.id}`)).status, "reception no longer").toBe(403);
    expect((await kept(deskId)).status).toBe(403);
    for (const who of [gmId, ownerId]) {
      expect((await asStaff(who, `/5EL/online-checkin/id-photos/${row.id}`)).status).toBe(200);
      const list = (await (await kept(who)).json()) as { photos: { id: string; reference: string; addedBy: string | null }[] };
      expect(list.photos.map((p) => [p.id, p.reference, p.addedBy])).toEqual([[row.id, "GIP-1", null]]);
    }
    const { rows } = await sql("select viewed_by::text from guest_id_photo_views where photo_id = $1 order by viewed_at", [row.id]);
    expect(rows.map((r) => r.viewed_by)).toEqual([gmId, ownerId]);
  });

  it("stays kept when the desk sets the details aside", async () => {
    expect((await send(link, unlock)).status).toBe(200);
    const waiting = (await sql("select id::text from guest_detail_submissions where reservation_id = $1 and status = 'waiting'", [stayId])).rows[0].id;
    expect((await asStaff(deskId, `/5EL/online-checkin/submissions/${waiting}/set-aside`, "POST", {})).status).toBe(200);
    const row = (await storedRow())!;
    expect(files.has(row.drive_file_id)).toBe(true);
    expect(((await (await kept(gmId)).json()) as { photos: { id: string }[] }).photos.map((p) => p.id)).toEqual([row.id]);
  });

  it("is deleted only by a keeper, with a reason; and Drive refusing is shown, and tried again", async () => {
    const row = await keep();
    const remove = (who: string, body: unknown) => asStaff(who, `/5EL/online-checkin/id-photos/${row.id}/remove`, "POST", body);
    expect((await remove(deskId, { reason: "the guest asked" })).status).toBe(403);
    expect((await remove(gmId, { reason: "" })).status, "a reason is asked for").toBe(400);

    deleteRefused = true;
    const first = await remove(gmId, { reason: "the guest asked for it to be deleted" });
    expect(await first.json()).toEqual({ removed: true, deletedFromDrive: false });
    expect((await rowsOf())[0]).toMatchObject({
      status: "removed", removed_by: gmId, delete_failed: true,
      removed_reason: "deleted: the guest asked for it to be deleted",
    });
    let list = (await (await kept(ownerId)).json()) as { photos: { id: string; notYetDeleted: boolean }[] };
    expect(list.photos).toMatchObject([{ id: row.id, notYetDeleted: true }]);
    expect(files.has(row.drive_file_id), "still in Drive, and said so").toBe(true);

    deleteRefused = false;
    const again = await remove(ownerId, {});
    expect(await again.json()).toEqual({ removed: true, deletedFromDrive: true });
    expect(files.has(row.drive_file_id)).toBe(false);
    expect((await rowsOf())[0]).toMatchObject({ status: "removed", removed_by: gmId, delete_failed: false });
    list = (await (await kept(ownerId)).json()) as typeof list;
    expect(list.photos).toEqual([]);
  });

  it("says so at the desk when the hotel has no password", async () => {
    delete process.env["ID_PHOTO_PASSWORD_5EL"];
    const list = (await (await asStaff(ownerId, "/5EL/online-checkin")).json()) as { idPhotos: { on: boolean; off: string; keeper: boolean } };
    expect(list.idPhotos).toEqual({
      on: false, keeper: true,
      off: "ID photos are off for this hotel: its password, or the photo store, is not in the server's settings.",
    });
  });
});

describe("the desk adds one at check-in (D27-210)", () => {
  it("stores it the same way, under the clerk's name, and it is kept at once", async () => {
    const res = await deskAdds(deskId, otherStayId, { front: jpeg("at-the-desk"), back: jpeg("desk-back") });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ added: true });

    const row = (await storedRow(otherStayId))!;
    expect(row).toMatchObject({ status: "stored", by_guest: false, uploaded_by: deskId, sides: ["front", "back"] });
    const inside = openBundle(files.get(row.drive_file_id)!, PASSWORD);
    expect(inside.map((e) => e.name)).toEqual(["about.txt", "front.jpg", "back.jpg"]);
    expect(inside[0]!.bytes.toString()).toContain(`Added by: ${TAG} Desk, at the desk`);
    expect(inside[0]!.bytes.toString()).toContain("Booking: GIP-2");
    expect(inside[1]!.bytes.includes(Buffer.from(WHERE_TAKEN)), "the same stripping").toBe(false);

    /* Kept: the clerk who added it does not fetch it back; a keeper sees it. */
    expect((await asStaff(deskId, `/5EL/online-checkin/id-photos/${row.id}`)).status).toBe(403);
    const list = (await (await asStaff(gmId, "/5EL/online-checkin/id-photos")).json()) as { photos: { id: string; addedBy: string }[] };
    expect(list.photos).toMatchObject([{ id: row.id, addedBy: `${TAG} Desk` }]);
  });

  it("takes the place of one the guest sent, which goes from Drive at once", async () => {
    expect((await send(link, unlock, { front: jpeg("guests-own") })).status).toBe(200);
    const theirs = (await storedRow())!;
    expect((await deskAdds(deskId, stayId)).status).toBe(200);
    expect(files.has(theirs.drive_file_id)).toBe(false);
    expect((await rowsOf()).map((r) => [r.status, r.removed_reason, r.by_guest])).toEqual([
      ["removed", "replaced", true], ["stored", null, false]]);
  });

  it("is the desk's alone, needs the tick, the same kind of file, and a password", async () => {
    expect((await deskAdds(housekeeperId, otherStayId)).status).toBe(403);
    expect((await deskAdds(elsewhereId, otherStayId)).status).toBe(403);
    expect((await deskAdds(deskId, "00000000-0000-4000-8000-000000000000")).status).toBe(404);

    const unticked = await deskAdds(deskId, otherStayId, { front: jpeg(), agreed: false });
    expect(unticked.status).toBe(400);
    expect(await said(unticked)).toBe("Tick that the guest agreed to the hotel keeping this photo.");
    expect((await deskAdds(deskId, otherStayId, { front: Buffer.from("%PDF-1.7 not a photo") })).status).toBe(400);

    storeDown = true;
    const down = await deskAdds(deskId, otherStayId);
    expect(down.status).toBe(503);
    storeDown = false;

    delete process.env["ID_PHOTO_PASSWORD_5EL"];
    const off = await deskAdds(deskId, otherStayId);
    expect(off.status).toBe(409);
    expect(await said(off)).toMatch(/ID photos are off for this hotel/);

    expect(await rowsOf(otherStayId), "and none of those left anything").toEqual([]);
    expect(files.size).toBe(0);
  });
});
