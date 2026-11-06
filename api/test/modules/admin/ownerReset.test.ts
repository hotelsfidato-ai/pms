import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S FULL RESET, THE API'S HALF (D27-342, D27-365 (3))

   The database's half - the list, the guards lifted, the login that may do
   nothing else - is db/tests/modules/admin.sql. Here: who may press it (one
   e-mail, never a role), the settings it refuses without, the typed code, a
   guest checked in, the backup first and nothing cleared without one, all or
   nothing, today's date, the invoice numbers carrying on, the audit line,
   and the window's count being the script's own dry run.

   The reset login is reached as the real one is (RESET_DATABASE_URL), here
   the superuser's connection put into pms_owner_reset at sign-in, so every
   privilege is the login's own. The server's backup is stood in for by a
   socket that answers as `fidato-backup` does.

   THE ID PHOTOS (D27-379): the guests' ID photo files in Google Drive go
   too - only after the clear has committed, never another hotel's, none
   for a refused or undone clear, and one Drive would not delete is said
   and kept for the next try. The photo store (the CRS's n8n, and Drive
   behind it) is stood in for by a server here, as guestIdPhoto.test.ts
   does; nothing reaches Google.

   Builds its own real hotels (ORA, cleared; ORB, another hotel with an ID
   photo of its own) and removes them after.
   ══════════════════════════════════════════════════════════════════ */

const { app } = await import("../../../src/server.ts");
const { closePool } = await import("../../../src/db.ts");
const { retryListed } = await import("../../../src/modules/admin/ownerReset.ts");

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const RUN = Date.now();
const RESETTER = `reset-owner-${RUN}@fidato.in`;
let resetter: string;     // the e-mail the setting names; no role anywhere
let groupOwner: string;   // owner@fidato.in: a group administrator
let hotelOwner: string;   // the Owner role at ORA
let hotelAdmin: string;   // the Admin role at ORA
let ora: string;
let fy: string;

/* ── The stand-in for the server's backup ─────────────────────────── */
const SOCKET = process.platform === "win32"
  ? `\\\\.\\pipe\\fidato-owner-reset-${process.pid}`
  : join(tmpdir(), `fidato-owner-reset-${process.pid}.sock`);
let backups = 0;
let backupSays = "";
const OK_BACKUP =
  "-- backing up fidato ------------------------------------------\n"
  + "\x1b[32m  ✓ fidato-20261028-101500.dump  (812 KB)\x1b[0m\n"
  + "\x1b[32m  ✓ copied off the box, checksum matched\x1b[0m\n"
  + "/var/backups/fidato/fidato-20261028-101500.dump\n";
let server: Server;

/* ── The stand-in for the photo store (n8n, and Drive behind it) ─────
   Each delete asked for is written down with whether ORA's clear had
   committed at that moment (its bookings gone, read on another connection). */
const STORE_SECRET = "owner-reset-store-secret";
let store: HttpServer;
let drive: Set<string>;                     // the files "in Drive"
let refuse = new Set<string>();             // the files Drive will not delete
let deletes: { fileId: string; hotel: string; committed: boolean }[] = [];
const listed = async () => (await sql(
  "select drive_file_id from owner_reset.id_photos_in_drive where hotel_id in ($1, $2) order by 1",
  [ora, orb])).rows.map((r) => r.drive_file_id as string);
let orb: string;

const call = (by: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "x-dev-staff-id": by, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
/** What the routes answer, as far as these tests read it. */
type Body = {
  error?: string; refusal?: string | null; tables?: unknown; guests?: number;
  removed?: number; businessDate?: string; backup?: unknown; idPhotos?: unknown;
};
const body = async (res: Response) => (await res.json()) as Body;
const clear = (by: string, confirm?: unknown) =>
  call(by, "POST", "/api/admin/hotels/ORA/owner-reset", confirm === undefined ? {} : { confirm });
const bookings = async () =>
  Number((await sql("select count(*) from reservations where hotel_id = $1", [ora])).rows[0].count);

beforeAll(async () => {
  server = createServer((socket) => { backups += 1; socket.end(backupSays); });
  await new Promise<void>((done) => server.listen(SOCKET, done));
  store = createHttpServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", async () => {
      const answer = (status: number, body: unknown) =>
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.headers["x-fidato-secret"] !== STORE_SECRET) return answer(401, { error: "no secret" });
      const call = JSON.parse(raw) as { action: string; hotel: string; fileId: string };
      if (call.action !== "delete") return answer(400, { error: "only deletes here" });
      deletes.push({ fileId: call.fileId, hotel: call.hotel, committed: (await bookings()) === 0 });
      if (refuse.has(call.fileId)) return answer(502, { ok: false, error: "Drive answered 500 to the delete." });
      drive.delete(call.fileId);
      return answer(200, { ok: true, deleted: true });
    });
  });
  await new Promise<void>((done) => store.listen(0, "127.0.0.1", done));

  groupOwner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  await sql(`begin;
    select set_config('app.user_id', '${groupOwner}', true);
    select app.provision_property_unchecked('ORA', 'Owner Reset Hotel', 'Nowhere');
    commit;`);
  ora = (await sql("select id::text from hotels where code = 'ORA'")).rows[0].id;
  const person = async (email: string, name: string) => (await sql(
    `insert into staff (email, full_name, long_password) values ($1, $2, true)
     on conflict (email) do update set is_active = true returning id::text`, [email, name])).rows[0].id;
  resetter = await person(RESETTER, "The Resetter");
  hotelOwner = await person(`ora-owner-${RUN}@fidato.in`, "ORA Owner");
  hotelAdmin = await person(`ora-admin-${RUN}@fidato.in`, "ORA Admin");
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $3, 'owner'), ($2, $3, 'admin')",
    [hotelOwner, hotelAdmin, ora]);

  /* A few days of trade: a stay with a closed day behind it, a payment, an
     invoice issued, and a guest who stayed nowhere else. */
  fy = (await sql("select app.current_fin_year($1) as fy", [ora])).rows[0].fy;
  await sql(`do $$
    declare h uuid := '${ora}'; rt uuid; rm uuid; g uuid; stay uuid; fol uuid; pid bigint; bd date;
    begin
      select id into rt from room_types where hotel_id = h order by code limit 1;
      insert into rooms (hotel_id, room_type_id, number) values (h, rt, '101') returning id into rm;
      bd := app.business_date(h);
      insert into guests (full_name, phone) values ('ORA Only Guest', '9822200001') returning id into g;
      insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
      values (h, app.next_reference(h), g, rt, bd - 1, bd, 3000, 'checked_out') returning id into stay;
      insert into folios (hotel_id, reservation_id) values (h, stay) returning id into fol;
      insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
      values (h, fol, bd - 1, 'room', 'Room 101 · 1 night', 3000, 12, 360);
      insert into night_audit_runs (hotel_id, business_date, status, completed_at)
      values (h, bd - 1, 'completed', now());
      insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
      values (h, fol, bd, 'payment', 'Cash', -3360) returning id into pid;
      insert into payments (hotel_id, posting_id, method, amount) values (h, pid, 'cash', 3360);
      insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
      values (h, fol, '${fy}', app.next_invoice_number(h, '${fy}'), 'ORA Only Guest', 3360, 360);
      update rooms set occupancy_status = 'occupied', housekeeping_status = 'dirty' where id = rm;
      -- set back to a day in the past, so "today" afterwards means something
      update hotels set business_date = bd - 3 where id = h;
    end $$;`);

  /* The ID photos of ORA's stay: one kept, one removed whose Drive delete
     failed (both still in Drive), one removed and already deleted, one that
     never reached Drive. And ORB, another real hotel, with one of its own. */
  await sql(`begin;
    select set_config('app.user_id', '${groupOwner}', true);
    select app.provision_property_unchecked('ORB', 'Owner Reset Other', 'Nowhere');
    commit;`);
  orb = (await sql("select id::text from hotels where code = 'ORB'")).rows[0].id;
  await sql(`do $$
    declare b uuid := '${orb}'; rt uuid; g uuid;
    begin
      select id into rt from room_types where hotel_id = b order by code limit 1;
      insert into guests (full_name, phone) values ('ORB Only Guest', '9822200002') returning id into g;
      insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
      values (b, app.next_reference(b), g, rt, app.business_date(b) - 1, app.business_date(b), 3000, 'checked_out');
    end $$;`);
  await sql(
    `insert into guest_id_photos (hotel_id, hotel_code, reservation_id, guest_id, uploaded_by, sides,
                                  notice_version, status, stored_at, drive_file_id, cipher_sha256, cipher_bytes,
                                  removed_at, removed_reason, drive_delete_failed_at)
     select r.hotel_id, h.code, r.id, r.guest_id, $1, '{front}', 'test', x.status,
            case when x.file is not null then now() end, x.file,
            case when x.file is not null then repeat('a', 64) end, case when x.file is not null then 10 end,
            case when x.status = 'removed' then now() end, case when x.status = 'removed' then 'deleted: test' end,
            x.failed
       from reservations r join hotels h on h.id = r.hotel_id
       join (values ('ORA', 'stored',  'ora-file-1', null::timestamptz),
                    ('ORA', 'removed', 'ora-file-2', now()),
                    ('ORA', 'removed', 'ora-file-3', null),
                    ('ORA', 'pending', null,         null),
                    ('ORB', 'stored',  'orb-file-1', null)) x(code, status, file, failed) on x.code = h.code
      where h.id in ($2, $3)`, [groupOwner, ora, orb]);
  drive = new Set(["ora-file-1", "ora-file-2", "orb-file-1"]);
});

beforeEach(() => {
  process.env["RESET_OWNER_EMAIL"] = RESETTER;
  process.env["RESET_DATABASE_URL"] = `${SUPER}?options=-c%20role%3Dpms_owner_reset`;
  process.env["RESET_BACKUP_SOCKET"] = SOCKET;
  process.env["ID_PHOTO_N8N_URL"] = `http://127.0.0.1:${(store.address() as AddressInfo).port}/pms-id-photos`;
  process.env["ID_PHOTO_N8N_SECRET"] = STORE_SECRET;
  backupSays = OK_BACKUP;
  backups = 0;
  deletes = [];
});

afterAll(async () => {
  for (const name of ["RESET_OWNER_EMAIL", "RESET_DATABASE_URL", "RESET_BACKUP_SOCKET",
    "ID_PHOTO_N8N_URL", "ID_PHOTO_N8N_SECRET"]) delete process.env[name];
  await sql(`begin;
    update reservations set status = 'checked_out' where hotel_id = '${ora}' and status = 'checked_in';
    select owner_reset.clear('ORA', true, null, null);
    select owner_reset.clear('ORB', true, null, null);
    delete from owner_reset.id_photos_in_drive where hotel_id in ('${ora}', '${orb}');
    delete from staff_hotels where hotel_id in ('${ora}', '${orb}');
    alter table hotels disable trigger hotels_no_delete;
    delete from hotels where id in ('${ora}', '${orb}');
    alter table hotels enable trigger hotels_no_delete;
    commit;`).catch((e) => console.error("ownerReset cleanup:", e.message));
  await sql("update staff set is_active = false where email like $1", [`%-${RUN}@fidato.in`]);
  await new Promise<void>((done) => server.close(() => done()));
  await new Promise<void>((done) => store.close(() => done()));
  await closePool();
});

describe("whose button it is (D27-342: one e-mail, never a role)", () => {
  it("is shown to that account and to nobody else", async () => {
    expect(await (await call(resetter, "GET", "/api/admin/owner-reset")).json()).toEqual({ yours: true });
    expect(await (await call(groupOwner, "GET", "/api/admin/owner-reset")).json()).toEqual({ yours: false });
  });

  it("refuses every other account - the owner and Admin roles and a group administrator included", async () => {
    for (const who of [groupOwner, hotelOwner, hotelAdmin]) {
      const res = await clear(who, "ORA");
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "Only the owner's own account can clear a hotel." });
      const dry = await call(who, "GET", "/api/admin/hotels/ORA/owner-reset");
      expect(dry.status).toBe(403);
    }
    expect(await bookings()).toBe(1);
    expect(backups).toBe(0);
  });

  it("refuses everybody while RESET_OWNER_EMAIL is unset", async () => {
    delete process.env["RESET_OWNER_EMAIL"];
    const res = await clear(resetter, "ORA");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "Clearing a hotel is switched off on this server: no account is named for it." });
    expect(await (await call(resetter, "GET", "/api/admin/owner-reset")).json()).toEqual({ yours: false });
    expect(await bookings()).toBe(1);
  });

  it("refuses without its database login or its backup, each in a sentence", async () => {
    delete process.env["RESET_DATABASE_URL"];
    let res = await clear(resetter, "ORA");
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/RESET_DATABASE_URL/);
    process.env["RESET_DATABASE_URL"] = `${SUPER}?options=-c%20role%3Dpms_owner_reset`;
    delete process.env["RESET_BACKUP_SOCKET"];
    res = await clear(resetter, "ORA");
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/RESET_BACKUP_SOCKET/);
    expect(await bookings()).toBe(1);
  });
});

describe("before anything goes", () => {
  it("the window's count is the script's own dry run", async () => {
    const res = await call(resetter, "GET", "/api/admin/hotels/ORA/owner-reset");
    expect(res.status).toBe(200);
    const shown = await body(res);
    const script = (await sql("select owner_reset.counts('ORA', true) as d")).rows[0].d;
    expect(shown).toEqual(script);
    expect(shown).toMatchObject({
      code: "ORA", name: "Owner Reset Hotel", refusal: null,
      tables: { reservations: 1, folios: 1, folio_postings: 2, payments: 1, invoices: 1, night_audit_runs: 1,
                guest_id_photos: 4 },
      /* The two Drive still holds: not the one already deleted, not the one
         that never reached it, not ORB's. */
      idPhotos: 2,
    });
    /* Its own guest, and any guest left with no stay anywhere by the files
       before this one - a guest belongs to the group, and the sweep is the
       script's (a guest is only ever made with a booking, so on a real
       system these are this hotel's). */
    expect(shown.guests).toBeGreaterThanOrEqual(1);
  });

  it("refuses without the hotel's code typed, and takes no backup", async () => {
    for (const typed of [undefined, "", "ORB", "RESET"]) {
      const res = await clear(resetter, typed);
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe("Type the hotel's code, ORA, to confirm. Nothing was cleared.");
    }
    expect(backups).toBe(0);
    expect(await bookings()).toBe(1);
  });

  it("refuses while a guest is checked in, saying who - before the backup", async () => {
    await sql(`insert into guests (full_name) values ('Ravi Inhouse');
      insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
      select h.id, app.next_reference(h.id), (select id from guests where full_name = 'Ravi Inhouse'),
             (select id from room_types where hotel_id = h.id order by code limit 1),
             h.business_date, h.business_date + 1, 3000, 'checked_in'
        from hotels h where h.id = '${ora}';`);
    const sentence = "A guest is still checked in at Owner Reset Hotel: Ravi Inhouse. Check them out before the hotel is cleared.";
    const dry = await body(await call(resetter, "GET", "/api/admin/hotels/ORA/owner-reset"));
    expect(dry.refusal).toBe(sentence);
    const res = await clear(resetter, "ORA");
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe(sentence);
    expect(backups).toBe(0);
    expect(await bookings()).toBe(2);
    expect(deletes, "nothing asked of Drive").toEqual([]);
    expect(await listed()).toEqual([]);
    await sql("update reservations set status = 'checked_out' where hotel_id = $1 and status = 'checked_in'", [ora]);
  });

  it("refuses when the hotel has ID photos in Drive and the photo store is not set - before the backup", async () => {
    delete process.env["ID_PHOTO_N8N_URL"];
    const sentence = "Owner Reset Hotel has 2 ID photos in Google Drive, and the photo store is not in this "
      + "server's settings (ID_PHOTO_N8N_URL), so they could not be deleted. Nothing can be cleared until it is.";
    expect((await body(await call(resetter, "GET", "/api/admin/hotels/ORA/owner-reset"))).refusal).toBe(sentence);
    const res = await clear(resetter, "ORA");
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe(sentence);
    expect(backups).toBe(0);
    expect(await bookings()).toBe(2);
    expect(await listed()).toEqual([]);
  });

  it("clears nothing when the backup fails, and says what it said", async () => {
    backupSays = "\x1b[31m  x the copy off the box FAILED (HTTP 400). The file on this disk\x1b[0m\n"
      + "\x1b[31m    is fine; the copy that survives this disk does not exist.\x1b[0m\n";
    const res = await clear(resetter, "ORA");
    expect(res.status).toBe(502);
    expect((await body(res)).error).toBe(
      "The backup failed, so nothing was cleared. It said: is fine; the copy that survives this disk does not exist.");
    expect(backups).toBe(1);
    expect(await bookings()).toBe(2);
    expect(deletes, "nothing asked of Drive").toEqual([]);
  });
});

describe("the clear", () => {
  it("rolls back whole when anything in it fails", async () => {
    /* Fails at the very end, after every delete: the rooms. */
    await sql(`create or replace function public.ora_boom() returns trigger language plpgsql as $$
      begin raise exception 'ORA boom'; end $$;`);
    await sql(`create trigger ora_boom before update on rooms for each row
      when (new.hotel_id = '${ora}') execute function public.ora_boom()`);
    try {
      const res = await clear(resetter, "ORA");
      expect(res.status).toBe(500);
    } finally {
      await sql("drop trigger ora_boom on rooms; drop function public.ora_boom()");
    }
    expect(await bookings()).toBe(2);
    expect(Number((await sql("select count(*) from invoices where hotel_id = $1", [ora])).rows[0].count)).toBe(1);
    expect(Number((await sql("select count(*) from audit_log where hotel_id = $1 and action = 'OWNER_RESET'", [ora])).rows[0].count)).toBe(0);
    /* The ID photos: nothing asked of Drive, the list undone with the rest. */
    expect(deletes, "nothing asked of Drive").toEqual([]);
    expect(await listed()).toEqual([]);
    expect([...drive].sort()).toEqual(["ora-file-1", "ora-file-2", "orb-file-1"]);
    /* And every guard is back on. */
    const { rows } = await sql(
      "select count(*) from owner_reset.guards(true) g join pg_trigger t on t.tgname = g.trigger_name where t.tgenabled <> 'O'");
    expect(Number(rows[0].count)).toBe(0);
  });

  it("clears the hotel: a backup first, then today, numbers carrying on, one audit line", async () => {
    const dry = (await sql("select owner_reset.counts('ORA', true) as d")).rows[0].d;
    const series = Number((await sql(
      "select next_number from invoice_series where hotel_id = $1 and fin_year = $2", [ora, fy])).rows[0].next_number);
    expect(series).toBeGreaterThan(1);

    refuse = new Set(["ora-file-2"]);     // Drive will not delete this one
    const res = await clear(resetter, "ora");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.clone().text(), "no Drive id reaches the screen").not.toMatch(/file-/);
    const done = await body(res);
    /* The ID photos: both of ORA's asked for, only after the commit; one
       deleted, one not - said, and kept on the list. ORB's untouched. */
    expect(done.idPhotos).toEqual({ deleted: 1, notDeleted: 1 });
    expect(deletes.map((d) => d.fileId).sort()).toEqual(["ora-file-1", "ora-file-2"]);
    expect(deletes.every((d) => d.committed && d.hotel === "ORA"), JSON.stringify(deletes)).toBe(true);
    expect([...drive].sort()).toEqual(["ora-file-2", "orb-file-1"]);
    expect(await listed()).toEqual(["ora-file-2"]);
    expect(Number((await sql("select count(*) from guest_id_photos where hotel_id = $1", [orb])).rows[0].count)).toBe(1);
    expect(Number((await sql("select count(*) from guest_id_photos where hotel_id = $1", [ora])).rows[0].count)).toBe(0);
    expect(backups).toBe(1);
    expect(done.backup).toEqual({ file: "fidato-20261028-101500.dump", copiedOff: true });
    /* What went is what the dry run said would go. */
    expect(done.tables).toEqual(dry.tables);
    expect(done.guests).toBe(dry.guests);
    expect(done.removed).toBeGreaterThan(0);

    expect(await bookings()).toBe(0);
    const { rows: [after] } = await sql(
      `select h.business_date = (now() at time zone h.timezone)::date as today,
              to_char(h.business_date, 'YYYY-MM-DD') as bd,
              (select count(*) from rooms where hotel_id = h.id and (occupancy_status <> 'vacant' or housekeeping_status <> 'clean')) as unready,
              (select next_number from invoice_series where hotel_id = h.id and fin_year = $2) as series,
              (select count(*) from guests where full_name in ('ORA Only Guest', 'Ravi Inhouse')) as guests
         from hotels h where h.id = $1`, [ora, fy]);
    expect(after.today).toBe(true);
    expect(done.businessDate).toBe(after.bd);
    expect(Number(after.unready)).toBe(0);
    expect(Number(after.series)).toBe(series);
    expect(Number(after.guests)).toBe(0);
    /* The next invoice takes the next number: none is ever used twice. */
    const next = (await sql("select app.next_invoice_number($1, $2) as n", [ora, fy])).rows[0].n;
    expect(next).toMatch(new RegExp(`/${String(series).padStart(5, "0")}$`));

    const { rows: audit } = await sql(
      "select actor::text, after from audit_log where hotel_id = $1 and action = 'OWNER_RESET'", [ora]);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe(resetter);
    expect(audit[0].after).toMatchObject({
      removed: done.removed, backup: "fidato-20261028-101500.dump", by: "The Resetter", freshStart: true,
      idPhotos: 2 });
  });

  it("an ID photo Drive would not delete is counted in the next dry run, and the next clear deletes it", async () => {
    refuse = new Set();
    expect((await body(await call(resetter, "GET", "/api/admin/hotels/ORA/owner-reset"))).idPhotos).toBe(1);
    const res = await clear(resetter, "ORA");
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await body(res)).idPhotos).toEqual({ deleted: 1, notDeleted: 0 });
    expect(deletes.map((d) => d.fileId)).toEqual(["ora-file-2"]);
    expect([...drive]).toEqual(["orb-file-1"]);
    expect(await listed()).toEqual([]);
  });

  it("one Drive would not delete is asked again every hour until Drive does (D27-380)", async () => {
    await sql("insert into owner_reset.id_photos_in_drive (drive_file_id, hotel_id, hotel_code) values ('ora-retry-1', $1, 'ORA')",
      [ora]);
    drive.add("ora-retry-1");
    refuse = new Set(["ora-retry-1"]);
    expect(await retryListed()).toEqual({ deleted: 0, notDeleted: 1 });
    expect(await listed(), "still listed while Drive refuses").toEqual(["ora-retry-1"]);
    delete process.env["ID_PHOTO_N8N_URL"];
    deletes = [];
    expect(await retryListed(), "no photo store: it asks nothing").toEqual({ deleted: 0, notDeleted: 0 });
    expect(deletes).toEqual([]);
    process.env["ID_PHOTO_N8N_URL"] = `http://127.0.0.1:${(store.address() as AddressInfo).port}/pms-id-photos`;
    refuse = new Set();
    expect(await retryListed()).toEqual({ deleted: 1, notDeleted: 0 });
    expect(drive.has("ora-retry-1")).toBe(false);
    expect(await listed()).toEqual([]);
  });
});

describe("the server's script, reset-property.ts (D27-379)", () => {
  /* The script, run as the server runs it, on ORB. It reads the photo
     store's settings from api/.env when run as the API's user; without
     them it refuses, before anything is written. */
  const script = (env: NodeJS.ProcessEnv) => new Promise<{ code: number; out: string }>((done) => {
    const file = fileURLToPath(new URL("../../../scripts/reset-property.ts", import.meta.url));
    execFile(process.execPath, ["--experimental-strip-types", "--no-warnings", file, "ORB", "--fresh-start", "--yes"],
      { env, timeout: 60_000 }, (error, stdout, stderr) =>
        done({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }));
  });
  const withoutStore = () => {
    const env = { ...process.env };
    delete env["ID_PHOTO_N8N_URL"];
    delete env["ID_PHOTO_N8N_SECRET"];
    return env;
  };
  const orbBookings = async () =>
    Number((await sql("select count(*) from reservations where hotel_id = $1", [orb])).rows[0].count);

  it("refuses without the photo store, and changes nothing", async () => {
    const run = await script(withoutStore());
    expect(run.code, run.out).toBe(1);
    expect(run.out).toMatch(/and 1 ID photos in Google Drive/);
    expect(run.out).toMatch(/cannot reach the ID photo store[\s\S]*Nothing was changed\./);
    expect(await orbBookings()).toBe(1);
    expect(deletes).toEqual([]);
    expect(drive.has("orb-file-1")).toBe(true);
  });

  it("with it, deletes the ID photos after the clear, and prints counts only", async () => {
    const run = await script({ ...process.env });
    expect(run.code, run.out).toBe(0);
    expect(run.out).toMatch(/1 ID photos deleted from Google Drive/);
    expect(run.out, "no Drive id printed").not.toMatch(/file-/);
    expect(await orbBookings()).toBe(0);
    expect(deletes.map((d) => [d.fileId, d.hotel])).toEqual([["orb-file-1", "ORB"]]);
    expect(drive.has("orb-file-1")).toBe(false);
    expect(await listed()).toEqual([]);
  });
});

/* D27-381, D27-396: a hotel locked against the reset - as SHI and AMR are, by
   migration - is refused by the button and by the script, with nothing gone
   and no backup taken. A hotel of this file's own: the lock never comes off. */
describe("a hotel that can never be reset (Shimla and Amrapali)", () => {
  const sentence = "Owner Reset Locked (ORL) can never be reset: the owner locked it (D27-381).";
  let orl: string;
  const orlBookings = async () =>
    Number((await sql("select count(*) from reservations where hotel_id = $1", [orl])).rows[0].count);

  beforeAll(async () => {
    await sql(`begin;
      select set_config('app.user_id', '${groupOwner}', true);
      select app.provision_property_unchecked('ORL', 'Owner Reset Locked', 'Nowhere');
      commit;`);
    orl = (await sql("select id::text from hotels where code = 'ORL'")).rows[0].id;
    await sql(`do $$
      declare h uuid := '${orl}'; g uuid;
      begin
        insert into guests (full_name) values ('ORL Guest') returning id into g;
        insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
        values (h, app.next_reference(h), g, (select id from room_types where hotel_id = h order by code limit 1),
                app.business_date(h) - 1, app.business_date(h), 3000, 'checked_out');
        update hotels set reset_locked = true where id = h;
      end $$;`);
  });

  afterAll(async () => {
    await sql(`begin;
      delete from staff_hotels where hotel_id = '${orl}';
      alter table hotels disable trigger hotels_no_delete;
      delete from hotels where id = '${orl}';
      alter table hotels enable trigger hotels_no_delete;
      commit;`).catch((e) => console.error("ORL cleanup:", e.message));
  });

  it("the button's dry run says so, and its clear refuses before the backup", async () => {
    expect((await body(await call(resetter, "GET", "/api/admin/hotels/ORL/owner-reset"))).refusal).toBe(sentence);
    const res = await call(resetter, "POST", "/api/admin/hotels/ORL/owner-reset", { confirm: "ORL" });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe(sentence);
    expect(backups).toBe(0);
    expect(await orlBookings()).toBe(1);
  });

  it("the server's script refuses too, saying why, and changes nothing", async () => {
    const file = fileURLToPath(new URL("../../../scripts/reset-property.ts", import.meta.url));
    const run = await new Promise<{ code: number; out: string }>((done) => {
      execFile(process.execPath, ["--experimental-strip-types", "--no-warnings", file, "ORL", "--fresh-start", "--yes"],
        { env: { ...process.env }, timeout: 60_000 }, (error, stdout, stderr) =>
          done({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }));
    });
    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain(sentence);
    expect(run.out).toMatch(/Nothing was changed\./);
    expect(await orlBookings()).toBe(1);
  });

  it("and the lock is never lifted", async () => {
    await expect(sql("update hotels set reset_locked = false where code = 'ORL'"))
      .rejects.toThrow("ORL can never be reset, and that lock is not lifted (D27-381).");
  });
});
