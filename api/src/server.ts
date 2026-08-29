import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.ts";
import { healthCheck, closePool } from "./db.ts";
import { subjectFor, Unauthenticated } from "./auth.ts";
import { hotels } from "./routes/hotels.ts";
import { property } from "./routes/property.ts";
import { stays } from "./routes/stays.ts";
import { folios } from "./routes/folios.ts";
import { operations } from "./routes/operations.ts";
import { statistics } from "./routes/statistics.ts";
import { reports } from "./routes/reports.ts";
import { manager } from "./routes/manager.ts";
import { directory } from "./routes/directory.ts";
import { billing } from "./routes/billing.ts";
import { pos, outletFor, type Outlet } from "./routes/pos.ts";
import { nightAudit } from "./routes/nightAudit.ts";

/* ══════════════════════════════════════════════════════════════════
   THE APP API — MASTER.md §5

   Verifies a Firebase ID token, sets `app.user_id`, and talks to
   Postgres as `pms_app`. It decides no permissions of its own: every
   isolation guarantee is a policy in the database, and this process
   exists to make sure the right person's name is on the transaction.
   ══════════════════════════════════════════════════════════════════ */

type Env = {
  Variables: {
    subject: string;
    /* Set only on /api/pos requests. Optional because a person's
       request has no outlet, and the type should say so rather than
       let a handler read one that was never resolved. */
    outlet?: Outlet;
  };
};

const app = new Hono<Env>();

/* When THIS process started. Reported by /health so a stale server is
   visible rather than merely suspected — twice during CP9 a restart
   failed into the log with EADDRINUSE while the OLD process kept
   answering, and correct query output was read as wrong. */
const STARTED_AT = new Date().toISOString();

/* In development Vite takes whatever port is free — 5173, 5199, 5202 —
   so pinning one origin means the first port collision looks like the
   API being down. Production pins exactly one origin and nothing else. */
const originAllowed = (origin: string): string | null => {
  if (origin === env.corsOrigin) return origin;
  if (!env.isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return origin;
  }
  return null;
};

app.use(
  "*",
  cors({
    origin: originAllowed,
    allowHeaders: ["authorization", "content-type", "x-dev-staff-id"],
    credentials: true,
  }),
);

/* ── Health ──────────────────────────────────────────────────────
   Unauthenticated on purpose: a load balancer has no token, and a
   health check that needs one tells you nothing about the database.
   It reports reachability and says nothing about any hotel.       ═══ */
app.get("/health", async (c) => {
  try {
    const { rows } = await healthCheck((client) =>
      client.query<{ role: string; now: string }>(
        "select current_user as role, now()::text as now",
      ),
    );
    const row = rows[0];

    /* Connecting as anything but pms_app means RLS is bypassed and
       every isolation guarantee in the schema is decorative. That is
       worth failing the health check over, not logging. */
    const ok = row?.role === "pms_app";

    return c.json(
      {
        ok,
        database: "reachable",
        role: row?.role ?? null,
        startedAt: STARTED_AT,
        ...(ok ? {} : { error: "Connected as the wrong role. Expected pms_app." }),
      },
      ok ? 200 : 503,
    );
  } catch {
    return c.json({ ok: false, database: "unreachable" }, 503);
  }
});

/* ── Everything under /api needs a subject ───────────────────────
   Applied as middleware rather than per route, so a new route is
   authenticated by existing rather than by remembering.           ═══ */
app.use("/api/*", async (c, next) => {
  /* Two credential schemes, one gate.
     A POS is a machine: it presents an outlet key, not a person's
     bearer token. It would have been easier to narrow the matcher
     above to /api/hotels/* and let the POS routes authenticate
     themselves — and that would have quietly removed the property
     this comment claims, that a NEW route under /api is authenticated
     by existing rather than by remembering. The next route added
     under /api would have been open.
     So the gate learns the second scheme instead. Neither path can be
     skipped, and both end at a staff id that RLS understands. */
  if (c.req.path.startsWith("/api/pos")) {
    const outlet = await outletFor(c.req.header("x-pos-key"));
    if (!outlet) {
      return c.json({ ok: false, reason: "Unknown or inactive POS key." }, 401);
    }
    c.set("outlet", outlet);
    /* The outlet's SERVICE ACCOUNT. Everything downstream runs through
       withUser() as this staff row, so a POS is scoped by exactly the
       same policies as a clerk. */
    c.set("subject", outlet.staffId);
    await next();
    return;
  }

  try {
    c.set("subject", await subjectFor(c.req.raw.headers));
  } catch (error) {
    if (error instanceof Unauthenticated) {
      return c.json({ error: error.message }, 401);
    }
    throw error;
  }
  await next();
});

app.route("/api/hotels", hotels);
app.route("/api/hotels", property);
app.route("/api/hotels", stays);
app.route("/api/hotels", folios);
app.route("/api/hotels", operations);
app.route("/api/hotels", statistics);
app.route("/api/hotels", reports);
app.route("/api/hotels", manager);
app.route("/api/hotels", directory);
app.route("/api/hotels", billing);
app.route("/api/hotels", nightAudit);

/* A POS mounts at its OWN prefix, not under /api/hotels. It does not
   know a hotel code and must not need one: its key resolves to exactly
   one outlet at exactly one property, so a misconfigured terminal
   cannot address a hotel it was never issued for. */
app.route("/api/pos", pos);

app.onError((error, c) => {
  if (error instanceof Unauthenticated) {
    return c.json({ error: error.message }, 401);
  }

  /* The message can name a table, a constraint, or a column. That is
     for the log; the caller gets the fact that it failed. */
  console.error("[api]", c.req.method, c.req.path, error);
  return c.json({ error: "Something went wrong. Nothing was changed." }, 500);
});

app.notFound((c) => c.json({ error: `No route for ${c.req.path}` }, 404));

export { app };

/* Started only when run directly, so the tests can import `app`
   without binding a port. */
if (process.argv[1]?.endsWith("server.ts")) {
  const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(
      `  Fidato PMS API  ·  http://localhost:${info.port}  ·  ${env.nodeEnv}` +
        `  ·  started ${STARTED_AT}`,
    );
  });

  /* EADDRINUSE used to surface as an unhandled stack trace while an
     older process carried on serving the port. Everything then looked
     like it worked, on code that was not running. */
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `\n  Port ${env.port} is already in use — an older API is still ` +
          `serving it.\n  Anything you test now runs against THAT code, ` +
          `not this.\n\n  Windows:  Get-NetTCPConnection -LocalPort ` +
          `${env.port} | Stop-Process -Id { $_.OwningProcess } -Force\n`,
      );
    } else {
      console.error(`\n  The API could not start: ${error.message}\n`);
    }
    process.exit(1);
  });

  const shutdown = async () => {
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
