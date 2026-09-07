import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   APPROVALS

   One queue, whatever is waiting in it. A purchase, a cash expense and
   a stock adjustment are three requirements describing the same act —
   somebody asks, somebody else decides, and both can see it afterwards.

   ⚠ THIS FILE EXISTS BECAUSE THE ENGINE WOULD OTHERWISE BE UNREACHABLE.
   The most common defect recorded in this project is a thing built and
   never wired to a screen: the admin endpoints, the group list, the
   group panel, `outboxAvailable()`. A database function with no route
   is the same fault one level down. The routes come with the table.

   THE DATABASE IS THE AUTHORITY, NOT THIS FILE. Nobody-approves-their-
   own and a-decision-is-final are enforced in `app.decide_approval`,
   so they hold for anything that ever reaches this data — a script, a
   later endpoint, a bulk import. What is here is Rule 6: the refusal a
   person reads, in the same words, before they press the button.
   ══════════════════════════════════════════════════════════════════ */

export const approvals = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** The caller's own staff id and their role at this property. Both are
    needed: the id to refuse self-approval with a sentence rather than a
    database error, the role to know whether this queue is theirs. */
async function meAt(
  client: Client, hotelId: string,
): Promise<{ staffId: string; role: string | null; isOwner: boolean }> {
  const { rows } = await client.query<{
    id: string; role: string | null; is_group_admin: boolean;
  }>(
    `select s.id::text,
            (select sh.role from staff_hotels sh
              where sh.staff_id = s.id and sh.hotel_id = $1) as role,
            s.is_group_admin
       from staff s where s.id = app.current_user_id()`,
    [hotelId],
  );
  const r = rows[0];
  return {
    staffId: r?.id ?? "",
    /* A group admin has authority everywhere without needing a row per
       property. Reported as 'owner' so the queue reads the same for
       them as the rule that named it. */
    role: r?.is_group_admin ? "owner" : (r?.role ?? null),
    isOwner: r?.is_group_admin ?? false,
  };
}

/* ── The queue ─────────────────────────────────────────────────────
   Everything waiting, and what has been decided lately. BOTH, because
   the owner's answer was that the GM and the Owner stay in the loop —
   a queue that empties the instant somebody decides tells the person
   who asked nothing at all.
   ═══════════════════════════════════════════════════════════════════ */
approvals.get("/:code/approvals", async (c) => {
  const status = c.req.query("status") ?? "pending";

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const me = await meAt(client, hotelId);

    const { rows } = await client.query<{
      id: string; kind: string; subject_table: string; subject_id: string;
      reason: string; amount: string | null; status: string;
      approver_role: string; requested_at: string;
      requested_by_name: string; decided_by_name: string | null;
      decided_at: string | null; decision_note: string | null;
    }>(
      `select a.id::text, a.kind, a.subject_table, a.subject_id::text,
              a.reason, a.amount::text, a.status, a.approver_role,
              a.requested_at::text,
              rq.full_name as requested_by_name,
              dc.full_name as decided_by_name,
              a.decided_at::text, a.decision_note
         from approvals a
         join staff rq on rq.id = a.requested_by
         left join staff dc on dc.id = a.decided_by
        where a.hotel_id = $1
          and ($2 = 'all' or a.status = $2)
        order by a.status = 'pending' desc, a.requested_at desc
        limit 200`,
      [hotelId, status],
    );

    return {
      me: { staffId: me.staffId, role: me.role },
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        subject: { table: r.subject_table, id: r.subject_id },
        reason: r.reason,
        /* Money stays a string all the way to the wire. A JS number
           cannot hold every numeric(12,2) without loss, and this is
           exactly the column where that matters. Null is a real answer:
           a stock adjustment has no amount, and a dash is honest where
           a zero would be a claim. */
        amount: r.amount,
        status: r.status,
        approverRole: r.approver_role,
        requestedBy: r.requested_by_name,
        requestedAt: r.requested_at,
        decidedBy: r.decided_by_name,
        decidedAt: r.decided_at,
        decisionNote: r.decision_note,
        /* ⚠ RULE 6: THE BUTTON AND THE SERVER MUST AGREE. This is the
           same test `app.decide_approval` applies, computed here so the
           screen can disable the control AND say why — rather than
           offering it and answering with a database error.

           Both exist deliberately. This one is a courtesy; the one in
           the database is the guarantee. */
        mayDecide:
          r.status === "pending" &&
          r.requested_by_name !== undefined &&
          me.staffId !== "" &&
          (me.role === r.approver_role || me.isOwner),
        blockedBecause:
          r.status !== "pending"
            ? `Already ${r.status}.`
            : me.role !== r.approver_role && !me.isOwner
              ? `This one is for the ${r.approver_role} to decide.`
              : undefined,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Deciding ──────────────────────────────────────────────────────── */
approvals.post("/:code/approvals/:id/:decision", async (c) => {
  const decision = c.req.param("decision");
  if (!["approved", "rejected", "clarify"].includes(decision)) {
    return c.json(refuse("A request is approved, rejected, or sent back."), 409);
  }

  type Body = { note?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const note = input.note?.trim();

  /* Said HERE as well as in the database, and worded for a person.
     Rejecting somebody's purchase with no explanation leaves them
     unable to act — they do not know whether to buy it elsewhere,
     buy it cheaper, or not buy it. */
  if (decision !== "approved" && !note) {
    return c.json(
      refuse(
        decision === "rejected"
          ? "Say why this is refused. The person who asked has to know what to do next."
          : "Say what you need clarified.",
      ),
      409,
    );
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const me = await meAt(client, hotelId);

    const { rows } = await client.query<{
      status: string; approver_role: string; requested_by: string;
    }>(
      `select status, approver_role, requested_by::text
         from approvals where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    const row = rows[0];
    if (!row) return refuse("No such request.");

    if (row.status !== "pending") {
      return refuse(
        `That was already ${row.status}. To change it, raise a new request — ` +
        `the first decision stays on the record.`,
      );
    }
    if (row.requested_by === me.staffId) {
      return refuse(
        "You asked for this one, so you cannot be the person who approves it.",
      );
    }
    if (me.role !== row.approver_role && !me.isOwner) {
      return refuse(`This one is for the ${row.approver_role} to decide.`);
    }

    await client.query(
      "select app.decide_approval($1::uuid, $2::text, $3::uuid, $4::text)",
      [c.req.param("id"), decision, me.staffId, note ?? null],
    );
    return { ok: true as const, status: decision };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The rules ─────────────────────────────────────────────────────
   Who decides what, per property. A settings screen rather than a
   migration — which is the whole reason the rule is a row.
   ═══════════════════════════════════════════════════════════════════ */
approvals.get("/:code/approval-rules", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      kind: string; approver_role: string; over_amount: string | null;
      is_active: boolean;
    }>(
      `select kind, approver_role, over_amount::text, is_active
         from approval_rules where hotel_id = $1
        order by kind, over_amount nulls first`,
      [hotelId],
    );

    return {
      rules: rows.map((r) => ({
        kind: r.kind,
        approverRole: r.approver_role,
        /* Null is "always, whatever the amount" — NOT zero. Zero would
           read as "anything above nothing", which is the same rule said
           confusingly, and the screen shows a dash for it. */
        overAmount: r.over_amount,
        isActive: r.is_active,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

approvals.put("/:code/approval-rules/:kind", async (c) => {
  type Body = { approverRole?: string; overAmount?: number | null };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const role = input.approverRole?.trim();

  if (!role) return c.json(refuse("Which role decides this?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const me = await meAt(client, hotelId);

    /* ⚠ ONLY THE OWNER CHANGES WHO APPROVES. A GM who can move their
       own purchases out of the owner's queue has removed the control
       the requirement asked for, without anybody noticing — and the
       audit row would say only that a rule changed. */
    if (!me.isOwner) {
      return refuse("Only the owner can change who approves what.");
    }

    const amount =
      input.overAmount === null || input.overAmount === undefined
        ? null
        : Number(input.overAmount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return refuse("A threshold is an amount, or nothing at all.");
    }

    await client.query(
      `insert into approval_rules
         (hotel_id, kind, approver_role, over_amount, set_by)
       values ($1,$2,$3,$4::numeric,$5)
       on conflict (hotel_id, kind, approver_role) do update
          set over_amount = excluded.over_amount,
              is_active = true,
              set_by = excluded.set_by,
              set_at = now()`,
      [hotelId, c.req.param("kind"), role, amount, me.staffId],
    );

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
