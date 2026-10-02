import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* Split out of api/src/routes/operations.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: finance.
   The front desk's cash drawer: open, movements, count, close. The
   endpoints are unchanged; `hotelIdFor`, `Outcome` and `refuse` are copies
   of the front desk's. */

export const cashier = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/** Rule 6's shape, all the way down. Refused is a result, not an error. */
type Outcome<T = unknown> =
  | { ok: true; data?: T }
  /* `needs` names WHAT WOULD SATISFY the refusal, for the refusals that
     have an answer. A screen can then open the right dialog instead of
     matching on the prose — which is a string somebody will reword one
     day, at which point the way through silently disappears. Most
     refusals have no `needs`: "the room is occupied" is not a form to
     fill in. */
  | { ok: false; reason: string; needs?: "late-reason" | "early-reason" };

const refuse = (
  reason: string, needs?: "late-reason" | "early-reason",
): Outcome => (needs ? { ok: false, reason, needs } : { ok: false, reason });


/* ══════════════════════════════════════════════════════════════════
   THE FRONT DESK SHIFT

   Open with a float, take receipts, count the drawer, hand over.
   The POS day end's shape, deliberately — a front office that
   reasons about its cash differently from its restaurant is one
   where the two get compared and nobody can.

   THE DRAWER OPENS BY ITSELF (the owner's D27-200, D27-201): the first
   cash a person takes after the night audit, or the first money they
   record in or out, opens their drawer - on the float a close handed to
   them by name, and ₹0 for anyone else. A FLOAT IS CARRIED ONCE:
   cashier_float_claims (165) says which drawer took which close's float,
   its primary key refuses a second, and openings and handovers at one
   hotel take turns so neither misses the other.
   ══════════════════════════════════════════════════════════════════ */

/* A PAID-OUT WAITS FOR A YES (the owner's D27-239, D27-242): an expense is
   raised in the approvals inbox and counts in the drawer only once the GM
   or the owner says yes (app.cash_expense_counts, 184). Its latest
   decision, for the screen. */
const EXPENSE_DECISION = (column: "status" | "decision_note") => `(
  select a.${column} from approvals a
   where a.subject_table = 'cashier_movements' and a.subject_id = m.id
   order by a.requested_at desc limit 1)`;
/** Paid-outs on this drawer still waiting for a yes: they explain that
    much of a shortage until they are decided. */
const WAITING = `
  select coalesce(sum(m.amount), 0)::text as waiting
    from cashier_movements m
   where m.shift_id = $1 and m.kind = 'expense'
     and ${EXPENSE_DECISION("status")} in ('pending', 'clarify')`;

/** One opening or handover at a time per hotel, to the end of the transaction. */
const drawerTurn = (client: Client, hotelId: string) =>
  client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`cash-drawer:${hotelId}`]);

/** Marks every float waiting for this drawer's holder as taken up by it. */
const claimFloats = (client: Client, hotelId: string, shiftId: string) =>
  client.query(
    `insert into cashier_float_claims (closed_shift_id, taken_by_shift_id)
     select cs.id, $2::uuid
       from cashier_shifts cs
      where cs.hotel_id = $1
        and cs.handed_to = (select staff_id from cashier_shifts where id = $2::uuid)
        and cs.closed_at is not null and cs.kept_cash > 0
        and not exists (select 1 from cashier_float_claims c where c.closed_shift_id = cs.id)`,
    [hotelId, shiftId]);

/**
 * Opens the caller's drawer if they hold none, on the float waiting for them
 * (app.cashier_float_waiting; ₹0 when nothing was handed to them).
 *
 * A WRITE: call it after every refusal (MEMORY 243). The shift's `opened_at`
 * is this transaction's own time, so the payment that opened it is counted
 * in it (app.cashier_expected_cash asks created_at >= opened_at).
 */
export async function openOwnDrawer(
  client: Client, hotelId: string, businessDate: string,
): Promise<void> {
  const open = `select 1 from cashier_shifts
                 where hotel_id = $1 and staff_id = app.current_user_id() and closed_at is null`;
  if ((await client.query(open, [hotelId])).rows.length) return;
  await drawerTurn(client, hotelId);
  const { rows: made } = await client.query<{ id: string }>(
    `insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_by)
     select $1, app.current_user_id(), $2::date,
            app.cashier_float_waiting($1, app.current_user_id()), app.current_user_id()
      where not exists (${open})
     returning id::text`,
    [hotelId, businessDate]);
  if (made[0]) await claimFloats(client, hotelId, made[0].id);
}

cashier.get("/:code/cashier-shift", async (c) => {
  const body = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    const { rows: open } = await client.query<{
      id: string; opening: string; opened_at: string; counted: string | null;
      variance_reason: string | null;
    }>(
      `select id::text, opening_cash::text as opening,
              to_char(opened_at,'HH24:MI') as opened_at,
              counted_cash::text as counted, variance_reason
         from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId],
    );

    /* No open drawer is a real state, not an error: the shift has not
       started. The screen offers to open one, and shows the last close
       so somebody taking over knows what they were handed. */
    if (!open[0]) {
      const { rows: last } = await client.query<{
        closed_at: string; counted: string; kept: string | null; handed_to: string | null;
      }>(
        /* The colleague's name through app.hotel_people (149): `staff` shows
           a clerk only their own row, so it read "handed to nobody". */
        `select to_char(cs.closed_at,'DD Mon, HH24:MI') as closed_at,
                cs.counted_cash::text as counted, cs.kept_cash::text as kept,
                coalesce(s.full_name, hp.full_name) as handed_to
           from cashier_shifts cs
           left join staff s on s.id = cs.handed_to
           left join app.hotel_people($1) hp on hp.id = cs.handed_to
          where cs.hotel_id = $1 and cs.staff_id = $2
            and cs.closed_at is not null
          order by cs.closed_at desc limit 1`,
        [hotelId, session.staffId]);
      const { rows: float } = await client.query<{ waiting: string }>(
        `select app.cashier_float_waiting($1, $2)::text as waiting`,
        [hotelId, session.staffId]);
      return {
        businessDate,
        shift: null,
        /* What the drawer opens on when this person first takes cash: the
           float handed to them by name, 0 for anyone else (D27-201). */
        waiting: Number(float[0]!.waiting),
        colleagues: [],
        previous: last[0]
          ? { closedAt: last[0].closed_at, counted: Number(last[0].counted),
              /* What goes is on record with what came (D27-202): the float
                 kept, for whom, and so the rest to deposit. Null on a close
                 from before the float was recorded. */
              kept: last[0].kept === null ? null : Number(last[0].kept),
              handedTo: last[0].handed_to }
          : null,
      };
    }

    const shiftId = open[0].id;

    const { rows: receipts } = await client.query<{
      method: string; n: number; amount: string;
    }>(
      `select coalesce(p.method,'unrecorded') as method,
              count(*)::int as n, (-sum(fp.amount))::text as amount
         from folio_postings fp
         left join payments p on p.posting_id = fp.id
         join cashier_shifts cs on cs.id = $1
        where fp.hotel_id = cs.hotel_id
          and fp.category = 'payment'
          and fp.posted_by = cs.staff_id
          and fp.created_at >= cs.opened_at
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id)
        group by coalesce(p.method,'unrecorded')
        order by 1`,
      [shiftId],
    );

    const { rows: movements } = await client.query<{
      id: string; kind: string; amount: string; reason: string;
      recorded_by: string; at: string; approval: string | null; approval_note: string | null;
    }>(
      `select m.id::text, m.kind, m.amount::text, m.reason,
              s.full_name as recorded_by, to_char(m.recorded_at,'HH24:MI') as at,
              ${EXPENSE_DECISION("status")} as approval,
              ${EXPENSE_DECISION("decision_note")} as approval_note
         from cashier_movements m join staff s on s.id = m.recorded_by
        where m.shift_id = $1 order by m.recorded_at`,
      [shiftId],
    );
    const { rows: [waiting] } = await client.query<{ waiting: string }>(WAITING, [shiftId]);

    const { rows: denoms } = await client.query<{ value: string; count: number }>(
      `select value::text, count from cashier_denominations
        where shift_id = $1 order by value desc`, [shiftId]);

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.cashier_expected_cash($1)::text as amount`, [shiftId]);

    /* WHAT COMES IS WHAT GOES (the owner, D27-202): the floats this drawer
       took up, and from whose close. */
    const { rows: received } = await client.query<{ amount: string; from_name: string | null; at: string }>(
      `select cs.kept_cash::text as amount, coalesce(s.full_name, hp.full_name) as from_name,
              to_char(cs.closed_at, 'DD Mon, HH24:MI') as at
         from cashier_float_claims c
         join cashier_shifts cs on cs.id = c.closed_shift_id
         left join staff s on s.id = cs.staff_id
         left join app.hotel_people($2) hp on hp.id = cs.staff_id
        where c.taken_by_shift_id = $1
        order by cs.closed_at`,
      [shiftId, hotelId]);

    /* From app.hotel_people (149, the owner's D27-97): read from `staff` and
       `staff_hotels` it was nobody for anyone who does not run the hotel -
       row security shows each person only their own roster line. */
    const { rows: mates } = await client.query<{ id: string; name: string }>(
      `select id::text, full_name as name
         from app.hotel_people($1)
        where is_active and id <> $2
        order by full_name`,
      [hotelId, session.staffId]);

    const counted = open[0].counted;
    const exp = Number(expected[0]!.amount);

    return {
      businessDate,
      shift: {
        id: shiftId,
        openedAt: open[0].opened_at,
        opening: Number(open[0].opening),
        received: received.map((r) => ({ amount: Number(r.amount), from: r.from_name, closedAt: r.at })),
        receipts: receipts.map((r) => ({
          method: r.method, count: r.n, amount: Number(r.amount),
        })),
        movements: movements.map((m) => ({
          id: m.id, kind: m.kind, amount: Number(m.amount),
          reason: m.reason, recordedBy: m.recorded_by, at: m.at,
          /* A paid-out's yes (D27-242): pending, clarify, approved,
             rejected; null where nobody was asked. */
          approval: m.approval, approvalNote: m.approval_note,
        })),
        /* Paid-outs waiting for a yes: not in Expected yet. */
        waiting: Number(waiting!.waiting),
        expected: exp,
        counted: counted === null ? null : Number(counted),
        variance: counted === null ? null : Number(counted) - exp,
        varianceReason: open[0].variance_reason,
        denominations: denoms.map((d) => ({
          value: Number(d.value), count: d.count,
        })),
      },
      /* Who the drawer can be handed to. Nobody is a real answer — the
         last close of the night hands over to no one. */
      colleagues: mates,
      previous: null,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

cashier.post("/:code/cashier-shift/open", async (c) => {
  const input = await c.req.json<{ opening?: number }>()
    .catch(() => ({}) as { opening?: number });
  /* COUNTED, NEVER ASSUMED (D27-190): a blank float was saved as ₹0, a
     figure nobody counted. Zero is an answer only when somebody gives it. */
  const opening = input.opening;
  if (typeof opening !== "number" || !Number.isFinite(opening) || opening < 0) {
    return c.json(refuse(
      "Count the opening float first - enter 0 if the drawer is empty."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const businessDate = await businessDateFor(client, hotelId);

    /* A float counted in by hand - how a desk's first float gets in. What
       was handed to this person by name is what they are counting, so it is
       taken up here and never carried again; the count is the opening. */
    await drawerTurn(client, hotelId);
    try {
      const { rows: made } = await client.query<{ id: string }>(
        `insert into cashier_shifts (hotel_id, staff_id, business_date,
                                     opening_cash, opened_by)
         values ($1,$2,$3::date,$4,$2)
         returning id::text`,
        [hotelId, session.staffId, businessDate, opening.toFixed(2)]);
      await claimFloats(client, hotelId, made[0]!.id);
      return { ok: true as const };
    } catch (error) {
      const e = error as { code?: string } | undefined;
      if (e?.code === "23505") {
        /* One open drawer per person. Two means neither can be reconciled. */
        return refuse("You already have a drawer open. Close it first.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

cashier.post("/:code/cashier-shift/movements", async (c) => {
  type Body = { kind?: string; amount?: number; reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const KINDS = ["expense", "top_up", "withdrawal"];
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("Money out, money in, or to the safe?"), 409);
  }
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    return c.json(refuse("How much?"), 409);
  }
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse(
      "What was it for? This is the line somebody asks about."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Money in or out is cash in hand: it opens the drawer as a payment
       does (D27-200). Every refusal is above this. */
    await openOwnDrawer(client, hotelId, await businessDateFor(client, hotelId));
    const { rows: shift } = await client.query<{ id: string }>(
      `select id::text from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");

    const { rows: made } = await client.query<{ id: string }>(
      `insert into cashier_movements (hotel_id, shift_id, kind, amount,
                                      reason, recorded_by)
       values ($1,$2,$3,$4,$5,$6)
       returning id::text`,
      [hotelId, shift[0].id, input.kind, Number(input.amount).toFixed(2),
       reason, session.staffId]);
    /* A paid-out waits for the GM's or the owner's yes (D27-242). */
    if (input.kind === "expense") {
      await client.query(
        `select app.request_approval($1::uuid, 'cash_expense', 'cashier_movements',
                $2::uuid, $3, $4, $5::uuid)`,
        [hotelId, made[0]!.id, `Front desk drawer: ${reason}`,
         Number(input.amount).toFixed(2), session.staffId]);
    }
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

cashier.post("/:code/cashier-shift/count", async (c) => {
  type Body = { denominations?: { value: number; count: number }[] };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  /* A COUNT IS NOTES IN A DRAWER (QA FI-10): "₹500 × −3" was dropped on the
     way and saved as nothing counted, and the close then said short by the
     lot. Refused whole, before anything is replaced. */
  if ((input.denominations ?? []).some((d) =>
    !Number.isFinite(d.value) || d.value <= 0 || !Number.isInteger(d.count) || d.count < 0)) {
    return c.json(refuse("A count is a whole number of notes or coins - zero or more."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: shift } = await client.query<{ id: string }>(
      `select id::text from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");
    const id = shift[0].id;

    /* Replaced wholesale. A count is one act — somebody empties the drawer
       and counts it — and merging a new count into an old one leaves
       denominations nobody typed this time. */
    await client.query(
      `delete from cashier_denominations where shift_id = $1`, [id]);
    for (const d of input.denominations ?? []) {
      if (!Number.isFinite(d.value) || d.value <= 0) continue;
      if (!Number.isInteger(d.count) || d.count <= 0) continue;
      await client.query(
        `insert into cashier_denominations (shift_id, value, count)
         values ($1,$2,$3)`, [id, d.value, d.count]);
    }

    const { rows: total } = await client.query<{ total: string }>(
      `select coalesce(sum(value * count),0)::text as total
         from cashier_denominations where shift_id = $1`, [id]);
    await client.query(
      `update cashier_shifts set counted_cash = $1 where id = $2`,
      [total[0]!.total, id]);

    return { ok: true as const, counted: Number(total[0]!.total) };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

cashier.post("/:code/cashier-shift/close", async (c) => {
  type Body = { varianceReason?: string; handOverTo?: string | null; keptCash?: unknown };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: shift } = await client.query<{
      id: string; counted: string | null;
    }>(
      `select id::text, counted_cash::text as counted from cashier_shifts
        where hotel_id = $1 and staff_id = $2 and closed_at is null`,
      [hotelId, session.staffId]);
    if (!shift[0]) return refuse("You have no drawer open.");
    if (shift[0].counted === null) return refuse("Count the drawer first.");

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.cashier_expected_cash($1)::text as amount`, [shift[0].id]);
    const variance = Number(shift[0].counted) - Number(expected[0]!.amount);
    /* Paid-outs waiting for a yes explain that much of a shortage
       (D27-242): a reason is asked only for the rest. */
    const { rows: [waits] } = await client.query<{ waiting: string }>(WAITING, [shift[0].id]);
    const unexplained = variance + Number(waits!.waiting);

    /* A difference is RECORDED, not refused. The money is already whatever
       it is, and a desk that cannot hand over is worse than a difference
       written down — the same rule the POS close uses. */
    if (Math.abs(unexplained) >= 0.01 && !input.varianceReason?.trim()) {
      return refuse(
        `The drawer is ${unexplained > 0 ? "over" : "short"} by `
        + `${Math.abs(unexplained).toFixed(2)}`
        + (Number(waits!.waiting) > 0 ? ", beyond the paid-outs waiting for a yes" : "")
        + ". Say why, and it closes.");
    }

    /* THE FLOAT KEPT (D27-191, D27-202): typed at every close, 0 up to the
       count, never assumed; the rest of the count is cash to deposit. To
       hand the whole drawer over, the whole count is typed. */
    const counted = Number(shift[0].counted);
    const kept = input.keptCash;
    if (typeof kept !== "number" || !Number.isFinite(kept) || kept < 0 || kept > counted) {
      return refuse(
        `Say what float is kept for the next shift - from 0 to the ${counted.toFixed(2)} counted.`);
    }
    /* A KEPT FLOAT NAMES THE NEXT PERSON (the owner's D27-201): it waits for
       them, and their drawer opens on it. Kept with nobody named it would be
       nobody's. ₹0 kept needs no name. */
    if (kept > 0 && !input.handOverTo) {
      return refuse(
        "Say who takes the float: a float kept needs the next person's name, and it "
        + "waits for them. Keep 0 to deposit it all.");
    }

    /* Handovers and openings take turns, so the float below is either seen
       by the next person's opening or added to the drawer they hold. */
    if (kept > 0) await drawerTurn(client, hotelId);

    await client.query(
      `update cashier_shifts
          set variance_reason = $1, handed_to = $2, closed_by = $3,
              closed_at = now(), kept_cash = $5
        where id = $4`,
      [input.varianceReason?.trim() || null, input.handOverTo || null,
       session.staffId, shift[0].id, kept.toFixed(2)]);

    /* THE NEXT PERSON IS ALREADY OPEN (a shift overlap): the float goes into
       the drawer they hold, and is taken up here so it is never carried
       again (D27-201). Otherwise it waits for their next opening. */
    if (kept > 0) {
      const { rows: theirs } = await client.query<{ id: string }>(
        `update cashier_shifts set opening_cash = opening_cash + $3
          where hotel_id = $1 and staff_id = $2::uuid and closed_at is null
         returning id::text`,
        [hotelId, input.handOverTo, kept.toFixed(2)]);
      if (theirs[0]) {
        await client.query(
          `insert into cashier_float_claims (closed_shift_id, taken_by_shift_id)
           values ($1::uuid, $2::uuid)`, [shift[0].id, theirs[0].id]);
      }
    }

    return { ok: true as const, variance, toDeposit: counted - kept };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
