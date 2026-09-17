import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.ts";
import { healthCheck, closePool } from "./db.ts";
import { subjectFor, Unauthenticated } from "./auth.ts";
import { hotels } from "./routes/hotels.ts";
import { property } from "./routes/property.ts";
/* Every service, through its front door (docs/SERVICE-FOLDERS-PLAN.md). */
import { outletFor, type Outlet } from "./modules/pos/index.ts";
import * as frontDesk from "./modules/front-desk/index.ts";
import * as reservations from "./modules/reservations/index.ts";
import * as finance from "./modules/finance/index.ts";
import * as reportsService from "./modules/reports/index.ts";
import * as guests from "./modules/guests/index.ts";
import * as nightAudit from "./modules/night-audit/index.ts";
import * as pos from "./modules/pos/index.ts";
import * as admin from "./modules/admin/index.ts";
import * as inventory from "./modules/inventory/index.ts";
import * as banquet from "./modules/banquet/index.ts";
import * as stores from "./modules/stores/index.ts";
import * as housekeeping from "./modules/housekeeping/index.ts";
import * as equipment from "./modules/equipment/index.ts";
import * as channelManager from "./modules/channel-manager/index.ts";
import { live } from "./routes/live.ts";
import {
  startListening, stopListening, watcherCount, isListening,
} from "./realtime.ts";
import { approvals } from "./routes/approvals.ts";
import { places } from "./routes/places.ts";
import { reportFiles } from "./routes/reportFiles.ts";
import { attachments } from "./routes/attachments.ts";
import { notifications } from "./routes/notifications.ts";

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
  if (env.corsOrigins.includes(origin)) return origin;
  if (!env.isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    return origin;
  }
  return null;
};

app.use(
  "*",
  cors({
    origin: originAllowed,
    /* A custom header the browser does not already know about needs
       naming here or its preflight fails, and the failure arrives as
       "could not reach the server" — indistinguishable from the API
       being down. The admin console spent a round of debugging on
       exactly that after `x-provisioning-key` was added.

       `x-pos-key` is NOT here on purpose: an outside till is a machine
       calling from a server, not a browser, and it has no preflight to
       satisfy. Adding it would advertise the header to every origin. */
    allowHeaders: [
      "authorization", "content-type", "x-dev-staff-id",
      "x-provisioning-key",
      /* The offline outbox sends this on every retry so a held write
         cannot be applied twice. Missing from this list it cost a
         second round of debugging on the very fault the paragraph
         above warns about: the preflight answers 204, the real request
         is blocked, and the drain reports the server as unreachable
         while the server is plainly up. */
      "idempotency-key",
    ],
    credentials: true,

    /* Without this the browser sends its own default, which in Chrome
       is about five seconds — so a clerk working steadily re-pays a
       preflight round trip every few seconds, on every method and
       header combination. A day is the ceiling browsers will honour
       and the allow-list above changes only on deploy. */
    maxAge: 86400,
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
        /* THE FIRST THING WORTH KNOWING when somebody says the kitchen
           has stopped updating. `live` false means the listener has no
           database connection, so every screen has silently fallen back
           to its slow poll — which looks identical to working until a
           waiter shouts. `screens` is how many are attached right now. */
        realtime: { live: isListening(), ...watcherCount() },
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

/* The core's own routes: the session, the property, the live stream,
   approvals and attachments belong to no one service. */
app.route("/api/hotels", hotels);
app.route("/api/hotels", property);
/* The bell, derived from what several services record and owned by none
   (split out of billing.ts in the service-folder move). */
app.route("/api/hotels", notifications);
/* The live stream. Under /api/hotels like everything else, so it
   inherits the same subject middleware and the same CORS list. */
app.route("/api/hotels", live);
app.route("/api/hotels", approvals);
/* Places and suppliers: shared by the Store, equipment and purchasing. */
app.route("/api/hotels", places);
/* Reports as PDF, .xlsx and CSV, made on the server (D17-31, D17-32). */
app.route("/api/hotels", reportFiles);
app.route("/api/hotels", attachments);

/* Every service's routers, from its own front door. Where each hangs is
   the service's to say (see mount.ts): /api/hotels for a person's routes,
   /api for administration — creating a property is not scoped to a
   property — and /api/pos for an outside till.

   A POS mounts at its OWN prefix, not under /api/hotels. It does not
   know a hotel code and must not need one: its key resolves to exactly
   one outlet at exactly one property, so a misconfigured terminal
   cannot address a hotel it was never issued for.

   The till is person-facing and sits behind the same bearer gate as
   every other /api/hotels route. `/api/pos` is the machine door. */
const SERVICES = [
  frontDesk, reservations, finance, reportsService, guests, nightAudit,
  pos, admin, inventory, banquet, stores, housekeeping, equipment, channelManager,
];
for (const service of SERVICES) {
  for (const [prefix, router] of service.mounts) app.route(prefix, router);
}

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
  /* One connection LISTENing for order changes, fanned out in memory
     to every kitchen and till screen. Started before the port opens so
     the first screen to connect finds it already live. */
  startListening();

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
        `\n  Port ${env.port} is already in use - an older API is still ` +
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
    await stopListening();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
