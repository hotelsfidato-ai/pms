import { Hono } from "hono";
import { createHash } from "node:crypto";
import { withSession } from "../auth.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   ADMINISTRATION — the writes

   Everything under /admin was READ-ONLY until this file existed. The
   screens listed staff, roles, the audit log and the properties, and
   nothing could be changed: `grep -c '<input|<form'` on the admin page
   returned 0, and there was not a single admin write endpoint.

   The database was ready the whole time — app.provision_property()
   creates a property, its room types and its rooms in one transaction,
   and pms_app could already execute it. What was missing was a door.

   TWO GUARDS, ANSWERING DIFFERENT QUESTIONS

     app.require_group_admin()       WHO is asking
     app.require_provisioning_key()  whether this DEPLOYMENT permits it

   Both run inside the database, on every structural call. A stolen
   admin session passes the first and must not pass the second, which
   is the entire reason the second exists.

   THE KEY NEVER REACHES POSTGRES. This file hashes it and sends the
   digest, so the key does not appear in a query log, a slow-query
   report, or `pg_stat_activity`.
   ══════════════════════════════════════════════════════════════════ */

export const admin = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The provisioning key for this request.
 *
 * Read from the header the admin screen sends. It is NOT read from the
 * server's environment: a key baked into the deployment would make
 * every session that reaches this API a provisioning session, which is
 * exactly the thing the key exists to prevent. A person types it, or
 * their client holds it.
 */
const keyDigest = (raw: string | undefined): string | null =>
  raw && raw.trim() ? sha256(raw.trim()) : null;

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** A refusal the database raised, turned into a reason a person reads. */
function reasonFor(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e?.code) return null;
  /* 42501 insufficient_privilege — either guard. P0001 raise exception.
     23505 unique_violation — the code is taken. Everything else is a
     fault, not an answer, and belongs in the log rather than on screen. */
  if (e.code === "42501" || e.code === "P0001") return e.message ?? "Refused.";
  if (e.code === "23505") {
    return "That code is already in use by another property.";
  }
  return null;
}

/* ── Properties ───────────────────────────────────────────────────── */

admin.post("/admin/hotels", async (c) => {
  type Body = {
    code?: string; name?: string; city?: string; state?: string;
    gstin?: string; templateSet?: string; timezone?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  const city = input.city?.trim();

  if (!code) return c.json(refuse("A property needs a code."), 409);
  if (!name) return c.json(refuse("A property needs a name."), 409);
  if (!city) return c.json(refuse("Which city is it in?"), 409);

  /* The code appears in every URL, every invoice series and every
     folio reference. It is not renameable in practice, so it is worth
     refusing a bad one now rather than living with it. */
  if (!/^[A-Z0-9]{2,8}$/.test(code)) {
    return c.json(refuse(
      "A code is 2–8 letters or digits, no spaces — it appears in every " +
      "URL and every invoice number, and it cannot be changed later.",
    ), 409);
  }

  const digest = keyDigest(c.req.header("x-provisioning-key"));
  if (!digest) {
    return c.json(refuse(
      "This action needs the provisioning key. Creating a property " +
      "manufactures a whole tenant — rooms, an invoice series, a folio " +
      "namespace — so a signed-in session is not enough on its own.",
    ), 403);
  }

  try {
    const result = await withSession(c.get("subject"), async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select app.provision_property(
           p_code => $1, p_name => $2, p_city => $3, p_key_hash => $4,
           p_state => $5, p_gstin => $6, p_template_set => $7
         )::text as id`,
        [code, name, city, digest, input.state ?? null, input.gstin ?? null,
         input.templateSet ?? "standard"],
      );

      /* Room TYPES arrive from the template; ROOMS do not.
         provision_property() clones the type catalogue and stops, and
         app.bulk_create_rooms() is a separate act because a property's
         numbering is the one thing a template cannot guess. Reporting a
         room count here would have printed 0 and read like a failure. */
      const { rows: made } = await client.query<{ types: string }>(
        `select count(*)::text as types from room_types where hotel_id = $1`,
        [rows[0]!.id],
      );

      return {
        ok: true as const,
        id: rows[0]!.id,
        code, name,
        roomTypes: Number(made[0]!.types),
        rooms: 0,
        next: "Add its rooms — the property has its type catalogue but no rooms yet.",
      };
    });
    return c.json(result);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── Staff ────────────────────────────────────────────────────────── */

admin.get("/admin/staff", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      id: string; email: string; full_name: string;
      is_group_admin: boolean; is_active: boolean; hotels: string | null;
    }>(
      /* RLS decides what comes back. A group admin sees everyone; a
         clerk sees themselves and the colleagues they share a property
         with. This query does not filter — migration 027 does. */
      `select s.id::text, s.email::text, s.full_name,
              s.is_group_admin, s.is_active,
              (select string_agg(h.code || ':' || sh.role, ',' order by h.code)
                 from staff_hotels sh join hotels h on h.id = sh.hotel_id
                where sh.staff_id = s.id) as hotels
         from staff s
        order by s.is_group_admin desc, s.full_name`,
    );

    return {
      staff: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.full_name,
        isGroupAdmin: r.is_group_admin,
        isActive: r.is_active,
        access: (r.hotels ?? "").split(",").filter(Boolean).map((pair) => {
          const [code, role] = pair.split(":");
          return { code: code!, role: role! };
        }),
      })),
    };
  });
  return c.json(body);
});

admin.post("/admin/staff", async (c) => {
  type Body = { email?: string; name?: string; isGroupAdmin?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const email = input.email?.trim().toLowerCase();
  const name = input.name?.trim();
  if (!email || !email.includes("@")) {
    return c.json(refuse("A working email address is required — it is how " +
      "they sign in."), 409);
  }
  if (!name) return c.json(refuse("What is their name?"), 409);

  /* A group admin can reach every property's data. Minting one is a
     structural act, so it takes the key; an ordinary clerk does not. */
  const wantsAdmin = input.isGroupAdmin === true;
  const digest = keyDigest(c.req.header("x-provisioning-key"));
  if (wantsAdmin && !digest) {
    return c.json(refuse(
      "Making somebody a group administrator needs the provisioning key. " +
      "They would be able to reach every property.",
    ), 403);
  }

  try {
    const result = await withSession(c.get("subject"), async (client) => {
      await client.query("select app.require_group_admin()");
      if (wantsAdmin) {
        await client.query("select app.require_provisioning_key($1)", [digest]);
      }

      const { rows } = await client.query<{ id: string; existed: boolean }>(
        /* on conflict, because a person re-invited is the common case and
           an error there teaches an admin to avoid the screen. Their
           property access is untouched — that is a separate act. */
        `insert into staff (email, full_name, is_group_admin)
         values ($1, $2, $3)
         on conflict (email) do update
           set full_name = excluded.full_name,
               is_active = true
         returning id::text, (xmax <> 0) as existed`,
        [email, name, wantsAdmin],
      );

      return {
        ok: true as const,
        id: rows[0]!.id,
        email, name,
        existed: rows[0]!.existed,
      };
    });
    return c.json(result);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── Who may see which property ───────────────────────────────────── */

admin.post("/admin/staff/:id/access", async (c) => {
  type Body = { code?: string; role?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const role = input.role?.trim();
  if (!code) return c.json(refuse("Which property?"), 409);
  if (!role) return c.json(refuse("Which role at that property?"), 409);

  try {
    const result = await withSession(c.get("subject"), async (client) => {
      await client.query("select app.require_group_admin()");

      const hotelId = await hotelFor(client, code);
      if (!hotelId) return refuse(`No property with code ${code}.`);

      /* THIS ROW IS THE ISOLATION.

         `app.auth_hotel_ids()` reads staff_hotels, and every RLS policy
         on every scoped table is built on it. Writing here is what
         actually decides which property's data a person can see —
         the navigation and the route guard are the courtesy layer. */
      await client.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         values ($1, $2, $3)
         on conflict (staff_id, hotel_id) do update set role = excluded.role`,
        [c.req.param("id"), hotelId, role],
      );

      return { ok: true as const, code, role };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

admin.delete("/admin/staff/:id/access/:code", async (c) => {
  try {
    const result = await withSession(c.get("subject"), async (client) => {
      await client.query("select app.require_group_admin()");

      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return refuse("No such property.");

      const { rowCount } = await client.query(
        "delete from staff_hotels where staff_id = $1 and hotel_id = $2",
        [c.req.param("id"), hotelId],
      );
      if (!rowCount) return refuse("They did not have access to that property.");

      return { ok: true as const };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

admin.post("/admin/staff/:id/deactivate", async (c) => {
  try {
    const result = await withSession(c.get("subject"), async (client, session) => {
      await client.query("select app.require_group_admin()");

      /* Locking yourself out is not a thing the system should help with,
         and on a single-admin deployment it is unrecoverable from the
         interface. */
      if (c.req.param("id") === session.staffId) {
        return refuse(
          "You cannot deactivate your own account. Somebody else with " +
          "administrator access has to do it.",
        );
      }

      /* Deactivated, never deleted. Their name is on folio postings,
         invoices and the audit log, and a deleted row makes every one
         of those unattributable. */
      const { rowCount } = await client.query(
        "update staff set is_active = false where id = $1 and is_active",
        [c.req.param("id")],
      );
      if (!rowCount) return refuse("That account is already inactive.");

      return { ok: true as const };
    });
    return c.json(result, "ok" in result && result.ok ? 200 : 409);
  } catch (error) {
    const reason = reasonFor(error);
    if (reason) return c.json(refuse(reason), 403);
    throw error;
  }
});

/* ── The administrator's own dashboard ────────────────────────────── */

/**
 * Not the group dashboard.
 *
 * That one answers "how did the hotels trade" — occupancy, ADR, RevPAR.
 * This answers "who is using this system and what did they change",
 * which is a different question with a different audience, and the data
 * for it was already being written: 16 tables carry an audit trail with
 * an actor and a timestamp.
 */
admin.get("/admin/overview", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows: staff } = await client.query<{
      total: string; active: string; admins: string; unassigned: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where is_active)::text as active,
              count(*) filter (where is_group_admin)::text as admins,
              count(*) filter (
                where is_active and not is_group_admin
                  and not exists (select 1 from staff_hotels sh
                                   where sh.staff_id = staff.id)
              )::text as unassigned
         from staff`,
    );

    const { rows: hotels } = await client.query<{
      total: string; rooms: string;
    }>(
      `select count(*)::text as total,
              (select count(*) from rooms)::text as rooms
         from hotels`,
    );

    /* Fourteen days, by day. Enough to see a weekend, short enough that
       a quiet Tuesday is visible rather than averaged away. */
    const { rows: activity } = await client.query<{
      day: string; actions: string; people: string;
    }>(
      `select to_char(at::date,'YYYY-MM-DD') as day,
              count(*)::text as actions,
              count(distinct actor)::text as people
         from audit_log
        where at >= now() - interval '14 days'
        group by at::date
        order by at::date`,
    );

    const { rows: byTable } = await client.query<{
      table_name: string; action: string; n: string;
    }>(
      `select table_name, action, count(*)::text as n
         from audit_log
        where at >= now() - interval '30 days'
        group by table_name, action
        order by count(*) desc
        limit 12`,
    );

    /* Who did what, most recent first. The actor is joined rather than
       shown as a uuid: an audit trail nobody can read is a compliance
       artefact, not a tool. */
    const { rows: recent } = await client.query<{
      at: string; actor: string | null; table_name: string;
      action: string; hotel: string | null;
    }>(
      `select to_char(a.at,'DD Mon HH24:MI') as at,
              s.full_name as actor, a.table_name, a.action, h.code as hotel
         from audit_log a
         left join staff s on s.id = a.actor
         left join hotels h on h.id = a.hotel_id
        order by a.at desc
        limit 25`,
    );

    return {
      staff: {
        total: Number(staff[0]!.total),
        active: Number(staff[0]!.active),
        admins: Number(staff[0]!.admins),
        /* Somebody who can sign in and reach nothing. A real state, and
           one nobody notices without being told. */
        unassigned: Number(staff[0]!.unassigned),
      },
      properties: {
        total: Number(hotels[0]!.total),
        rooms: Number(hotels[0]!.rooms),
      },
      activity: activity.map((r) => ({
        day: r.day, actions: Number(r.actions), people: Number(r.people),
      })),
      byTable: byTable.map((r) => ({
        table: r.table_name, action: r.action, count: Number(r.n),
      })),
      recent: recent.map((r) => ({
        at: r.at,
        /* Null when a migration or the demo loader acted. Shown as a
           dash rather than invented as "System". */
        actor: r.actor,
        table: r.table_name,
        action: r.action,
        hotel: r.hotel,
      })),
    };
  });
  return c.json(body);
});
