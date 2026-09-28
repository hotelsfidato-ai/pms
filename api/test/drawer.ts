/* ══════════════════════════════════════════════════════════════════
   A CASH DRAWER FOR A TEST (the owner's D27-118, 28 September)

   Cash is taken only into an open drawer, so a test that takes cash opens
   one for the person paying it in first - and removes it after, because the
   night audit will not close a day over an open drawer, and the next file
   may close one. `who` is a staff id, a sign-in uid or an email; `hotel` is
   the property's code.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[]): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

/** Opens the drawer (or finds the one already open) and answers how to put it away. */
export async function openDrawer(hotel: string, who: string): Promise<() => Promise<void>> {
  const [made] = await sql<{ id: string | null }>(
    `with me as (select s.id from staff s
                  where s.id::text = $2 or s.firebase_uid = $2 or s.email::text = $2 limit 1),
          h as (select id from hotels where code = upper($1))
     insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_by)
     select h.id, me.id, app.business_date(h.id), 0, me.id from h, me
     on conflict do nothing
     returning id::text`, [hotel, who]);
  /* Already open before this test: it is somebody else's to put away. */
  if (!made?.id) return async () => {};
  return async () => { await sql("delete from cashier_shifts where id = $1::uuid", [made.id]); };
}

/** `run` with a drawer open for `who`, put away afterwards whatever happens. */
export async function withDrawer<T>(hotel: string, who: string, run: () => T | Promise<T>): Promise<T> {
  const close = await openDrawer(hotel, who);
  try { return await run(); } finally { await close(); }
}
