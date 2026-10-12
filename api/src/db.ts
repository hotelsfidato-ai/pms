import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "./env.ts";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL IN THE ADDRESS (D27-296, test hotels)

   The group's guests, companies and booking groups have no hotel, and a
   test hotel's must never be read on a real screen, nor a real one's in a
   test hotel. The database decides which side a person reads from the hotel
   they are working in - and the one thing that knows that is the address,
   /api/hotels/:code/... server.ts puts the code here for the life of the
   request; withUser hands it to Postgres as `app.hotel_code`, transaction-
   local like `app.user_id`. No code (the administration routes, the jobs):
   the real side.
   ══════════════════════════════════════════════════════════════════ */
export const hotelInView = new AsyncLocalStorage<string>();

/* ══════════════════════════════════════════════════════════════════
   THE POOL, AND THE ONE FUNCTION THAT MATTERS

   Everything about tenant isolation in this system comes down to
   `withUser`. Get it right once and every route inherits it.
   ══════════════════════════════════════════════════════════════════ */

/* Postgres returns numeric/decimal as a string by default, because a
   JS number cannot hold every numeric(12,2) without loss. Money is
   exactly the column where that matters, so it stays a string all the
   way to the wire and the interface parses it once, deliberately. */

/* D27-165 (speed check, 29 Sep): 10 connections and a 5 s wait turned a
   Dashboard's burst into 500s after exactly 5 s. 20 connections, a 30 s
   wait (under nginx's timeouts), and a statement cap so a runaway query
   frees its connection. ponytail: 120 s, not the check's 30 s, because
   /api/ allows 300 s for imports and the night audit; lower it when a
   measured long operation says it can. The 20 is DB_POOL_MAX's default
   (D27-278): one server shared by several customers' APIs divides
   Postgres's connections between them. */
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 120_000,
});

pool.on("error", (err) => {
  /* An idle client erroring must not take the process down. */
  console.error("[db] idle client error", err);
});

export type Client = pg.PoolClient;

/**
 * Runs `fn` inside ONE transaction with the staff member set on it.
 *
 * ⚠ `set_config(..., true)` — the third argument is `is_local`, and it
 *   is the whole security model.
 *
 *   `true`  scopes the setting to THIS TRANSACTION. When the client
 *           returns to the pool it carries nothing.
 *   `false` scopes it to the SESSION. The pooled connection keeps the
 *           setting, hands it to the next request, and that request
 *           runs as the previous clerk. That is a cross-tenant data
 *           breach, not a bug — and it would pass every test that
 *           only ever makes one request at a time.
 *
 * Nothing else in this file is allowed to open a connection. Every
 * query goes through here so there is exactly one place to be wrong.
 */
export async function withUser<T>(
  staffId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [staffId]);
    /* Resolve the person ONCE (30 September, measured by the rates lane). A
       sign-in's subject is a Firebase uid; app.current_user_id() then took its
       exception path and a staff lookup on every call - per policy, per query
       (70 price reads: 3.1 s, 1.1 s after this). Only that function reads the
       setting, so handing it the staff id is the same answer, faster. An
       unknown uid resolves to null and stays as given: still nobody. */
    await client.query(
      `select set_config('app.user_id', coalesce(app.current_user_id()::text, $1), true),
              set_config('app.hotel_code', $2, true)`,
      [staffId, hotelInView.getStore() ?? ""]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* The rollback can fail if the connection died. The original
         error is the one worth reporting; swallowing this one keeps
         it from masking the cause. */
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The health check, and nothing else.
 *
 * There is deliberately no "resolve this Firebase uid to a staff row"
 * helper here. `app.current_user_id()` already accepts a Firebase uid
 * alongside a staff uuid — migration 017 did that work — so the uid
 * goes straight into `withUser` and the session profile is read from
 * `staff` INSIDE the transaction, where the `staff_self` policy
 * (`id = app.current_user_id()`) returns exactly the caller's own row.
 *
 * That means there is no code path that reads a staff row outside RLS.
 */
export async function healthCheck<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
