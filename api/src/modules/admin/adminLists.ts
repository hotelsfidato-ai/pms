import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { mayRead, ADMIN_READ_REFUSED, type AdminRead } from "./grants.ts";

/* ══════════════════════════════════════════════════════════════════
   STAFF, THE AUDIT LOG AND SETTINGS

   Split out of api/src/routes/directory.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: admin.
   Every endpoint is unchanged, byte for byte, and the router keeps the
   name it had there. `hotelIdFor` is a copy of the one beside it in
   modules/guests/directory.ts — each route file keeps its own.
   ══════════════════════════════════════════════════════════════════ */

const directory = new Hono<{ Variables: { subject: string } }>();
export { directory as adminLists };

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/* WHO IS ASKING comes before the read (D17-15). The callback hands back
   this marker and the route answers 403 with a sentence naming who may —
   the shape the Store's routes use. */
const forbid = (what: AdminRead) => ({ forbidden: what });
const forbidden = (what: AdminRead) =>
  ({ ok: false as const, reason: ADMIN_READ_REFUSED[what] });

/* ── Staff and access ────────────────────────────────────────────── */


/**
 * The real staff list.
 *
 * The frontend generated this from the permission matrix — one fake
 * person per role, all at one property named from a fixture — with a
 * comment carrying its own removal condition: "`staff_hotels` IS
 * readable to a group admin now, so this becomes a real list the moment
 * there are real accounts."
 *
 * There are. Password sign-in is still stubbed; the staff rows and
 * their property grants are not.
 *
 * RLS does the filtering. `staff_self` and the `staff_hotels` policies
 * decide what a caller may see, so a front-desk clerk running this gets
 * themselves and a group admin gets everybody — from the same SQL.
 */
directory.get("/:code/staff", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; full_name: string; email: string;
      is_group_admin: boolean; is_active: boolean;
      roles: string | null; properties: string | null;
    }>(
      `select s.id::text, s.full_name, s.email::text,
              s.is_group_admin, s.is_active,
              (select string_agg(distinct sh.role, ',' order by sh.role)
                 from staff_hotels sh where sh.staff_id = s.id) as roles,
              (select string_agg(distinct h.name, ', ' order by h.name)
                 from staff_hotels sh
                 join hotels h on h.id = sh.hotel_id
                where sh.staff_id = s.id) as properties
         from staff s
        order by s.is_group_admin desc, s.full_name`,
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.full_name,
      email: r.email,
      /* A group admin holds NO staff_hotels rows and reaches everything
         — app.auth_hotel_ids() accounts for that. Reporting an empty
         role list beside the flag would read as "no access" when the
         truth is the opposite. */
      role: r.is_group_admin ? "owner" : (r.roles?.split(",")[0] ?? null),
      roles: r.roles ? r.roles.split(",") : [],
      isGroupAdmin: r.is_group_admin,
      properties: r.is_group_admin
        ? "every property"
        : (r.properties ?? null),
      status: r.is_active ? "active" : "inactive",
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Audit log ───────────────────────────────────────────────────── */

directory.get("/:code/audit-log", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRead(client, hotelId, "audit_log"))) return forbid("audit_log");

    /* The ledger IS the audit trail for money. It is append-only, so
       every posting and every reversal is already a permanent record —
       nothing is stored twice to produce this. */
    const { rows } = await client.query<{
      id: string; at: string; business_date: string; category: string;
      description: string; guest: string; room: string | null;
      reverses_id: string | null; actor: string | null;
    }>(
      /* WHO, BY NAME (ADM-1, D17-14). This said `actor: "admin"` for every
         row. `app.posted_by_name` (101) reads `posted_by`, which 101 also
         made every posting record — and it names somebody who has since
         lost their access, where a join to `staff` would print a dash for
         anybody the reader cannot see. NULL when nobody was recorded:
         postings made before 101 at the desk, and bulk loads. */
      `select fp.id::text, fp.created_at::text as at,
              fp.business_date::text, fp.category, fp.description,
              app.posted_by_name(fp.id) as actor,
              g.full_name as guest,
              (select rm.number from room_assignments ra
                 join rooms rm on rm.id = ra.room_id
                where ra.reservation_id = r.id
                order by ra.released_at desc nulls first, ra.from_date desc
                limit 1) as room,
              fp.reverses_id::text
         from folio_postings fp
         join folios f       on f.id = fp.folio_id
         join reservations r on r.id = f.reservation_id
         join guests g       on g.id = r.guest_id
        where fp.hotel_id = $1
        order by fp.created_at desc, fp.id desc
        limit 500`,
      [hotelId],
    );

    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      businessDate: r.business_date,
      actor: r.actor,
      action: r.reverses_id
        ? "Reversed a posting"
        : r.category === "payment"
          ? "Took a payment"
          : "Posted a charge",
      subject: `${r.guest}${r.room ? ` · room ${r.room}` : ""}`,
      detail: r.description,
      kind: r.reverses_id ? "reversal" : r.category === "payment" ? "payment" : "charge",
    }));
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(forbidden(body.forbidden), 403);
  return c.json(body);
});

/* ── Settings ────────────────────────────────────────────────────── */

directory.get("/:code/settings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await mayRead(client, hotelId, "setting"))) return forbid("setting");

    const { rows } = await client.query<{
      name: string; address_line: string | null; city: string;
      gstin: string | null; currency: string; timezone: string;
      check_in: string; check_out: string;
      sellable: string; room_types: string[]; plans: string[];
    }>(
      `select h.name, h.address_line, h.city, h.gstin, h.currency, h.timezone,
              to_char(h.check_in_time,  'HH24:MI') as check_in,
              to_char(h.check_out_time, 'HH24:MI') as check_out,
              /* The dated block, as availability reads it (INV-6, D17-11). */
              app.sellable_rooms(h.id, app.business_date(h.id))::text as sellable,
              (select array_agg(rt.name order by rt.sort_order)
                 from room_types rt where rt.hotel_id = h.id and rt.is_active) as room_types,
              (select array_agg(mp.code order by mp.code) from meal_plans mp)  as plans
         from hotels h where h.id = $1`,
      [hotelId],
    );

    const h = rows[0];
    if (!h) return null;

    return [
      {
        title: "Property",
        rows: [
          { label: "Name", value: h.name },
          { label: "Address", value: h.address_line ?? h.city },
          /* As stored, or "-" where nobody has set one (ADM-2, D17-49). It
             said "— demo, not a real GSTIN" after every property's GSTIN,
             including a real one. */
          { label: "GSTIN", value: h.gstin ?? "-" },
          { label: "Currency", value: h.currency },
          { label: "Time zone", value: h.timezone },
        ],
      },
      {
        title: "Operations",
        rows: [
          { label: "Check-in", value: h.check_in },
          { label: "Check-out", value: h.check_out },
          { label: "Sellable rooms", value: h.sellable },
          { label: "Room types", value: (h.room_types ?? []).join(" · ") },
          { label: "Rate plans", value: (h.plans ?? []).join(" · ") },
        ],
      },
      {
        title: "Tax and billing",
        /* ADM-2, the owner's decision D17-37: show the tax actually used.
           This printed `hotels.cgst_rate` and `sgst_rate` — 2.5% + 2.5% —
           "editable at Stage 8", a flat pair migration 067 replaced with
           `tax_rules`, which nothing here read. The rules are finance's and
           are read from finance's own `GET /:code/tax` by the screen
           (`TaxInUse`), so Settings and the Properties cards print one
           answer from one reader; `taxInUse` says where they go. */
        note:
          "GST is set on Room types, under GST. The front desk and the till "
          + "both charge what is shown here.",
        taxInUse: true,
        rows: [
          { label: "Financial year starts", value: "1 April" },
        ],
      },
    ];
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json(forbidden(body.forbidden), 403);
  return c.json(body);
});
