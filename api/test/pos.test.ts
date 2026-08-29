import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { hashKey, issueKey } from "../src/routes/pos.ts";

/* ══════════════════════════════════════════════════════════════════
   POS BRIDGE — what the PMS promises a point of sale

   The POS is built elsewhere. These tests assert the four promises it
   is entitled to rely on, and each one exists because getting it
   wrong costs real money at a real front desk:

     · a retry after a timeout does not charge twice
     · a bill takes the HOTEL's operating day, not the POS's clock
     · a void reverses; the ledger keeps both rows and nets to zero
     · a room with two open folios is REFUSED, not guessed at

   The last one was found by running the thing: on 25 August the demo
   property has a same-day changeover in room 201 — one guest due out,
   one already in, both checked in. The first version of this bridge
   took whichever row Postgres returned first.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let key: string;
let hotelId: string;
let outletId: string;

/** Unique per run, so re-running never collides with its own history. */
const ref = (n: string) => `TEST-${process.pid}-${n}`;

beforeAll(async () => {
  const db = await admin();
  try {
    const h = await db.query<{ id: string }>(
      "select id from hotels where code = '5EL'",
    );
    hotelId = h.rows[0]!.id;

    const staff = await db.query<{ id: string }>(
      `insert into staff (email, full_name, is_group_admin)
       values ('pos+test@fidatohotels.com', 'POS test outlet', false)
       on conflict (email) do update set full_name = excluded.full_name
       returning id`,
    );
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role)
       values ($1, $2, 'pos')
       on conflict (staff_id, hotel_id) do update set role = 'pos'`,
      [staff.rows[0]!.id, hotelId],
    );

    key = issueKey();
    const outlet = await db.query<{ id: string }>(
      `insert into pos_outlets (hotel_id, code, name, category, staff_id,
                                api_key_hash)
       values ($1, 'TESTPOS', 'Test outlet', 'food', $2, $3)
       on conflict (hotel_id, code)
         do update set api_key_hash = excluded.api_key_hash,
                       staff_id = excluded.staff_id
       returning id`,
      [hotelId, staff.rows[0]!.id, hashKey(key)],
    );
    outletId = outlet.rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  /* Void everything this run posted.

     Without this the charges accumulate on real guest folios — ₹3,635
     of them after two runs — and every report that sums extras drifts
     away from the eZee export the demo exists to reconcile against.
     The suite was green the whole time, because nothing measured it.

     Voided, not deleted: the ledger is append-only and a trigger
     enforces it. The row count rises and the NET returns to zero,
     which is what "undone" means here. */
  for (const r of posted) {
    try { await post(`/tickets/${r}/void`); } catch { /* already gone */ }
  }

  const db = await admin();
  try {
    /* The charges this outlet raised, and their reversals.

       The first version of this query joined folio_postings to
       pos_tickets on `t.outlet_id = $1` with no correlation between
       the two — a cross join. Every posting was summed once per
       ticket, and it reported -367,575 against a ledger that was
       actually balanced. The cleanup was fine; the measurement was
       nonsense, which is its own kind of false alarm. */
    const { rows } = await db.query<{ net: string }>(
      `select coalesce(sum(amount), 0)::text as net
         from folio_postings
        where id in (
          select posting_id from pos_tickets
           where outlet_id = $1 and posting_id is not null
          union all
          select void_posting_id from pos_tickets
           where outlet_id = $1 and void_posting_id is not null
        )`,
      [outletId],
    );
    /* Asserted, not assumed. A cleanup nobody measures is a cleanup
       nobody knows failed. */
    expect(
      Number(rows[0]!.net),
      "POS test charges are still live on guest folios. Every report that " +
        "sums extra charges has drifted.",
    ).toBe(0);
  } finally {
    await db.end();
  }

  await closePool();
});

/** Every bill this run posted, so afterAll can undo all of them. */
const posted = new Set<string>();

const post = (path: string, body?: unknown) => {
  const ref = (body as { ticketRef?: string } | undefined)?.ticketRef;
  if (ref) posted.add(ref);
  return app.request(`/api/pos${path}`, {
    method: "POST",
    headers: { "x-pos-key": key, "content-type": "application/json" },
    /* A void carries no body. Spread rather than `body: undefined`,
       because exactOptionalPropertyTypes distinguishes "absent" from
       "present and undefined" — and here they mean different requests. */
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};

const get = (path: string) =>
  app.request(`/api/pos${path}`, { headers: { "x-pos-key": key } });

/* ── The gate ─────────────────────────────────────────────────────── */

describe("a POS is a caller, and callers are authenticated", () => {
  it("refuses a request with no key", async () => {
    const res = await app.request("/api/pos/rooms");
    expect(res.status).toBe(401);
  });

  it("refuses a key that is not an outlet's", async () => {
    const res = await app.request("/api/pos/rooms", {
      headers: { "x-pos-key": issueKey() },
    });
    expect(res.status).toBe(401);
  });

  it("refuses an inactive outlet", async () => {
    const db = await admin();
    try {
      await db.query("update pos_outlets set is_active = false where id = $1",
        [outletId]);
      expect((await get("/rooms")).status).toBe(401);
    } finally {
      await db.query("update pos_outlets set is_active = true where id = $1",
        [outletId]);
      await db.end();
    }
  });

  it("never lets the key itself reach the database", async () => {
    /* The row stores a digest. If this ever fails, a database dump has
       become the ability to charge guests. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ api_key_hash: string }>(
        "select api_key_hash from pos_outlets where id = $1", [outletId],
      );
      expect(rows[0]!.api_key_hash).toBe(hashKey(key));
      expect(rows[0]!.api_key_hash).not.toContain(key);
      expect(rows[0]!.api_key_hash).toHaveLength(64);
    } finally {
      await db.end();
    }
  });
});

/* ── Which rooms ──────────────────────────────────────────────────── */

describe("which rooms can I charge", () => {
  it("lists only rooms that are checked in with an open folio", async () => {
    const body = (await (await get("/rooms")).json()) as {
      outlet: string;
      rooms: Array<{ room: string; guest: string; folioId: string }>;
    };
    expect(body.outlet).toBe("TESTPOS");
    expect(body.rooms.length).toBeGreaterThan(0);

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n
           from reservations r
           join folios f on f.reservation_id = r.id
           join room_assignments ra on ra.reservation_id = r.id
                                   and ra.released_at is null
          where r.hotel_id = $1 and r.status = 'checked_in'
            and f.status = 'open'`,
        [hotelId],
      );
      expect(body.rooms.length).toBe(Number(rows[0]!.n));
    } finally {
      await db.end();
    }
  });
});

/* ── The promises ─────────────────────────────────────────────────── */

describe("charging a bill to a room", () => {
  it("takes the HOTEL's operating day, not the server clock", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rooms = (await (await get("/rooms")).json()) as {
      rooms: Array<{ room: string; folioId: string }>;
    };
    const target = rooms.rooms[0]!;

    const res = await post("/tickets", {
      ticketRef: ref("date"), room: target.room, folioId: target.folioId,
      amount: 100,
    });
    const body = (await res.json()) as { ok: boolean; businessDate: string };

    expect(body.ok).toBe(true);
    expect(body.businessDate).toBe("2026-08-25");
    expect(
      body.businessDate,
      "The bill was dated from the server clock. A restaurant closing at " +
        "01:30 would post into a day the night audit had already closed.",
    ).not.toBe(today);
  });

  it("does not charge twice when the POS retries after a timeout", async () => {
    const rooms = (await (await get("/rooms")).json()) as {
      rooms: Array<{ room: string; folioId: string }>;
    };
    const target = rooms.rooms[0]!;
    const r = ref("retry");

    const first = (await (await post("/tickets", {
      ticketRef: r, room: target.room, folioId: target.folioId, amount: 250,
    })).json()) as { ok: boolean; postingId: string };

    const retry = (await (await post("/tickets", {
      ticketRef: r, room: target.room, folioId: target.folioId, amount: 250,
    })).json()) as { ok: boolean; duplicate: boolean; postingId: string };

    expect(retry.ok).toBe(true);
    expect(retry.duplicate).toBe(true);
    expect(retry.postingId).toBe(first.postingId);

    /* And the ledger holds ONE charge, not two. The response saying
       "duplicate" would be worth nothing if a second row existed. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from folio_postings
          where source_id = (select id from pos_tickets
                              where outlet_id = $1 and ticket_ref = $2)`,
        [outletId, r],
      );
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await db.end();
    }
  });

  it("refuses a room with two open folios instead of guessing", async () => {
    /* A same-day changeover: one guest due out, one already in, both
       checked in, same room. The PMS cannot know which of them ate. */
    const db = await admin();
    let shared: string | null = null;
    try {
      const { rows } = await db.query<{ number: string }>(
        `select rm.number
           from reservations r
           join folios f on f.reservation_id = r.id
           join room_assignments ra on ra.reservation_id = r.id
                                   and ra.released_at is null
           join rooms rm on rm.id = ra.room_id
          where r.hotel_id = $1 and r.status = 'checked_in'
            and f.status = 'open'
          group by rm.number having count(*) > 1
          limit 1`,
        [hotelId],
      );
      shared = rows[0]?.number ?? null;
    } finally {
      await db.end();
    }

    if (!shared) {
      /* Not a silent pass. If the demo ever loses its changeover, this
         says so rather than reporting a check that did not run. */
      throw new Error(
        "No room with two open folios in the demo data. This test cannot " +
          "prove anything — restore the 25 August changeover in room 201, " +
          "or delete this test rather than let it report a green it did " +
          "not earn.",
      );
    }

    const res = await post("/tickets", {
      ticketRef: ref("ambig"), room: shared, amount: 500,
    });
    const body = (await res.json()) as {
      ok: boolean; status: string; choices?: Array<{ folioId: string }>;
    };

    expect(body.ok).toBe(false);
    expect(body.status).toBe("ambiguous");
    expect(body.choices?.length).toBeGreaterThan(1);

    /* And the SAME bill number still posts once a guest is named — an
       ambiguity is a question, not a refusal, so it must not have been
       recorded in a way that blocks the retry. */
    const settled = (await (await post("/tickets", {
      ticketRef: ref("ambig"), room: shared, amount: 500,
      folioId: body.choices![0]!.folioId,
    })).json()) as { ok: boolean };
    expect(settled.ok).toBe(true);
  });

  it("records a final refusal, so it can be produced later", async () => {
    const r = ref("refused");
    const res = await post("/tickets", { ticketRef: r, room: "___", amount: 50 });
    expect((await res.json() as { ok: boolean }).ok).toBe(false);

    const db = await admin();
    try {
      const { rows } = await db.query<{ status: string; reject_reason: string }>(
        `select status, reject_reason from pos_tickets
          where outlet_id = $1 and ticket_ref = $2`,
        [outletId, r],
      );
      expect(rows[0]!.status).toBe("rejected");
      expect(rows[0]!.reject_reason).toBeTruthy();
    } finally {
      await db.end();
    }
  });
});

describe("recovering after a timeout", () => {
  it("says not-received for a bill it never got", async () => {
    const res = await get(`/tickets/${ref("never")}`);
    expect(res.status).toBe(404);
    expect((await res.json() as { status: string }).status).toBe("not-received");
  });

  it("reports a bill that did land", async () => {
    const rooms = (await (await get("/rooms")).json()) as {
      rooms: Array<{ room: string; folioId: string }>;
    };
    const r = ref("recover");
    await post("/tickets", {
      ticketRef: r, room: rooms.rooms[0]!.room,
      folioId: rooms.rooms[0]!.folioId, amount: 75,
    });

    const body = (await (await get(`/tickets/${r}`)).json()) as
      { status: string; amount: number };
    expect(body.status).toBe("posted");
    expect(body.amount).toBe(75);
  });
});

describe("voiding a bill", () => {
  it("reverses rather than deletes, and nets to zero", async () => {
    const rooms = (await (await get("/rooms")).json()) as {
      rooms: Array<{ room: string; folioId: string }>;
    };
    const r = ref("void");

    const posted = (await (await post("/tickets", {
      ticketRef: r, room: rooms.rooms[0]!.room,
      folioId: rooms.rooms[0]!.folioId, amount: 640, taxRate: 5, taxAmount: 32,
    })).json()) as { postingId: string };

    const undo = (await (await post(`/tickets/${r}/void`)).json()) as
      { ok: boolean; reversalPostingId: string };
    expect(undo.ok).toBe(true);

    const db = await admin();
    try {
      const { rows } = await db.query<{
        n: string; net: string; tax: string;
      }>(
        `select count(*)::text as n,
                sum(amount)::text as net,
                sum(tax_amount)::text as tax
           from folio_postings
          where id in ($1::bigint, $2::bigint)`,
        [posted.postingId, undo.reversalPostingId],
      );

      /* TWO rows, not zero. The charge is not erased — it is cancelled,
         and the guest can see both lines on their folio. */
      expect(Number(rows[0]!.n)).toBe(2);
      expect(Number(rows[0]!.net)).toBe(0);
      expect(Number(rows[0]!.tax)).toBe(0);
    } finally {
      await db.end();
    }
  });

  it("is idempotent — a retried void does not re-charge the guest", async () => {
    const rooms = (await (await get("/rooms")).json()) as {
      rooms: Array<{ room: string; folioId: string }>;
    };
    const r = ref("void2");
    await post("/tickets", {
      ticketRef: r, room: rooms.rooms[0]!.room,
      folioId: rooms.rooms[0]!.folioId, amount: 320,
    });

    await post(`/tickets/${r}/void`);
    const again = (await (await post(`/tickets/${r}/void`)).json()) as
      { ok: boolean; duplicate: boolean };
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from folio_postings fp
          where fp.reverses_id = (select posting_id from pos_tickets
                                   where outlet_id = $1 and ticket_ref = $2)`,
        [outletId, r],
      );
      /* ONE reversal. A second would have handed the guest their money
         back twice. */
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await db.end();
    }
  });

  it("refuses to void a bill that was never charged", async () => {
    const r = ref("norefuse");
    await post("/tickets", { ticketRef: r, room: "___", amount: 50 });
    const res = await post(`/tickets/${r}/void`);
    expect((await res.json() as { ok: boolean }).ok).toBe(false);
  });
});
