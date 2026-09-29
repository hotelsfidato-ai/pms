import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool, withUser, type Client } from "../../../src/db.ts";
import {
  runOnce, owedNow, linkFromDatabase, KIND, LIMITS, type Due, type Limits,
} from "../../../src/modules/guest-messaging/jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SWEEP, WITH THE REAL DATABASE AND A FAKE n8n

   jobs.test.ts proves each rule with its hands replaced. This is the same
   pass as the server will run it: nobody signed in (`withUser("")`), the
   bookings read through `app.guest_messages_due`, each link minted through
   `app.guest_booking_link_issue`, and every message handed to the REAL
   sender, which posts to a receiver started here and records its own row
   in `messages_sent`. What only this can prove:

     the link in the message opens the guest's page - the hash the
       database keeps is the hash of the token the guest was sent
     a message sent is not sent again the next minute
     several rooms booked together get ONE message, about the room booked
       first, and the others are never owed on their own (D22-41)
     the first switched-on pass records the moment sending began, once,
       and a pass that is not switched on records nothing (D22-42)
     ONE BOOKING'S DATABASE FAULT DOES NOT UNDO ANOTHER'S RECORD. In one
       transaction for the whole pass, Postgres aborts every statement
       after the first error and the rollback takes the record of every
       message already sent - so the next minute sends them all again

   Its own property, removed afterwards. The pass is held to that property
   by the due list's own filter, so another file's bookings are never
   touched.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const CODE = "GMW";
const SECRET = "a-secret-that-exists-only-in-this-test-run";

let hotelId: string;
let ownerId: string;
const guests: string[] = [];
const booking = new Map<string, string>();

let server: Server;
let received: Array<{ kind: string; channel: string; data: Record<string, string> }> = [];

const admin = async () => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  await db.query("select set_config('app.user_id', $1, false)", [ownerId ?? ""]);
  return db;
};

const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

/** Nobody signed in - the sweep's own transaction. */
const asTheSweep = <T>(fn: (client: Client) => Promise<T>) => withUser("", fn);

/** This property's bookings only - through the sweep's own door, which
    records the switch-on moment before it asks. */
const mine = (client: Client, limits: Limits) => owedNow(client, limits, hotelId);

const began = async () => (await sql(
  "select began_at::text from guest_messaging_began")).rows[0]?.began_at as string | undefined;

beforeAll(async () => {
  const boot = new (await import("pg")).default.Client({ connectionString: SUPER });
  await boot.connect();
  ownerId = (await boot.query<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
  await boot.end();

  hotelId = (await sql(
    "select app.provision_property_unchecked($1, 'Sweep Test', 'Nowhere')::text as id",
    [CODE])).rows[0].id as string;

  /* Three guests who agreed to WhatsApp, arriving in 5, 6 and 7 days on the
     property's clock - soonest first, so the order is known. */
  for (const [i, ref] of ["GMW-1", "GMW-2", "GMW-3"].entries()) {
    const guest = (await sql(
      `insert into guests (full_name, phone) values ($1, $2) returning id::text`,
      [`Sweep Guest ${i + 1}`, `+91 98765 1000${i}`])).rows[0].id as string;
    guests.push(guest);
    const id = (await sql(
      `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                 check_in, check_out, adults, status, source,
                                 agreed_rate, whatsapp_agreed)
       select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
              (now() at time zone 'Asia/Kolkata')::date + $4::int,
              (now() at time zone 'Asia/Kolkata')::date + $4::int + 2,
              1, 'confirmed', 'direct', 1000, true
       returning id::text`, [hotelId, guest, ref, 5 + i])).rows[0].id as string;
    booking.set(ref, id);
  }

  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers["x-fidato-secret"] !== SECRET) { res.writeHead(401).end(); return; }
      received.push(JSON.parse(raw));
      res.writeHead(200).end("sent");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  const db = await admin();
  try {
    await db.query("delete from guest_messaging_began");
    await db.query("delete from guest_links where hotel_id = $1", [hotelId]);
    await db.query("delete from messages_sent where hotel_id = $1", [hotelId]);
    await db.query("delete from reservations where hotel_id = $1", [hotelId]);
    await db.query("delete from reservation_groups where name like 'GMW %'");
    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where id = any($1::uuid[])", [guests]);
    await db.query("alter table guests enable trigger guests_no_delete");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    const left = await db.query("select count(*)::int as n from hotels where code = $1", [CODE]);
    expect(left.rows[0].n).toBe(0);
  } finally { await db.end(); }
  delete process.env["CRS_N8N_URL"];
  delete process.env["M2R_N8N_URL"];
  delete process.env["CRS_N8N_SECRET"];
  delete process.env["M2R_N8N_SECRET"];
  delete process.env["GUEST_MESSAGES_PER_MINUTE"];
  await closePool();
});

beforeEach(async () => {
  received = [];
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = SECRET;
  process.env["GUEST_MESSAGES_PER_MINUTE"] = "10";
  await sql("delete from guest_links where hotel_id = $1", [hotelId]);
  await sql("delete from messages_sent where hotel_id = $1", [hotelId]);
  /* Switched on a day ago, BEFORE this file's bookings were made - so they
     are new bookings, confirmed at any hour, and no test here depends on
     the time of day it runs (D22-42). */
  await sql("delete from guest_messaging_began");
  await sql("insert into guest_messaging_began (began_at) values (now() - interval '1 day')");
});

const recorded = async () => (await sql(
  `select about_id, kind, status from messages_sent where hotel_id = $1 order by id`,
  [hotelId])).rows as Array<{ about_id: string; kind: string; status: string }>;

describe("the sweep, as the server runs it", () => {
  it("sends each owed confirmation once, with a link that opens that guest's page", async () => {
    const out = await runOnce(asTheSweep, mine);

    expect(out).toEqual({ due: 3, attempted: 3, sent: 3, nowhereToSend: 0, waiting: 0 });
    expect(received.map((m) => m.data["reference"])).toEqual(["GMW-1", "GMW-2", "GMW-3"]);
    expect(received.every((m) => m.kind === KIND.confirmation && m.channel === "whatsapp"))
      .toBe(true);

    /* The link is the guest's only way in, and the database holds only its
       hash: opening it proves the two match. */
    const token = received[0]!.data["link"]!.split("/g/")[1]!;
    const page = await app.request(`/api/guest/${token}`);
    expect(page.status).toBe(200);
    const body = await page.json() as { kind: string; booking: { reference: string } };
    expect(body.kind).toBe("booking");
    expect(body.booking.reference).toBe("GMW-1");

    const links = (await sql(
      "select origin, created_by from guest_links where hotel_id = $1", [hotelId])).rows;
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.origin === "confirmation" && l.created_by === null)).toBe(true);

    /* And the next minute, nothing: each one is recorded as sent. */
    received = [];
    expect(await runOnce(asTheSweep, mine))
      .toEqual({ due: 0, attempted: 0, sent: 0, nowhereToSend: 0, waiting: 0 });
    expect(received).toEqual([]);
  });

  it("keeps the record of the others when one booking's statement fails", async () => {
    /* A real Postgres error for the middle booking, inside the transaction
       its link is minted in. */
    const makeLink = async (client: Client, due: Due) => {
      if (due.reference === "GMW-2") await client.query("select 1 / 0");
      return linkFromDatabase(client, due);
    };

    const out = await runOnce(asTheSweep, mine, makeLink);

    expect(out).toEqual({ due: 3, attempted: 2, sent: 2, nowhereToSend: 0, waiting: 0 });
    expect((await recorded()).map((r) => r.about_id).sort())
      .toEqual([booking.get("GMW-1"), booking.get("GMW-3")].sort());

    /* So the next minute sends only the one that failed - not all three. */
    received = [];
    await runOnce(asTheSweep, mine);
    expect(received.map((m) => m.data["reference"])).toEqual(["GMW-2"]);
  });

  it("is refused a link for a booking that stopped being confirmed", async () => {
    const [due] = await asTheSweep((client) => mine(client, LIMITS));
    await sql("update reservations set status = 'cancelled' where id = $1",
      [booking.get(due!.reference)]);
    try {
      await expect(asTheSweep((client) => linkFromDatabase(client, due!)))
        .rejects.toThrow(/no longer confirmed/);
    } finally {
      await sql("update reservations set status = 'confirmed' where id = $1",
        [booking.get(due!.reference)]);
    }
    expect((await sql("select count(*)::int as n from guest_links where hotel_id = $1",
      [hotelId])).rows[0].n).toBe(0);
  });

  /* ⚠ D22-41. Three rooms booked together are one party: the owner said one
     confirmation per group, to the lead guest. */
  it("sends a group one confirmation, about the room booked first, and never the others", async () => {
    const group = (await sql(
      "insert into reservation_groups (name, lead_hotel_id) values ('GMW party', $1) returning id::text",
      [hotelId])).rows[0].id as string;
    const rooms: string[] = [];
    for (const ref of ["GMW-G1", "GMW-G2", "GMW-G3"]) {
      rooms.push((await sql(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                   check_in, check_out, adults, status, source,
                                   agreed_rate, whatsapp_agreed, group_id)
         select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
                (now() at time zone 'Asia/Kolkata')::date + 9,
                (now() at time zone 'Asia/Kolkata')::date + 11,
                1, 'confirmed', 'direct', 1000, true, $4
         returning id::text`, [hotelId, guests[0], ref, group])).rows[0].id as string);
    }
    try {
      await runOnce(asTheSweep, mine);
      const forTheGroup = received.filter((m) => m.data["reference"]!.startsWith("GMW-G"));
      expect(forTheGroup.map((m) => m.data["reference"])).toEqual(["GMW-G1"]);

      /* Covered: the next minute owes the group nothing - not even once the
         room the message was about is cancelled. */
      await sql("update reservations set status = 'cancelled' where id = $1", [rooms[0]]);
      received = [];
      await runOnce(asTheSweep, mine);
      expect(received.filter((m) => m.data["reference"]!.startsWith("GMW-G"))).toEqual([]);
    } finally {
      await sql("delete from guest_links where reservation_id = any($1::uuid[])", [rooms]);
      await sql("delete from messages_sent where about_id = any($1::text[])", [rooms]);
      await sql("delete from reservations where id = any($1::uuid[])", [rooms]);
      await sql("delete from reservation_groups where id = $1", [group]);
    }
  });
});

describe("the moment sending began (D22-42)", () => {
  it("is recorded by the first switched-on pass, and never moved by a later one", async () => {
    await sql("delete from guest_messaging_began");
    await runOnce(asTheSweep, mine);
    const first = await began();
    expect(first).toBeTruthy();
    expect((await sql("select now() - began_at < interval '1 minute' as fresh from guest_messaging_began"))
      .rows[0].fresh).toBe(true);

    await runOnce(asTheSweep, mine);
    expect(await began()).toBe(first);
  });

  it("is not recorded by a pass that is not switched on", async () => {
    await sql("delete from guest_messaging_began");
    delete process.env["GUEST_MESSAGES_PER_MINUTE"];
    await runOnce(asTheSweep, mine);
    delete process.env["CRS_N8N_URL"];
    delete process.env["M2R_N8N_URL"];
    process.env["GUEST_MESSAGES_PER_MINUTE"] = "10";
    await runOnce(asTheSweep, mine);
    expect(await began()).toBeUndefined();
  });
});
