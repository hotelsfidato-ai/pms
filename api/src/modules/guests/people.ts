import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE GUEST, ONE RECORD — the Central CRM, phase 1 (docs/briefs/crm.md)

   Every booking used to make a new guest row with no lookup, so the same
   person twice was two rows, and the blacklist was a column nothing read
   (root MEMORY 311). These routes are what the desk and the managers use
   to make "one person" true. The rules are the database's - migration
   "one guest, one record" - and every one of them is the owner's:

     THE DESK    asks who a typed phone or email already is. It is told a
                 name and how many times they stayed with the group, and
                 nothing more: no hotels, no dates, no amounts (D21-13).
                 It chooses; nothing is joined for it (D21-2, D21-20).
                 A blacklisted guest is a WARNING with its reason, never a
                 refusal (D21-21).
     MANAGERS    the owner, an administrator and the GM: the "possible same
                 person" list, joins and their undo, the blacklist, and
                 Guest 360 - a person's whole history across the group
                 (D21-3, D21-4).

   These live in the guests service because `guests` is its table, and
   because this router is already mounted: the CRM's own server folder
   would need a line in the master's server.ts first. The screens are in
   src/modules/crm (Guest 360, the same-person list) and in the booking
   and walk-in forms (the suggestion).
   ══════════════════════════════════════════════════════════════════ */

export const people = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/** The owner, an administrator or a GM - asked of the database, which holds
    the same question behind every function these routes call, so a route and
    the function under it cannot disagree about who may. */
async function isManager(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>("select app.is_crm_manager() as may");
  return rows[0]?.may === true;
}

const MANAGERS_ONLY = "This is for the owner, an administrator or a general manager.";

/** A refusal the database raised, in the words it was written in. */
function reasonFor(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if ((e?.code === "P0001" || e?.code === "42501") && e.message) return e.message;
  return null;
}

type Answer = { status: 200 | 403 | 404 | 409; body: unknown };
const managersOnly: Answer = { status: 403, body: { error: MANAGERS_ONLY } };
const noProperty: Answer = { status: 404, body: { error: "No such property." } };

/* ── The desk: who is this? ─────────────────────────────────────────
   Asked as the clerk types a phone or an email on a booking or a walk-in.
   Answers only what the desk may see: a suggestion (a name, a count) where
   nothing typed disagrees with what is on file, and a blacklist warning on
   ANY match. A match that is neither is not sent at all - the desk has no
   use for it, and a manager meets it on the same-person list. */
people.get("/:code/guests/returning", async (c) => {
  const phone = c.req.query("phone") ?? "";
  const email = c.req.query("email") ?? "";

  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    const { rows } = await client.query<{
      guest_id: string; full_name: string; visits: number;
      is_blacklisted: boolean; blacklist_reason: string | null; suggested: boolean;
    }>(
      `select guest_id::text, full_name, visits, is_blacklisted, blacklist_reason, suggested
         from app.guest_suggestions($1, $2)
        where suggested or is_blacklisted
        order by suggested desc, visits desc, full_name, guest_id
        limit 5`,
      [phone, email]);

    return {
      status: 200,
      body: {
        matches: rows.map((r) => ({
          /* Only a suggestion carries the id a booking may use - the server
             checks it again when the booking arrives. */
          ...(r.suggested ? { guestId: r.guest_id, visits: r.visits } : {}),
          name: r.full_name,
          suggested: r.suggested,
          blacklisted: r.is_blacklisted,
          blacklistReason: r.is_blacklisted ? r.blacklist_reason : null,
        })),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Managers: the "possible same person" list ─────────────────────
   Records that stand for people and share a phone or an email. Each side
   carries what a manager needs to judge it - never the ID document, only
   whether one is on file (the brief, rule 1). */
type Card = {
  id: string; full_name: string; phone: string | null; email: string | null;
  visits: number; has_id: boolean; is_vip: boolean; is_blacklisted: boolean;
  blacklist_reason: string | null; last_stay: string | null;
};

const cardOf = (r: Card) => ({
  id: r.id, name: r.full_name, phone: r.phone, email: r.email, visits: r.visits,
  hasId: r.has_id, isVip: r.is_vip, isBlacklisted: r.is_blacklisted,
  blacklistReason: r.blacklist_reason, lastStay: r.last_stay,
});

people.get("/:code/crm/same-person", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;

    const { rows: pairs } = await client.query<{
      a: string; b: string; same_phone: boolean; same_email: boolean;
    }>("select a::text, b::text, same_phone, same_email from app.same_person_pairs()");
    if (pairs.length === 0) return { status: 200, body: { pairs: [] } };

    const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
    const { rows: cards } = await client.query<Card>(
      `select id::text, full_name, phone, email, visits, has_id, is_vip,
              is_blacklisted, blacklist_reason, last_stay
         from app.guest_cards($1::uuid[])`, [ids]);
    const byId = new Map(cards.map((r) => [r.id, cardOf(r)]));

    return {
      status: 200,
      body: {
        pairs: pairs
          .filter((p) => byId.has(p.a) && byId.has(p.b))
          .map((p) => ({ a: byId.get(p.a), b: byId.get(p.b),
                         samePhone: p.same_phone, sameEmail: p.same_email }))
          .sort((x, y) => x.a!.name.localeCompare(y.a!.name)),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Managers: joining two records, and taking a join apart ─────── */

people.post("/:code/crm/joins", async (c) => {
  const input = await c.req.json<{ keptId?: string; joinedId?: string }>()
    .catch(() => ({}) as { keptId?: string; joinedId?: string });

  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    if (!input.keptId || !input.joinedId) {
      return { status: 409, body: { ok: false, reason: "Choose the record that stands and the one joined into it." } };
    }
    try {
      const { rows } = await client.query<{ id: string }>(
        "select app.guest_join($1, $2)::text as id", [input.keptId, input.joinedId]);
      return { status: 200, body: { ok: true, joinId: rows[0]!.id } };
    } catch (error) {
      const reason = reasonFor(error);
      if (reason) return { status: 409, body: { ok: false, reason } };
      throw error;
    }
  });
  return c.json(answer.body as object, answer.status);
});

/** The joins that stand, newest first - what a manager may undo. */
people.get("/:code/crm/joins", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    /* LEFT join to staff: a name the viewer may not read is a dash, never a
       join that is hidden (MEMORY 283). */
    const { rows } = await client.query<{
      id: string; kept_id: string; kept_name: string; joined_id: string;
      joined_name: string; stays: number; by: string | null; at: string;
    }>(
      `select j.id::text, j.kept_id::text, k.full_name as kept_name,
              j.joined_id::text, g.full_name as joined_name,
              cardinality(j.reservation_ids) as stays,
              s.full_name as by, j.joined_at::text as at
         from guest_joins j
         join guests k on k.id = j.kept_id
         join guests g on g.id = j.joined_id
         left join staff s on s.id = j.joined_by
        where j.undone_at is null
        order by j.joined_at desc
        limit 100`);
    return {
      status: 200,
      body: {
        joins: rows.map((r) => ({
          id: r.id, keptId: r.kept_id, keptName: r.kept_name,
          joinedId: r.joined_id, joinedName: r.joined_name,
          stays: r.stays, by: r.by, at: r.at,
        })),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});

people.post("/:code/crm/joins/:id/undo", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    try {
      await client.query("select app.guest_join_undo($1)", [c.req.param("id")]);
      return { status: 200, body: { ok: true } };
    } catch (error) {
      const reason = reasonFor(error);
      if (reason) return { status: 409, body: { ok: false, reason } };
      if ((error as { code?: string }).code === "22P02") {
        return { status: 409, body: { ok: false, reason: "There is no such join." } };
      }
      throw error;
    }
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Managers: Guest 360 ─────────────────────────────────────────── */

people.get("/:code/crm/guests", async (c) => {
  const q = c.req.query("q") ?? "";
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    const { rows } = await client.query<{
      id: string; full_name: string; phone: string | null; email: string | null;
      visits: number; is_blacklisted: boolean;
    }>("select id::text, full_name, phone, email, visits, is_blacklisted from app.guest_search($1)", [q]);
    return {
      status: 200,
      body: {
        guests: rows.map((r) => ({
          id: r.id, name: r.full_name, phone: r.phone, email: r.email,
          visits: r.visits, isBlacklisted: r.is_blacklisted,
        })),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});

const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

people.get("/:code/crm/guests/:id", async (c) => {
  const id = c.req.param("id");
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    if (!A_UUID.test(id)) return { status: 404, body: { error: "No such guest." } };
    const { rows } = await client.query<{ whole: unknown }>(
      "select app.guest_360($1) as whole", [id]);
    const whole = rows[0]?.whole;
    return whole ? { status: 200, body: whole } : { status: 404, body: { error: "No such guest." } };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── Managers: the blacklist (D21-21) ──────────────────────────────
   Set with a reason, cleared by the same three. It WARNS the desk at the
   next booking with this phone or email; it never refuses one. */
people.post("/:code/crm/guests/:id/blacklist", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim() ?? "";
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    if (!reason) {
      return { status: 409, body: { ok: false, reason: "Say why. The desk is shown the reason when this guest books again." } };
    }
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    const { rows } = await client.query<{ name: string }>(
      `update guests set is_blacklisted = true, blacklist_reason = $2
        where id = $1 and joined_into is null
        returning full_name as name`, [c.req.param("id"), reason]);
    return rows[0]
      ? { status: 200, body: { ok: true, guest: rows[0].name } }
      : { status: 404, body: { error: "No such guest." } };
  });
  return c.json(answer.body as object, answer.status);
});

people.delete("/:code/crm/guests/:id/blacklist", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "No such guest." } };
    const { rows } = await client.query<{ name: string }>(
      `update guests set is_blacklisted = false, blacklist_reason = null
        where id = $1 and joined_into is null
        returning full_name as name`, [c.req.param("id")]);
    return rows[0]
      ? { status: 200, body: { ok: true, guest: rows[0].name } }
      : { status: 404, body: { error: "No such guest." } };
  });
  return c.json(answer.body as object, answer.status);
});

/* ── "Do not send me offers" (D21-22) ─────────────────────────────
   Against the phone or email itself, for the whole group. The desk records
   it with the booking or the walk-in; these are the managers' own doors on
   Guest 360 - recording one, clearing one - and the list marketing's gate
   will read (src/modules/crm/MODULE.md, the request to the master). */
people.post("/:code/crm/no-offers", async (c) => {
  const input = await c.req.json<{ phone?: string; email?: string }>()
    .catch(() => ({}) as { phone?: string; email?: string });
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    const { rows: keys } = await client.query<{ phone: string | null; email: string | null }>(
      "select app.phone_key($1) as phone, app.email_key($2) as email",
      [input.phone ?? null, input.email ?? null]);
    if (!keys[0]?.phone && !keys[0]?.email) {
      return { status: 409, body: { ok: false, reason: "Give a phone number of ten digits or more, or an email address." } };
    }
    await client.query("select app.record_no_offers($1, $2)", [input.phone ?? null, input.email ?? null]);
    return { status: 200, body: { ok: true } };
  });
  return c.json(answer.body as object, answer.status);
});

people.delete("/:code/crm/no-offers/:id", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    if (!A_UUID.test(c.req.param("id"))) return { status: 404, body: { error: "Nothing like that was recorded." } };
    const { rowCount } = await client.query(
      "delete from offer_opt_outs where id = $1", [c.req.param("id")]);
    return rowCount
      ? { status: 200, body: { ok: true } }
      : { status: 404, body: { error: "Nothing like that was recorded." } };
  });
  return c.json(answer.body as object, answer.status);
});

people.get("/:code/crm/no-offers", async (c) => {
  const answer = await withSession(c.get("subject"), async (client): Promise<Answer> => {
    if (!await hotelIdFor(client, c.req.param("code"))) return noProperty;
    if (!await isManager(client)) return managersOnly;
    const { rows } = await client.query<{ kind: string; value: string }>(
      "select kind, value from offer_opt_outs order by kind, value");
    return {
      status: 200,
      body: {
        phones: rows.filter((r) => r.kind === "phone").map((r) => r.value),
        emails: rows.filter((r) => r.kind === "email").map((r) => r.value),
      },
    };
  });
  return c.json(answer.body as object, answer.status);
});
