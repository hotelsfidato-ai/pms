import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   APPROVALS, THROUGH THE API

   The database guards are proved in db/tests/suite.sql, and they are
   the guarantee. These prove the OTHER half of Rule 6: that a person
   is told why, in words, before they press anything — rather than the
   button being offered and answered with a database error.

   Run at AGRA, not the demo property. Agra has a clerk and the group
   owner, which is exactly the two identities an approval needs: one to
   ask and a different one to decide.

   WHAT IS ASSERTED

     · the queue shows what is waiting, and who it is for
     · the requester is refused their own request, in a sentence
     · a rejection with no reason is refused, in a sentence
     · a decided request cannot be decided twice
     · only the owner may change who approves what
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
let clerkUid: string;
let clerkId: string;
let agraId: string;

const as = (uid: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": uid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const staff = await db.query<{ id: string; uid: string; email: string }>(
      "select id::text, firebase_uid as uid, email from staff",
    );
    ownerUid = staff.rows.find((r) => r.email === "owner@fidato.in")!.uid;
    const clerk = staff.rows.find((r) => r.email === "agra@fidato.in")!;
    clerkUid = clerk.uid;
    clerkId = clerk.id;

    const h = await db.query<{ id: string }>(
      "select id::text from hotels where code = 'AGR'",
    );
    agraId = h.rows[0]!.id;

    /* A clean slate for this file, and only for it. */
    await db.query("delete from approvals where hotel_id = $1", [agraId]);
    await db.query("delete from approval_rules where hotel_id = $1", [agraId]);
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from approvals where hotel_id = $1", [agraId]);
    await db.query("delete from approval_rules where hotel_id = $1", [agraId]);
  } finally {
    await db.end();
  }
  await closePool();
});

/** Raise one as the clerk, out of band — the thing that raises approvals
    for real is the purchase code, which is Stage E. */
async function raise(reason: string, amount: number): Promise<string> {
  const db = await admin();
  try {
    const { rows } = await db.query<{ id: string }>(
      `select app.request_approval($1::uuid,'purchase','purchase_invoices',
              gen_random_uuid(),$2::text,$3::numeric,$4::uuid)::text as id`,
      [agraId, reason, amount, clerkId],
    );
    return rows[0]!.id;
  } finally {
    await db.end();
  }
}

describe("the approval queue", () => {
  it("is empty before a rule exists, because nothing needs approving", async () => {
    const res = await as(ownerUid, "/AGR/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(0);
  });

  it("only the owner may set who approves what", async () => {
    /* ⚠ A GM WHO CAN MOVE THEIR OWN PURCHASES OUT OF THE OWNER'S QUEUE
       has removed the control the requirement asked for, and the audit
       row would say only that a rule changed. */
    const denied = await as(clerkUid, "/AGR/approval-rules/purchase", "PUT", {
      approverRole: "front_desk",
    });
    expect(denied.status).toBe(409);
    const body = (await denied.json()) as { reason: string };
    expect(body.reason).toContain("owner");

    const ok = await as(ownerUid, "/AGR/approval-rules/purchase", "PUT", {
      approverRole: "owner",
      overAmount: null,
    });
    expect(ok.status).toBe(200);
  });

  it("shows what is waiting, who asked, and who it is for", async () => {
    await raise("Vegetables for the week", 4200);

    const res = await as(ownerUid, "/AGR/approvals");
    const body = (await res.json()) as {
      rows: {
        reason: string; amount: string; approverRole: string;
        requestedBy: string; mayDecide: boolean;
      }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.reason).toBe("Vegetables for the week");
    expect(body.rows[0]!.approverRole).toBe("owner");
    /* Money stays a string to the wire — a JS number cannot hold every
       numeric(12,2) without loss, and this is the column where it
       matters. */
    expect(body.rows[0]!.amount).toBe("4200.00");
    expect(body.rows[0]!.mayDecide).toBe(true);
  });

  it("REFUSES the person who asked, in a sentence they can act on", async () => {
    const id = await raise("Six crates of soft drinks", 8800);

    const res = await as(clerkUid, `/AGR/approvals/${id}/approved`, "POST", {});
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("cannot be the person who approves");
  });

  it("refuses a rejection with no reason, and says what is missing", async () => {
    const id = await raise("A second fridge", 32000);

    const res = await as(ownerUid, `/AGR/approvals/${id}/rejected`, "POST", {});
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("why");
  });

  it("records a decision with its words, once", async () => {
    const id = await raise("Twelve kilos of paneer", 6400);

    const ok = await as(ownerUid, `/AGR/approvals/${id}/rejected`, "POST", {
      note: "Buy from the usual supplier.",
    });
    expect(ok.status).toBe(200);

    /* ⚠ A DECIDED REQUEST IS DECIDED. Without this a rejection can be
       quietly approved afterwards and the row shows only the second
       answer — the trail would say approved and never that anybody had
       refused it. */
    const again = await as(ownerUid, `/AGR/approvals/${id}/approved`, "POST", {});
    expect(again.status).toBe(409);
    const body = (await again.json()) as { reason: string };
    expect(body.reason).toContain("already");

    /* And the person who asked can still see what happened to it —
       both stay in the loop, which was the owner's own answer. */
    const seen = await as(clerkUid, "/AGR/approvals?status=all");
    const list = (await seen.json()) as {
      rows: { id: string; status: string; decisionNote: string | null }[];
    };
    const mine = list.rows.find((r) => r.id === id);
    expect(mine?.status).toBe("rejected");
    expect(mine?.decisionNote).toBe("Buy from the usual supplier.");
  });

  it("under a threshold, nothing is raised at all", async () => {
    /* A ₹200 packet of nails must not sit in a queue. */
    const db = await admin();
    try {
      await db.query("delete from approval_rules where hotel_id = $1", [agraId]);
      await db.query(
        `insert into approval_rules
           (hotel_id, kind, approver_role, over_amount) values ($1,$2,$3,$4)`,
        [agraId, "cash_expense", "owner", 5000],
      );
      const { rows } = await db.query<{ id: string | null }>(
        `select app.request_approval($1::uuid,'cash_expense','expenses',
                gen_random_uuid(),'Auto fare',300,$2::uuid)::text as id`,
        [agraId, clerkId],
      );
      expect(rows[0]!.id).toBeNull();
    } finally {
      await db.end();
    }
  });
});
