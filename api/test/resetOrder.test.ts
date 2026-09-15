import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CLEAR } from "../scripts/reset-property.ts";

/* ══════════════════════════════════════════════════════════════════
   A TEARDOWN IS A MIGRATION RUN BACKWARDS

   `reset-property.ts` deletes twenty-odd tables in a fixed order, and
   the order is the whole of it: a child must go before its parent or
   Postgres refuses on a foreign key, halfway through, with the
   append-only guards already lifted.

   ⚠ THE LIST HAD `pos_tickets` BEFORE `pos_orders`, AND
   `pos_orders.ticket_id` REFERENCES `pos_tickets`. It survived every
   local run because the development database has no tickets — the
   delete matched nothing, so no key was ever tested. It failed on the
   first production run, on a property with 17 orders on the file.

   That is the gap this file closes. A list of table names cannot be
   checked by reading it; it can only be checked against the actual
   foreign keys, which is what happens below. The schema is the
   authority and the list has to agree with it.

   ⚠ IT ASKS THE DATABASE, NOT A COPY OF THE ANSWER. A hard-coded map
   of "what references what" would be a second schema to keep in step,
   and the day somebody adds a column this test would still be checking
   last year's shape — passing, and wrong.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

type Edge = { child: string; parent: string };
let edges: Edge[] = [];

beforeAll(async () => {
  const pool = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    const { rows } = await pool.query<Edge>(
      `select c.relname as child, f.relname as parent
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_class f on f.oid = con.confrelid
        where con.contype = 'f' and c.relname <> f.relname`);
    edges = rows;
  } finally { await pool.end(); }
});

afterAll(async () => {
  const { closePool } = await import("../src/db.ts");
  await closePool();
});

describe("the reset deletes children before parents", () => {
  it("reads a foreign-key graph at all", () => {
    /* Without this the whole file passes vacuously against an empty
       list — which is how a guard ends up agreeing with everything. */
    expect(edges.length).toBeGreaterThan(50);
  });

  it("every table it names actually exists", () => {
    /* The first version of the script invented `invoice_lines` and
       `notifications`; neither exists, and the run aborted a third of
       the way through with the guards still lifted. */
    const known = new Set(edges.flatMap((e) => [e.child, e.parent]));
    const invented = CLEAR
      .map(([table]) => table)
      .filter((t) => !known.has(t));
    expect(
      invented,
      `these are deleted by name and no foreign key mentions them — `
      + `check the spelling: ${invented.join(", ")}`,
    ).toEqual([]);
  });

  it("⚠ NEVER DELETES A PARENT BEFORE ITS CHILD", () => {
    const position = new Map(CLEAR.map(([t], i) => [t, i]));

    const wrong = edges
      .filter((e) => position.has(e.child) && position.has(e.parent))
      .filter((e) => position.get(e.parent)! < position.get(e.child)!)
      .map((e) => `${e.parent} is deleted before ${e.child}, which points at it`);

    expect(
      [...new Set(wrong)],
      "the reset would fail on a foreign key part-way through, with the "
      + "append-only guards already lifted:\n  " + wrong.join("\n  "),
    ).toEqual([]);
  });
});
