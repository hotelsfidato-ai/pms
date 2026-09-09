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

/* ⚠ WRITTEN AFTER THE ENDPOINTS BELOW WERE FOUND UNGUARDED.
   `provision_property` and the access grant raise from inside the
   DATABASE if the caller is not a group admin, which is why those held.
   The four routes added for §2 wrote through plain UPDATEs instead —
   and a plain UPDATE under row level security that matches nothing
   returns rowCount 0 and no error at all.

   So a receptionist calling PATCH /admin/hotels/5EL got **200 ok**, the
   property was not renamed, and the screen would have shown a saved
   change that never happened. Silently doing nothing and reporting
   success is worse than a refusal: nobody goes looking.

   Two things fix it, and both are needed. This says WHY, in a sentence,
   where a person will read it. `changedOrRefuse` makes it impossible
   for a write that touched nothing to report success — because the day
   a policy changes, the check that matters is the one on the result.  */
async function requireGroupAdmin(
  client: Client,
): Promise<{ ok: false; reason: string } | null> {
  const { rows } = await client.query<{ is_group_admin: boolean }>(
    "select is_group_admin from staff where id = app.current_user_id()",
  );
  if (rows[0]?.is_group_admin) return null;
  return refuse(
    "Only a group administrator can change properties and people. " +
    "Ask whoever holds that access.",
  );
}

/** A write that matched no row did not happen, whatever it returned. */
function changedOrRefuse(
  rowCount: number | null, what: string,
): { ok: false; reason: string } | null {
  if (rowCount && rowCount > 0) return null;
  return refuse(
    `Nothing was changed — ${what}. This is not a saved change; it is a ` +
    `write that matched nothing.`,
  );
}

/* ── Editing a property ────────────────────────────────────────────
   §2 asks for it and there was nothing. Note what is NOT editable: the
   code. It appears in every URL, every invoice number and every folio
   reference, so changing it would orphan documents a hotel has already
   given to guests and to an assessor. Creating a property refuses a bad
   code loudly for exactly this reason.
   ═══════════════════════════════════════════════════════════════════ */
/* ── Every property, closed ones included ──────────────────────────
   ⚠ WITHOUT THIS, "CLOSE" IS A ONE-WAY DOOR. `GET /api/hotels` ends
   `where is_active`, so a closed property disappears from every list
   the interface has — including the one carrying the Reopen button.
   Building close/reopen against that endpoint would have shipped a
   button that deletes a property from the screen and a reopen endpoint
   nothing could reach, which is the exact defect this session has been
   closing all day.

   Group admins only, because it also carries the GSTIN and the contact
   details of every property in the group — the thing migration 031 was
   written to stop leaking to a clerk at one hotel.
   ═══════════════════════════════════════════════════════════════════ */
admin.get("/admin/hotels", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rows } = await client.query<{
      id: string; code: string; name: string;
      city: string | null; state: string | null; gstin: string | null;
      phone: string | null; email: string | null; address_line: string | null;
      is_active: boolean; rooms: string; room_types: string | null;
      checked_in: string;
    }>(
      `select h.id::text, h.code, h.name, h.city, h.state, h.gstin,
              h.phone, h.email::text, h.address_line, h.is_active,
              (select count(*) from rooms r
                where r.hotel_id = h.id and r.is_active)::text as rooms,
              (select string_agg(rt.name, ', ' order by rt.sort_order)
                 from room_types rt
                where rt.hotel_id = h.id and rt.is_active) as room_types,
              /* What Close would refuse over, shown BEFORE the button is
                 pressed rather than as a refusal afterwards. */
              (select count(*) from reservations res
                where res.hotel_id = h.id
                  and res.status = 'checked_in')::text as checked_in
         from hotels h
        order by h.is_active desc, h.code`);

    return {
      hotels: rows.map((r) => ({
        id: r.id, code: r.code, name: r.name,
        city: r.city, state: r.state, gstin: r.gstin,
        phone: r.phone, email: r.email, addressLine: r.address_line,
        isActive: r.is_active,
        rooms: Number(r.rooms),
        /* Empty rather than null: a property with no room types is a
           property nobody has set up yet, and the screen says so. */
        roomTypes: (r.room_types ?? "").split(", ").filter(Boolean),
        checkedIn: Number(r.checked_in),
      })),
    };
  });

  if (body && "ok" in body && body.ok === false) return c.json(body, 403);
  return c.json(body);
});

admin.patch("/admin/hotels/:code", async (c) => {
  type Body = {
    name?: string; city?: string; state?: string; gstin?: string;
    phone?: string; email?: string; addressLine?: string;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const name = input.name?.trim();
    const city = input.city?.trim();
    if (name !== undefined && !name) {
      return refuse("A property needs a name.");
    }
    if (city !== undefined && !city) {
      return refuse("Which city is it in?");
    }

    /* ⚠ THE GSTIN PRINTS ON EVERY INVOICE THIS PROPERTY ISSUES. A typo
       here is a typo on documents already in a guest's hands, so the
       shape is checked rather than trusted — fifteen characters, the
       state code first. Not a checksum: that would refuse a valid
       number if the algorithm here were subtly wrong, and refusing a
       real GSTIN is worse than accepting a malformed one somebody can
       correct. */
    const gstin = input.gstin?.trim().toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      return refuse(
        "That does not look like a GSTIN — fifteen characters, starting " +
        "with the two-digit state code. It prints on every invoice this " +
        "property issues, so it is worth checking now.",
      );
    }

    const updated = await client.query(
      `update hotels set
         name         = coalesce($2, name),
         city         = coalesce($3, city),
         state        = coalesce($4, state),
         gstin        = coalesce($5, gstin),
         phone        = coalesce($6, phone),
         email        = coalesce($7, email),
         address_line = coalesce($8, address_line)
       where id = $1`,
      [hotelId, name ?? null, city ?? null,
       input.state?.trim() || null, gstin || null,
       input.phone?.trim() || null, input.email?.trim() || null,
       input.addressLine?.trim() || null],
    );
    const nothing = changedOrRefuse(
      updated.rowCount, "that property is not one you can write to");
    if (nothing) return nothing;

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Closing and reopening a property ──────────────────────────────
   NOT the same as deleting one, which 066 already handles and which
   refuses the moment a property has traded. A hotel that has taken a
   booking must never disappear — its folios, invoices and Form C
   filings are records somebody may have to produce years later. A hotel
   that is closed for the season simply stops appearing in pickers.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/hotels/:code/:state", async (c) => {
  const state = c.req.param("state");
  if (state !== "close" && state !== "reopen") {
    return c.json(refuse("A property is closed or reopened."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (state === "close") {
      /* ⚠ A CLOSED PROPERTY WITH SOMEBODY STILL IN IT is a guest nobody
         can check out — the property vanishes from the picker and the
         folio with it. Named rather than silently allowed. */
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from reservations
          where hotel_id = $1 and status = 'checked_in'`,
        [hotelId],
      );
      if (Number(rows[0]!.n) > 0) {
        return refuse(
          `${rows[0]!.n} guest(s) are still checked in. Check them out ` +
          `first — a closed property leaves a folio nobody can reach.`,
        );
      }
    }

    const { rowCount } = await client.query(
      "update hotels set is_active = $2 where id = $1",
      [hotelId, state === "reopen"],
    );
    const nothing = changedOrRefuse(
      rowCount, "that property is not one you can write to");
    if (nothing) return nothing;

    return { ok: true as const, isActive: state === "reopen" };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Editing a person ──────────────────────────────────────────────
   Their name, their phone. NOT their email: that is what a Firebase
   account is keyed on, and changing it here without changing it there
   leaves somebody who can sign in and reaches nothing — the silent
   empty-database failure the deploy README warns about at length.
   ═══════════════════════════════════════════════════════════════════ */
admin.patch("/admin/staff/:id", async (c) => {
  type Body = { fullName?: string; phone?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const fullName = input.fullName?.trim();
  if (fullName !== undefined && !fullName) {
    return c.json(refuse("A person needs a name."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rowCount } = await client.query(
      `update staff set
         full_name = coalesce($2, full_name),
         phone     = coalesce($3, phone)
       where id = $1`,
      [c.req.param("id"), fullName ?? null, input.phone?.trim() || null],
    );
    if (!rowCount) return refuse("No such person.");
    return { ok: true as const };
  });

  return c.json(result!, "ok" in result! && result!.ok ? 200 : 409);
});

/* ── Bringing somebody back ────────────────────────────────────────
   Deactivating existed; reactivating did not, so a person switched off
   by mistake needed somebody with database access to undo it.
   ═══════════════════════════════════════════════════════════════════ */
admin.post("/admin/staff/:id/reactivate", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const denied = await requireGroupAdmin(client);
    if (denied) return denied;

    const { rows } = await client.query<{ uid: string | null }>(
      `update staff set is_active = true where id = $1
       returning firebase_uid as uid`,
      [c.req.param("id")],
    );
    if (!rows[0]) return refuse("No such person.");

    /* ⚠ ACTIVE WITH NO FIREBASE ACCOUNT SIGNS IN NOWHERE. Said at the
       moment it becomes true rather than discovered by the person on
       their first morning back. */
    if (!rows[0].uid) {
      return {
        ok: true as const,
        warning:
          "They are active again, but they have no sign-in account linked. " +
          "Add them in Firebase and run `npm run link-staff`, or they will " +
          "reach a sign-in page that accepts nothing.",
      };
    }
    return { ok: true as const };
  });

  return c.json(result!, "ok" in result! && result!.ok ? 200 : 409);
});

admin.get("/admin/staff", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      id: string; email: string; full_name: string; phone: string | null;
      is_group_admin: boolean; is_active: boolean; hotels: string | null;
    }>(
      /* RLS decides what comes back. A group admin sees everyone; a
         clerk sees themselves and the colleagues they share a property
         with. This query does not filter — migration 027 does. */
      /* ⚠ AND THE PHONE. `PATCH /admin/staff/:id` has always accepted
         one and this query never returned it, so an edit form would
         open with the box empty and save that emptiness over whatever
         was there. Half a round trip is worse than none. */
      `select s.id::text, s.email::text, s.full_name, s.phone,
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
        phone: r.phone,
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

  /* ⚠ THIS PASSED ANYTHING STRAIGHT THROUGH TO THE CHECK CONSTRAINT, and
     three of the roles the screen offered were not in it. Assigning
     Admin, Manager or Viewer returned

         500  "Something went wrong. Nothing was changed."

     which tells a person nothing and reads as the system being broken.
     078 gave the database and the interface one list; this asks it, so
     an unknown role is a sentence naming what IS allowed. */
  const known = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ roles: string[] }>(
      "select app.assignable_roles() as roles",
    );
    return rows[0]!.roles;
  });
  if (!known.includes(role)) {
    return c.json(
      refuse(`There is no "${role}" role. Choose one of: ${known.join(", ")}.`),
      409,
    );
  }

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
