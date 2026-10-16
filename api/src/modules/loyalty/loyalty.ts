import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   LOYALTY (D27-178, D27-179; src/modules/loyalty/MODULE.md, L1-L18)

   The rules are the database's - migration "loyalty" - and every one of
   them is the owner's. These routes ask it and say what it answered:

     THE DESK    joins a guest who ticked the agreement, takes points off
                 a checked-in member's room charges, and a member leaves.
     MANAGERS    the owner, an administrator and the GM: the member card
                 and statement on Guest 360, a points adjustment with a
                 reason, and the month by hotel (L18).
     SETTINGS    the programme's name and its earn rate - group settings
                 with no default, set by whoever sets the group's name.

   Each database function answers NULL when done, or the sentence that
   says why not, and never raises for a refusal (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */

export const loyalty = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

type Answer = { status: 200 | 403 | 404 | 409; body: unknown };
const noProperty: Answer = { status: 404, body: { error: "No such property." } };
const MANAGERS_ONLY: Answer = {
  status: 403, body: { error: "This is for the owner, an administrator or a general manager." },
};
const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a loyalty function answered: NULL is done. */
async function asked(client: Client, sql: string, params: unknown[]): Promise<Answer> {
  const { rows } = await client.query<{ why: string | null }>(sql, params);
  const why = rows[0]?.why ?? null;
  return why ? { status: 409, body: { ok: false, reason: why } } : { status: 200, body: { ok: true } };
}

/** Points for a stay at its check-out (L9) - called by the front desk's
    check-out, in its transaction, after the stay is checked out. 0 when the
    guest is not a member, the hotel has loyalty off or no rate is set. */
export async function earnAtCheckOut(client: Client, stayId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>("select app.loyalty_earn($1) as n", [stayId]);
  return rows[0]?.n ?? 0;
}

/* ── The screen: the rules, this hotel's switch, who is in house ─── */
loyalty.get("/:code/loyalty", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return noProperty;
    const { rows: rules } = await client.query<{
      name: string | null; rate: string | null; words: string | null;
      may_set: boolean; is_on: boolean; manager: boolean; may_redeem: boolean;
    }>(
      `select g.loyalty_name as name, g.loyalty_points_per_100::text as rate,
              app.loyalty_consent_words() as words, app.sets_group_settings() as may_set,
              app.module_enabled($1, 'loyalty') as is_on, app.is_crm_manager() as manager,
              app.redeems_loyalty_points($1) as may_redeem
         from (select 1) one left join group_settings g on g.id = 1`, [hotelId]);
    const { rows: stays } = await client.query<{
      id: string; reference: string; room: string | null; guest_id: string; name: string;
      has_phone: boolean; member: boolean; points: number | null; direct: boolean;
    }>(
      `select r.id, r.reference, rm.number as room, g.id as guest_id, g.full_name as name,
              app.phone_key(g.phone) is not null as has_phone,
              app.loyalty_member(g.id) is not null as member,
              case when app.loyalty_member(g.id) is not null then app.loyalty_balance(g.id) end as points,
              not app.loyalty_not_direct(r.id) as direct
         from reservations r
         join guests g on g.id = r.guest_id
         left join room_assignments ra on ra.reservation_id = r.id and ra.released_at is null
         left join rooms rm on rm.id = ra.room_id
        where r.hotel_id = $1 and r.status = 'checked_in'
        order by rm.number collate app.room_order nulls last, g.full_name`, [hotelId]);
    const r = rules[0]!;
    return {
      status: 200,
      body: {
        name: r.name, pointsPer100: r.rate === null ? null : Number(r.rate), words: r.words,
        maySetRules: r.may_set, isOn: r.is_on, isManager: r.manager, mayRedeem: r.may_redeem,
        stays: stays.map((s) => ({
          id: s.id, reference: s.reference, room: s.room, guestId: s.guest_id, name: s.name,
          hasPhone: s.has_phone, member: s.member, points: s.points, direct: s.direct,
        })),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── The rules: a name and an earn rate, no defaults (L1, L8) ────── */
loyalty.put("/:code/loyalty/rules", async (c) => {
  const input = await c.req.json<{ name?: unknown; pointsPer100?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : null;
  const rate = input.pointsPer100 === null || input.pointsPer100 === "" ? null : Number(input.pointsPer100);
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    const { rows } = await client.query<{ may: boolean }>("select app.sets_group_settings() as may");
    if (!rows[0]?.may) {
      return { status: 403, body: { error: "The loyalty rules are set by the owner, an administrator or a general manager." } };
    }
    if (name && name.length > 40) return { status: 409, body: { ok: false, reason: "The name is 40 letters at most." } };
    if (rate !== null && !(Number.isFinite(rate) && rate > 0 && rate <= 100)) {
      return { status: 409, body: { ok: false, reason: "Points per ₹100 is a number above 0 and at most 100, or empty for none." } };
    }
    await client.query(
      `insert into group_settings (id, loyalty_name, loyalty_points_per_100, changed_by, changed_at)
       values (1, $1, $2, app.current_user_id(), now())
       on conflict (id) do update set loyalty_name = excluded.loyalty_name,
              loyalty_points_per_100 = excluded.loyalty_points_per_100,
              changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
      [name, rate]);
    return { status: 200, body: { ok: true } };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Joining and leaving (L3, L4, L5) ────────────────────────────── */
loyalty.post("/:code/loyalty/guests/:id/join", async (c) => {
  const input = await c.req.json<{ agreed?: boolean }>().catch(() => ({}) as { agreed?: boolean });
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return noProperty;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    /* The guest's own yes, never assumed (L4, DPDP s.6). */
    if (input.agreed !== true) {
      return { status: 409, body: { ok: false, reason: "Tick that the guest agrees, in their own words, before they join." } };
    }
    return asked(client, "select app.loyalty_join($1, $2) as why", [hotelId, c.req.param("id")]);
  });
  return c.json(answer.body as object, answer.status);
});

loyalty.post("/:code/loyalty/guests/:id/leave", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return noProperty;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    return asked(client, "select app.loyalty_leave($1, $2) as why", [hotelId, c.req.param("id")]);
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Points off the bill (L13-L16) ───────────────────────────────── */
loyalty.post("/:code/loyalty/stays/:id/redeem", async (c) => {
  const input = await c.req.json<{ points?: unknown }>().catch(() => ({}) as { points?: unknown });
  const points = Number(input.points);
  const key = c.req.header("idempotency-key") ?? null;
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such stay." } };
    if (!Number.isInteger(points)) return { status: 409, body: { ok: false, reason: "How many points? A whole number." } };
    return asked(client, "select app.loyalty_redeem($1, $2, $3) as why",
      [c.req.param("id"), points, key && A_UUID.test(key) ? key : null]);
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Managers: the card, an adjustment, the month by hotel (L6, L18) ── */
loyalty.get("/:code/loyalty/guests/:id", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    const { rows } = await client.query<{ card: unknown }>("select app.loyalty_card($1) as card", [c.req.param("id")]);
    return rows[0]?.card ? { status: 200, body: rows[0].card } : MANAGERS_ONLY;
  });
  return c.json(answer.body as object, answer.status);
});

loyalty.post("/:code/loyalty/guests/:id/adjust", async (c) => {
  const input = await c.req.json<{ points?: unknown; reason?: string }>().catch(() => ({}) as { points?: unknown; reason?: string });
  const points = Number(input.points);
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return noProperty;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    if (!Number.isInteger(points)) return { status: 409, body: { ok: false, reason: "How many points? A whole number." } };
    return asked(client, "select app.loyalty_adjust($1, $2, $3, $4) as why",
      [hotelId, c.req.param("id"), points, input.reason ?? null]);
  });
  return c.json(answer.body as object, answer.status);
});

loyalty.get("/:code/loyalty/by-hotel", async (c) => {
  const month = c.req.query("month") ?? "";
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!/^\d{4}-\d{2}$/.test(month)) return { status: 409, body: { ok: false, reason: "Which month? As 2026-09." } };
    const { rows: may } = await client.query<{ may: boolean }>("select app.is_crm_manager() as may");
    if (!may[0]?.may) return MANAGERS_ONLY;
    const { rows } = await client.query<{ hotel_code: string; hotel_name: string; earned: string; used: string }>(
      "select * from app.loyalty_by_hotel($1::date)", [`${month}-01`]);
    return {
      status: 200,
      body: rows.map((r) => ({
        hotelCode: r.hotel_code, hotelName: r.hotel_name, earned: Number(r.earned), used: Number(r.used),
      })),
    };
  });
  return c.json(answer.body as object, answer.status);
});
