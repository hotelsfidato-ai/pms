import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  VIEW_ROLES, MESSAGES_REFUSED,
} from "../../../src/modules/guest-messaging/messages.ts";
import { grantsFor, ASSIGNABLE_ROLES } from "../../../../src/lib/permissions.ts";
import { NOT_CONNECTED } from "../../../src/sending.ts";

/* ══════════════════════════════════════════════════════════════════
   "DID THE GUEST GET THEIR CONFIRMATION?" — the screen behind migration 117

   Three things are proved here and each of them is a refusal or a fact
   somebody at a desk depends on:

   1. THE ROLE LIST IS A COPY and copies drift. The server does not import
      the website's code, so the first test holds the two to each other and
      every role is then tried at the door.
   2. THE SCREEN IS HONEST ABOUT BEING SWITCHED OFF. An empty list means
      two completely different things - nothing has been sent, or nothing
      CAN be - and the difference is the whole of what the desk needs.
   3. NOTHING HERE WRITES `messages_sent`. The sender writes its own row
      and is the only thing that may; a second writer is a second account
      of what went. Measured, not asserted.

   The rows this file reads are put there by the superuser, the way the
   purchasing tests seed a store: this is a fixture in a scratch database
   that is dropped after the run, not the application writing a ledger.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "GMTEST";

let hotelId: string;
let guestId: string;
let reservationId: string;
let reference: string;
const staffByRole = new Map<string, string>();

const call = (staffId: string, path: string) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
  });

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true
     returning id::text`,
    [`gm-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-gm-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  return id;
};

/** One attempt, as the sender would have recorded it. `kind` is a word and
    not an enum (migration 117), so an unknown one is a real case. */
const recordOne = (over: {
  kind?: string; status?: string; aboutKind?: string; aboutId?: string;
  detail?: string; sentBy?: string | null;
} = {}) => sql(
  `insert into messages_sent
     (hotel_id, channel, kind, to_name, to_phone, to_email,
      about_kind, about_id, document_name, document_bytes, status, detail, sent_by)
   values ($1, 'whatsapp', $2, $3, '+919876543210', null,
           $4, $5, null, null, $6, $7, $8)
   returning id::text`,
  [hotelId, over.kind ?? "booking-confirmation", `${TAG} Mr Sharma`,
   over.aboutKind ?? "reservation", over.aboutId ?? reservationId,
   over.status ?? "sent", over.detail ?? `${TAG} the receiver took it (200).`,
   over.sentBy ?? null]);

const countRows = async () => Number((await sql(
  "select count(*)::int as n from messages_sent where to_name like $1", [`${TAG}%`],
)).rows[0].n);

beforeAll(async () => {
  const { rows: hotels } = await sql(
    "select id::text from hotels where code = $1", [HOTEL]);
  hotelId = hotels[0].id as string;

  /* THE FILE'S OWN BOOKING, removed in afterAll. "The latest 5EL booking"
     was a tie between every demo booking (one transaction, one created_at),
     settled by row order - and it could land on the stay
     guestDoorBehindTheCode.test.ts sends seven codes about, rows that stay. */
  guestId = (await sql(
    "insert into guests (full_name) values ($1) returning id::text", [`${TAG} guest`])).rows[0].id as string;
  const { rows: stays } = await sql(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                               check_in, check_out, adults, status, source, agreed_rate)
     select $1, $2, (select id from room_types where hotel_id = $1 limit 1), 'GMT-1',
            (now() at time zone 'Asia/Kolkata')::date + 20,
            (now() at time zone 'Asia/Kolkata')::date + 21,
            1, 'confirmed', 'direct', 1000
     returning id::text, reference`, [hotelId, guestId]);
  reservationId = stays[0].id as string;
  reference = stays[0].reference as string;

  for (const role of ASSIGNABLE_ROLES) staffByRole.set(role, await person(role));
});

afterAll(async () => {
  /* Undone, and MEASURED (MEMORY 292). `messages_sent` is append-only to the
     application on purpose, so only the scratch database's superuser can take
     these out - and the scratch database is dropped after the run anyway. */
  await sql("delete from messages_sent where to_name like $1", [`${TAG}%`]);
  expect(await countRows()).toBe(0);
  await sql("delete from reservations where id = $1", [reservationId]);
  await sql("alter table guests disable trigger guests_no_delete");
  await sql("delete from guests where id = $1", [guestId]);
  await sql("alter table guests enable trigger guests_no_delete");
  for (const id of staffByRole.values()) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

beforeEach(async () => {
  delete process.env["N8N_SEND_URL"];
  delete process.env["N8N_SEND_SECRET"];
  await sql("delete from messages_sent where to_name like $1", [`${TAG}%`]);
});

const connected = () => {
  process.env["N8N_SEND_URL"] = "http://127.0.0.1:1/pms-send";
  process.env["N8N_SEND_SECRET"] = "not-used-here-nothing-is-really-sent";
};

describe("who may see what was sent to a guest", () => {
  it("VIEW_ROLES is the website's matrix for `reservation`, exactly", () => {
    /* The server cannot import the website's code, so this list is a copy.
       A role given the grant in one place and not the other fails here
       rather than failing a person. */
    const fromMatrix = ASSIGNABLE_ROLES
      .filter((r) => grantsFor(r, "reservation").includes("view"))
      .sort();
    expect([...VIEW_ROLES].sort()).toEqual(fromMatrix);
  });

  it("opens for every role the matrix grants, and refuses every other", async () => {
    for (const role of ASSIGNABLE_ROLES) {
      const res = await call(staffByRole.get(role)!, "/guest-messages");
      const mayLook = grantsFor(role, "reservation").includes("view");
      expect([role, res.status]).toEqual([role, mayLook ? 200 : 403]);
      if (!mayLook) {
        const body = await res.json() as { reason?: string };
        expect(body.reason, role).toBe(MESSAGES_REFUSED);
      }
    }
  });

  it("refuses a property that does not exist", async () => {
    const res = await app.request("/api/hotels/ZZZ/guest-messages", {
      headers: { "x-dev-staff-id": staffByRole.get("gm")! },
    });
    expect(res.status).toBe(404);
  });
});

describe("the screen is honest about being switched off", () => {
  it("says why nothing is there, in the sender's own words", async () => {
    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as { connected: boolean; notConnected: string | null };

    expect(body.connected).toBe(false);
    expect(body.notConnected).toBe(NOT_CONNECTED);
  });

  it("stops saying so once the owner has connected n8n", async () => {
    connected();
    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as { connected: boolean; notConnected: string | null };

    expect(body.connected).toBe(true);
    expect(body.notConnected).toBe(null);
  });
});

describe("what was sent", () => {
  it("names the booking it was about, so the desk can answer for it", async () => {
    await recordOne();
    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as {
      messages: Array<{
        kind: string; kindLabel: string; status: string;
        sentBy: string | null; byAPerson: boolean;
        about: { kind: string; id: string; reference: string | null } | null;
      }>;
    };
    const mine = body.messages.find((m) => m.about?.id === reservationId)!;

    expect(mine.kind).toBe("booking-confirmation");
    expect(mine.kindLabel).toBe("Booking confirmation");
    expect(mine.status).toBe("sent");
    expect(mine.about!.reference).toBe(reference);
    /* Nobody pressed a button, and the screen must be able to say so. */
    expect(mine.sentBy).toBe(null);
    expect(mine.byAPerson).toBe(false);
  });

  /* ⚠ FOUND BY OPENING THE SCREEN, NOT BY A TEST (19 September). `staff` is
     row-secured, so a reader who may not see a colleague gets a null NAME
     for a message that colleague sent - and the screen printed "The system"
     for it, which says nobody did something a person did. "Was it the system
     or was it one of us?" is the question this column exists to answer, and
     it was answering it wrongly for anybody but the sender's own peers.

     `sent_by` itself is on `messages_sent`, which this reader can already
     see, so the fact that A person sent it is not a widening - only the
     name is withheld, exactly as it was before. */
  it("says a person sent it even where it cannot say which person", async () => {
    const hidden = staffByRole.get("chef")!;
    await recordOne({ kind: "bill", sentBy: hidden });

    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as {
      messages: Array<{ kind: string; sentBy: string | null; byAPerson: boolean }>;
    };
    const bill = body.messages.find((m) => m.kind === "bill")!;

    expect(bill.byAPerson).toBe(true);
    /* Whether the NAME comes back depends on who may see whom, and that is
       not this service's rule to make. What must never happen is `byAPerson`
       being false for a row a person is on. */
  });

  it("shows a kind nobody has a word for as itself, not as nothing", async () => {
    await recordOne({ kind: "something-nobody-has-named-yet" });
    const res = await call(staffByRole.get("gm")!, "/guest-messages");
    const body = await res.json() as { messages: Array<{ kindLabel: string }> };

    expect(body.messages.map((m) => m.kindLabel))
      .toContain("something-nobody-has-named-yet");
  });

  it("narrows to one booking when asked for one", async () => {
    await recordOne();
    await recordOne({ aboutId: "00000000-0000-0000-0000-000000000000" });

    const res = await call(
      staffByRole.get("front_desk")!, `/guest-messages?reservation=${reservationId}`);
    const body = await res.json() as { messages: Array<{ about: { id: string } | null }> };

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.about!.id).toBe(reservationId);
  });

  /* ⚠ `about_id` IS TEXT AND IS NOT ALWAYS A BOOKING (migration 117 joins it
     loosely on purpose). Casting the column to uuid in a join raises on the
     first row that is none of them - and it would be a purchase order, in
     somebody else's service, that took this screen down. */
  it("survives a row that is about something which is not a booking at all", async () => {
    await recordOne({ aboutKind: "purchase_order", aboutId: "PO/2026/00017" });

    const res = await call(staffByRole.get("gm")!, "/guest-messages");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      messages: Array<{ about: { kind: string; reference: string | null } | null }>;
    };
    const order = body.messages.find((m) => m.about?.kind === "purchase_order")!;
    expect(order.about!.reference).toBe(null);
  });

  /* ⚠ THE ROW THAT FOUND THE FAULT, and it is deterministic where the one
     above was luck. 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-' is 36 characters
     of hex and dashes, so it passed the first guard written here - and the
     uuid cast still refuses it. The row also says it IS about a reservation,
     so the kind check does not save the query either. Before the `case`, this
     answered 500. */
  it("survives a booking id that is the right shape and is not a uuid", async () => {
    await recordOne({ aboutId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-" });

    const res = await call(staffByRole.get("gm")!, "/guest-messages");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      messages: Array<{ about: { id: string; reference: string | null } | null }>;
    };
    const bad = body.messages
      .find((m) => m.about?.id === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-")!;
    expect(bad.about!.reference).toBe(null);
  });
});

/* ⚠ MSG-3. Nothing is recorded where nothing was attempted, so a booking the
   sweep cannot send to used to leave no trace: the desk had no way to learn
   that this guest will never get a confirmation. The list is the sweep's own
   answer, filtered by the sweep's own `channelFor` - so an unticked number
   with no email (D21-72) is on it, and a ticked number or an email is not. */
describe("the bookings no message can reach (MSG-3)", () => {
  const made = new Map<string, string>();
  const people: string[] = [];

  beforeAll(async () => {
    const cases: Array<[string, string | null, string | null, boolean]> = [
      ["GMQ-1", null, null, false],
      ["GMQ-2", "+91 98765 20002", null, false],
      ["GMQ-3", "+91 98765 20003", "gmq3@example.com", false],
      ["GMQ-4", "+91 98765 20004", null, true],
    ];
    for (const [ref, phone, email, agreed] of cases) {
      const guest = (await sql(
        "insert into guests (full_name, phone, email) values ($1, $2, $3) returning id::text",
        [`${TAG} ${ref}`, phone, email])).rows[0].id as string;
      people.push(guest);
      made.set(ref, (await sql(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                   check_in, check_out, adults, status, source,
                                   agreed_rate, whatsapp_agreed)
         select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
                (now() at time zone 'Asia/Kolkata')::date + 20,
                (now() at time zone 'Asia/Kolkata')::date + 21,
                1, 'confirmed', 'direct', 1000, $4
         returning id::text`, [hotelId, guest, ref, agreed])).rows[0].id as string);
    }
  });

  afterAll(async () => {
    await sql("delete from reservations where id = any($1::uuid[])", [[...made.values()]]);
    await sql("alter table guests disable trigger guests_no_delete");
    await sql("delete from guests where id = any($1::uuid[])", [people]);
    await sql("alter table guests enable trigger guests_no_delete");
  });

  type Listed = { unreachable: Array<{ reference: string; guest: string; why: string; checkIn: string }> };

  it("lists each booking nobody can be sent to, and why", async () => {
    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as Listed;
    const ours = body.unreachable.filter((u) => u.reference.startsWith("GMQ-"));

    expect(ours.map((u) => [u.reference, u.why])).toEqual([
      ["GMQ-1", "No telephone number and no email address"],
      ["GMQ-2", "Not agreed to WhatsApp, and no email address"],
    ]);
    expect(ours[0]!.guest).toBe(`${TAG} GMQ-1`);
  });

  it("lists them while nothing can be sent yet, so they are fixed before", async () => {
    const res = await call(staffByRole.get("front_desk")!, "/guest-messages");
    const body = await res.json() as Listed & { connected: boolean };
    expect(body.connected).toBe(false);
    expect(body.unreachable.some((u) => u.reference === "GMQ-1")).toBe(true);
  });

  /* Looking is not switching on: only the sweep records the moment sending
     began (D22-42). A screen that did would turn every booking made after
     somebody opened it into a "new" one. */
  it("records no switch-on moment by being looked at", async () => {
    await sql("delete from guest_messaging_began");
    await call(staffByRole.get("front_desk")!, "/guest-messages");
    expect((await sql("select count(*)::int as n from guest_messaging_began")).rows[0].n).toBe(0);
  });

  it("narrows to one booking with the rest of the screen", async () => {
    const res = await call(staffByRole.get("front_desk")!,
      `/guest-messages?reservation=${made.get("GMQ-2")}`);
    const body = await res.json() as Listed;
    expect(body.unreachable.map((u) => u.reference)).toEqual(["GMQ-2"]);
  });
});

/* ⚠ D22-41. A group is sent one confirmation, about its lead booking. Asked
   about any other room of the group, "was it sent?" is answered by that
   message - the room is covered by it, not forgotten. */
describe("a group's rooms share its messages (D22-41)", () => {
  let group: string;
  const rooms: string[] = [];

  beforeAll(async () => {
    group = (await sql(
      "insert into reservation_groups (name, lead_hotel_id) values ($1, $2) returning id::text",
      [`${TAG} party`, hotelId])).rows[0].id as string;
    const guest = (await sql(
      "insert into guests (full_name) values ($1) returning id::text", [`${TAG} party guest`]))
      .rows[0].id as string;
    for (const ref of ["GMP-1", "GMP-2"]) {
      rooms.push((await sql(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                   check_in, check_out, adults, status, source,
                                   agreed_rate, group_id)
         select $1, $2, (select id from room_types where hotel_id = $1 limit 1), $3,
                (now() at time zone 'Asia/Kolkata')::date + 30,
                (now() at time zone 'Asia/Kolkata')::date + 31,
                1, 'confirmed', 'direct', 1000, $4
         returning id::text`, [hotelId, guest, ref, group])).rows[0].id as string);
    }
  });

  afterAll(async () => {
    const guests = (await sql("select guest_id::text as id from reservations where id = any($1::uuid[])",
      [rooms])).rows.map((r) => r.id as string);
    await sql("delete from reservations where id = any($1::uuid[])", [rooms]);
    await sql("delete from reservation_groups where id = $1", [group]);
    await sql("alter table guests disable trigger guests_no_delete");
    await sql("delete from guests where id = any($1::uuid[])", [guests]);
    await sql("alter table guests enable trigger guests_no_delete");
  });

  it("shows the lead's confirmation when asked about another room", async () => {
    await recordOne({ aboutId: rooms[0]! });
    const res = await call(staffByRole.get("front_desk")!, `/guest-messages?reservation=${rooms[1]}`);
    const body = await res.json() as {
      messages: Array<{ about: { id: string; reference: string | null } | null }>;
    };
    expect(body.messages.map((m) => m.about?.reference)).toEqual(["GMP-1"]);
  });

  it("lists a group nobody can be sent to once, by its lead, for any of its rooms", async () => {
    const all = await (await call(staffByRole.get("front_desk")!, "/guest-messages")).json() as {
      unreachable: Array<{ reference: string }>;
    };
    expect(all.unreachable.filter((u) => u.reference.startsWith("GMP-")).map((u) => u.reference))
      .toEqual(["GMP-1"]);
    const one = await (await call(staffByRole.get("front_desk")!,
      `/guest-messages?reservation=${rooms[1]}`)).json() as { unreachable: Array<{ reference: string }> };
    expect(one.unreachable.map((u) => u.reference)).toEqual(["GMP-1"]);
  });
});

describe("this door never writes", () => {
  it("leaves the record exactly as it found it", async () => {
    await recordOne();
    const before = await countRows();

    await call(staffByRole.get("gm")!, "/guest-messages");
    await call(staffByRole.get("front_desk")!, `/guest-messages?reservation=${reservationId}`);
    await call(staffByRole.get("chef")!, "/guest-messages");

    expect(await countRows()).toBe(before);
  });
});
