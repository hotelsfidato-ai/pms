import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   CASH DEPOSITS - the owner's D27-190 and D27-191, 30 September

   Every cash point counts out at its close and keeps a float; the rest is
   cash to deposit (app.cash_to_deposit, 163). Each morning the GM banks
   the days before and records each deposit: the day it banks, amount,
   date, bank, slip number and a photo of the slip (the shared attachments
   route, table `cash_deposits`). The owner or the accountant verifies.

   Per day: cash to deposit less what was deposited is the difference. It
   stays red until somebody who records explains it, and a red day takes no
   verification. Append-only: a wrong line is reversed by its own line, a
   verified one never.

   Who (D27-191): record, reverse and explain - the owner, an administrator
   and the GM (not the hotel manager); verify - the owner and the
   accountant only; see - all of those and the Viewer; not reception. No
   single grant in the matrix is exactly these, so the routes decide them
   (roleGate.ts `own`).
   ══════════════════════════════════════════════════════════════════ */

export const deposits = new Hono<{ Variables: { subject: string } }>();

const RECORD = ["owner", "admin", "gm"];
const VERIFY = ["owner", "finance"];
const SEE = [...RECORD, "finance", "read_only"];

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/* The person's role here, as the website reads it: a group administrator is
   the owner everywhere. A copy of accounting/routes.ts's (a service may not
   import another's insides; hoisting it is the master's). */
async function roleAt(client: Client, hotelId: string): Promise<string | null> {
  const { rows } = await client.query<{ role: string | null }>(
    `select case
              when exists (select 1 from staff s
                            where s.id = app.current_user_id()
                              and s.is_active and s.is_group_admin)
              then 'owner'
              else (select sh.role
                      from staff_hotels sh
                      join staff s on s.id = sh.staff_id
                     where sh.staff_id = app.current_user_id()
                       and sh.hotel_id = $1
                       and s.is_active
                     limit 1)
            end as role`,
    [hotelId]);
  return rows[0]?.role ?? null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round(n * 100) / 100;

export interface DepositDay {
  date: string;
  /** Per cash point; null where a close kept no figure (unknown, not zero). */
  points: { point: string; amount: number | null }[];
  toDeposit: number | null;
  deposited: number;
  difference: number | null;
  explanation: { reason: string; by: string | null; at: string } | null;
  /** The difference is not nil and nobody has explained it since the day's last entry. */
  red: boolean;
}

/** Every closed business day with cash to deposit or a deposit on it, newest first. */
async function loadDays(client: Client, hotelId: string, today: string): Promise<DepositDay[]> {
  const { rows: pts } = await client.query<{ d: string; point: string; amount: string | null }>(
    `select business_date::text as d, point, amount::text
       from app.cash_to_deposit($1) where business_date < $2::date
      order by business_date desc, point = 'Front desk' desc, point`,
    [hotelId, today]);
  const { rows: sums } = await client.query<{ d: string; total: string }>(
    `select business_date::text as d, sum(amount)::text as total
       from cash_deposits where hotel_id = $1 group by business_date`,
    [hotelId]);
  /* An explanation counts for the entries made before it; a later deposit
     on the day asks again. */
  const { rows: notes } = await client.query<{
    d: string; reason: string; by: string | null; at: string; current: boolean;
  }>(
    `select distinct on (n.business_date)
            n.business_date::text as d, n.reason, coalesce(s.full_name, hp.full_name) as by,
            app.hotel_clock(n.hotel_id, n.recorded_at, 'DD Mon, HH24:MI') as at,
            n.recorded_at > coalesce((select max(x.recorded_at) from cash_deposits x
                                       where x.hotel_id = n.hotel_id
                                         and x.business_date = n.business_date),
                                     '-infinity') as current
       from cash_deposit_notes n
       left join staff s on s.id = n.recorded_by
       left join app.hotel_people($1) hp on hp.id = n.recorded_by
      where n.hotel_id = $1
      order by n.business_date, n.recorded_at desc`,
    [hotelId]);

  const dates = new Set([...pts.map((p) => p.d), ...sums.map((s) => s.d)]);
  const days: DepositDay[] = [];
  for (const date of [...dates].sort().reverse()) {
    const points = pts.filter((p) => p.d === date)
      .map((p) => ({ point: p.point, amount: p.amount === null ? null : Number(p.amount) }));
    const sum = sums.find((s) => s.d === date);
    /* The log starts from the release (D27-191): a day whose closes all kept
       no figure, with nothing deposited against it, is not listed. */
    if (!sum && points.every((p) => p.amount === null)) continue;
    const toDeposit = points.some((p) => p.amount === null)
      ? null : cents(points.reduce((s, p) => s + p.amount!, 0));
    const deposited = cents(Number(sum?.total ?? 0));
    /* A day with no cash and no deposit is not listed either. */
    if (!sum && toDeposit === 0) continue;
    const difference = toDeposit === null ? null : cents(toDeposit - deposited);
    const note = notes.find((n) => n.d === date);
    const explained = Boolean(note?.current);
    days.push({
      date, points, toDeposit, deposited, difference,
      explanation: note ? { reason: note.reason, by: note.by, at: note.at } : null,
      red: (difference === null || Math.abs(difference) >= 0.01) && !explained,
    });
  }
  return days;
}

deposits.get("/:code/cash-deposits", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const role = await roleAt(client, hotelId);
    if (!role || !SEE.includes(role)) {
      return refuse("Cash deposits are for the owner, an administrator, the general manager, "
        + "the accountant or a viewer.");
    }
    const today = await businessDateFor(client, hotelId);

    const { rows } = await client.query<{
      id: string; d: string; amount: string; deposited_on: string | null;
      bank: string | null; slip_no: string | null; reverses_id: string | null;
      reason: string | null; recorded_by: string | null; recorded_at: string;
      verified_by: string | null; verified_at: string | null;
      reversed: boolean; slip: string | null;
    }>(
      `select d.id::text, d.business_date::text as d, d.amount::text,
              d.deposited_on::text, d.bank, d.slip_no, d.reverses_id::text, d.reason,
              coalesce(rs.full_name, rh.full_name) as recorded_by,
              app.hotel_clock(d.hotel_id, d.recorded_at, 'DD Mon, HH24:MI') as recorded_at,
              coalesce(vs.full_name, vh.full_name) as verified_by,
              app.hotel_clock(d.hotel_id, d.verified_at, 'DD Mon, HH24:MI') as verified_at,
              exists (select 1 from cash_deposits r where r.reverses_id = d.id) as reversed,
              (select a.id::text from attachments a
                where a.hotel_id = d.hotel_id and a.subject_table = 'cash_deposits'
                  and a.subject_id = d.id order by a.uploaded_at desc limit 1) as slip
         from cash_deposits d
         left join staff rs on rs.id = d.recorded_by
         left join app.hotel_people($1) rh on rh.id = d.recorded_by
         left join staff vs on vs.id = d.verified_by
         left join app.hotel_people($1) vh on vh.id = d.verified_by
        where d.hotel_id = $1
        order by d.recorded_at desc`,
      [hotelId]);

    return {
      ok: true as const,
      businessDate: today,
      canRecord: RECORD.includes(role),
      canVerify: VERIFY.includes(role),
      days: await loadDays(client, hotelId, today),
      deposits: rows.map((r) => ({
        id: r.id, businessDate: r.d, amount: Number(r.amount),
        depositedOn: r.deposited_on, bank: r.bank, slipNo: r.slip_no,
        reversesId: r.reverses_id, reason: r.reason,
        recordedBy: r.recorded_by, recordedAt: r.recorded_at,
        verifiedBy: r.verified_by, verifiedAt: r.verified_at,
        reversed: r.reversed, slipId: r.slip,
      })),
    };
  });
  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body, body.ok ? 200 : 403);
});

type Answer = { ok: true; id?: string } | { ok: false; reason: string; forbidden?: true };

/** Runs `act` for somebody holding one of `roles` here; the refusal names who may. */
async function asRole(
  subject: string, code: string, roles: string[], who: string,
  act: (client: Client, hotelId: string, today: string) => Promise<Answer>,
): Promise<Answer | null> {
  return withSession(subject, async (client) => {
    const hotelId = await hotelIdFor(client, code);
    if (!hotelId) return null;
    const role = await roleAt(client, hotelId);
    if (!role || !roles.includes(role)) return { ...refuse(`That is for ${who}.`), forbidden: true as const };
    return act(client, hotelId, await businessDateFor(client, hotelId));
  });
}

const statusOf = (r: Answer) => (r.ok ? 200 : r.forbidden ? 403 : 409);
const reply = (r: Answer) => (r.ok ? r : { ok: false as const, reason: r.reason });

const RECORDERS = "the owner, an administrator or the general manager";

deposits.post("/:code/cash-deposits", async (c) => {
  type Body = { businessDate?: string; amount?: unknown; depositedOn?: string;
                bank?: string; slipNo?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const amount = input.amount;
  if (!input.businessDate || !ISO.test(input.businessDate)) {
    return c.json(refuse("Which day's cash does this bank?"), 409);
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return c.json(refuse("How much was deposited?"), 409);
  }
  if (!input.depositedOn || !ISO.test(input.depositedOn)) {
    return c.json(refuse("On what date was it deposited?"), 409);
  }
  if (input.depositedOn < input.businessDate) {
    return c.json(refuse("A deposit cannot be made before the day whose cash it banks."), 409);
  }
  const bank = input.bank?.trim();
  const slipNo = input.slipNo?.trim();
  if (!bank) return c.json(refuse("Which bank?"), 409);
  if (!slipNo) return c.json(refuse("The slip number, as printed on the slip."), 409);

  const result = await asRole(c.get("subject"), c.req.param("code"), RECORD, RECORDERS, async (client, hotelId, today) => {
    if (input.businessDate! >= today) {
      return refuse("That day is still open. Its cash is deposited once the night audit has closed it.");
    }
    const { rows: closed } = await client.query(
      `select 1 from app.cash_to_deposit($1) where business_date = $2::date limit 1`,
      [hotelId, input.businessDate]);
    if (!closed.length) return refuse("No cash point closed on that day.");

    const { rows } = await client.query<{ id: string }>(
      `insert into cash_deposits (hotel_id, business_date, amount, deposited_on, bank, slip_no, recorded_by)
       values ($1, $2::date, $3, $4::date, $5, $6, app.current_user_id())
       returning id::text`,
      [hotelId, input.businessDate, amount.toFixed(2), input.depositedOn, bank, slipNo]);
    return { ok: true as const, id: rows[0]!.id };
  });
  return result ? c.json(reply(result), statusOf(result)) : c.json({ error: "No such property." }, 404);
});

deposits.post("/:code/cash-deposits/:id/reverse", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  if (!reason) return c.json(refuse("Why is it being reversed? This is the line somebody asks about."), 409);

  const result = await asRole(c.get("subject"), c.req.param("code"), RECORD, RECORDERS, async (client, hotelId) => {
    const { rows } = await client.query<{
      business_date: string; amount: string; reverses_id: string | null; verified_at: string | null;
    }>(
      `select business_date::text, amount::text, reverses_id::text, verified_at::text
         from cash_deposits where id = $1::uuid and hotel_id = $2 for update`,
      [c.req.param("id"), hotelId]);
    const d = rows[0];
    if (!d) return refuse("No such deposit.");
    if (d.reverses_id) return refuse("That line is itself a reversal.");
    if (d.verified_at) return refuse("A verified deposit cannot be reversed.");
    const { rows: done } = await client.query(
      "select 1 from cash_deposits where reverses_id = $1::uuid", [c.req.param("id")]);
    if (done.length) return refuse("That deposit is already reversed.");

    await client.query(
      `insert into cash_deposits (hotel_id, business_date, amount, reverses_id, reason, recorded_by)
       values ($1, $2::date, $3, $4::uuid, $5, app.current_user_id())`,
      [hotelId, d.business_date, (-Number(d.amount)).toFixed(2), c.req.param("id"), reason]);
    return { ok: true as const };
  });
  return result ? c.json(reply(result), statusOf(result)) : c.json({ error: "No such property." }, 404);
});

deposits.post("/:code/cash-deposits/days/:date/explain", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  const date = c.req.param("date");
  if (!ISO.test(date)) return c.json(refuse("Which day?"), 409);
  if (!reason) return c.json(refuse("Why do the deposits differ from the cash to deposit?"), 409);

  const result = await asRole(c.get("subject"), c.req.param("code"), RECORD, RECORDERS, async (client, hotelId, today) => {
    const day = (await loadDays(client, hotelId, today)).find((d) => d.date === date);
    if (!day) return refuse("That day has no cash to deposit.");
    await client.query(
      `insert into cash_deposit_notes (hotel_id, business_date, reason, recorded_by)
       values ($1, $2::date, $3, app.current_user_id())`,
      [hotelId, date, reason]);
    return { ok: true as const };
  });
  return result ? c.json(reply(result), statusOf(result)) : c.json({ error: "No such property." }, 404);
});

deposits.post("/:code/cash-deposits/:id/verify", async (c) => {
  const result = await asRole(c.get("subject"), c.req.param("code"), VERIFY, "the owner or the accountant", async (client, hotelId, today) => {
    const { rows } = await client.query<{
      business_date: string; reverses_id: string | null; verified_at: string | null;
      reversed: boolean; slip: boolean;
    }>(
      `select d.business_date::text, d.reverses_id::text, d.verified_at::text,
              exists (select 1 from cash_deposits r where r.reverses_id = d.id) as reversed,
              exists (select 1 from attachments a
                       where a.hotel_id = d.hotel_id and a.subject_table = 'cash_deposits'
                         and a.subject_id = d.id) as slip
         from cash_deposits d where d.id = $1::uuid and d.hotel_id = $2 for update`,
      [c.req.param("id"), hotelId]);
    const d = rows[0];
    if (!d) return refuse("No such deposit.");
    if (d.reverses_id) return refuse("A reversal is not verified; the deposit it takes back was wrong.");
    if (d.reversed) return refuse("That deposit was reversed. Verify the one entered again.");
    if (d.verified_at) return refuse("That deposit is already verified.");
    if (!d.slip) return refuse("Add the photo of the bank's slip first.");
    const day = (await loadDays(client, hotelId, today)).find((x) => x.date === d.business_date);
    if (day?.red) {
      return refuse("That day's deposits differ from its cash to deposit, and nobody has explained "
        + "why yet. It is verified once it is explained.");
    }
    await client.query(
      `update cash_deposits set verified_by = app.current_user_id(), verified_at = now()
        where id = $1::uuid`, [c.req.param("id")]);
    return { ok: true as const };
  });
  return result ? c.json(reply(result), statusOf(result)) : c.json({ error: "No such property." }, 404);
});
