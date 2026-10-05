import { it, expect, afterAll } from "vitest";
import { wrongDatabase } from "../src/server.ts";
import { pool, closePool } from "../src/db.ts";

/* WHOSE DATABASE (D27-278, option a). Every customer's API logs in as the
   same pms_app, so the API refuses to start unless its CUSTOMER equals its
   database's mark. launch.sh marks a customer's database with
   `alter database … set app.customer`, which every new session then has as
   its setting; a session-level `set` is that same setting, and lets this run
   as pms_app on the test database. */

afterAll(closePool);

it("starts Fidato on an unmarked database, a customer only on its own", async () => {
  const client = await pool.connect();
  try {
    // Fidato today: no mark, no CUSTOMER.
    expect(await wrongDatabase(client, "")).toBeNull();
    expect(await wrongDatabase(client, "abc")).toMatch(/Fidato's, and CUSTOMER is abc/);

    await client.query("set app.customer = 'abc'");
    expect(await wrongDatabase(client, "abc")).toBeNull();
    expect(await wrongDatabase(client, "xyz")).toMatch(/abc's, and CUSTOMER is xyz/);
    // Fidato's API pointed at a customer's database.
    expect(await wrongDatabase(client, "")).toMatch(/abc's, and CUSTOMER is unset/);
  } finally {
    await client.query("reset app.customer");
    client.release();
  }
});
