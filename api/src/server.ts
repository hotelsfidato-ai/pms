import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.ts";
import { healthCheck, closePool } from "./db.ts";
import { subjectFor, Unauthenticated } from "./auth.ts";
import { roleGate } from "./roleGate.ts";
import { telemetry, routeOf, errorKind } from "./telemetry.ts";
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
import * as purchasing from "./modules/purchasing/index.ts";
import * as laundry from "./modules/laundry/index.ts";
import * as spa from "./modules/spa/index.ts";
import * as revenueManagement from "./modules/revenue-management/index.ts";
import * as accounting from "./modules/accounting/index.ts";
import * as onlineCheckin from "./modules/online-checkin/index.ts";
import * as guestMessaging from "./modules/guest-messaging/index.ts";
import * as reputation from "./modules/reputation/index.ts";
import * as marketing from "./modules/marketing/index.ts";
import * as leads from "./modules/leads/index.ts";
import * as crs from "./modules/crs/index.ts";
import * as guestServices from "./modules/guest-services/index.ts";
import * as loyalty from "./modules/loyalty/index.ts";
import { live } from "./routes/live.ts";
import {
  startListening, stopListening, watcherCount, isListening,
} from "./realtime.ts";
import { approvals } from "./routes/approvals.ts";
import { places } from "./routes/places.ts";
import { reportFiles } from "./routes/reportFiles.ts";
import { guestDoor, guestLinks } from "./routes/guestDoor.ts";
import { attachments } from "./routes/attachments.ts";
import { notifications } from "./routes/notifications.ts";

/* ══════════════════════════════════════════════════════════════════
   THE APP API — MASTER.md §5

   Verifies a Firebase ID token, sets `app.user_id`, and talks to
   Postgres as `pms_app`. Which HOTEL is a policy in the database, and
   this process makes sure the right person's name is on the transaction.
   Which ROLE may write is the one question it asks itself: roleGate.ts,
   from the matrix the website reads (api/src/permissions.ts).
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
    /* The browser hides every response header but a handful from a page on
       another origin. A downloaded report's name is in Content-Disposition
       (routes/reportFiles.ts); unexposed, the website on
       pms.fidatohotels.com could not read it and every file would save
       under a made-up name. */
    exposeHeaders: ["content-disposition"],
    credentials: true,

    /* Without this the browser sends its own default, which in Chrome
       is about five seconds — so a clerk working steadily re-pays a
       preflight round trip every few seconds, on every method and
       header combination. A day is the ceiling browsers will honour
       and the allow-list above changes only on deploy. */
    maxAge: 86400,
  }),
);

/* Every request's time and result, by route PATTERN, for System health
   (D27-92). After CORS, so a preflight is not a request. See telemetry.ts. */
app.use("*", telemetry);

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
  /* THE THIRD SCHEME, and the only one that passes with NO person behind it.
     SU is not staff and holds no sign-in: it presents the push key the owner
     generated, which is checked inside the channel manager's own door
     (modules/channel-manager/inbound/door.ts) because only that file knows
     the answer shape SU expects and how to refuse without telling a stranger
     what was wrong. The door then finds the hotel from the id SU was given
     and opens its session as that hotel's service account, so row level
     security scopes it exactly as it scopes a clerk.

     ⚠ THE SLASH MATTERS. Written `startsWith("/api/channel")` this also
     matched /api/channel-manager/su - the owner's own SU settings - and let
     it past the gate with no person at all (18 September, caught by the API
     suite: three of those tests answered 401 because nothing set a subject).
     A prefix exemption must end at a path boundary.

     This is deliberately a prefix and not a route: nothing else may be
     mounted under /api/channel, and api/test/apiGate.test.ts fails if
     anything is. */
  if (c.req.path === "/api/channel" || c.req.path.startsWith("/api/channel/")) {
    await next();
    return;
  }

  /* THE GUEST'S DOOR (D18-9). A guest is not staff and holds no sign-in. Their
     link is the whole credential: routes/guestDoor.ts hashes it and asks
     migration 114's functions about the one booking it names, opening no
     session at all. Before a six-digit code to the phone on the booking is
     answered, that page shows only what a clerk would say across a counter -
     never the bill.

     The slash matters here for the same reason it did for /api/channel. */
  if (c.req.path === "/api/guest" || c.req.path.startsWith("/api/guest/")) {
    await next();
    return;
  }

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

/* ── Every staff write asks the person's role (PMS-2, D21-88) ─────
   After the gate above, so there is a subject; before every router, so
   no route can be reached without it. The doors with no person (guest,
   pos, channel) pass straight through. See roleGate.ts.            ═══ */
app.use("/api/*", roleGate);

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
/* The guest's own door, and the desk's side of it (D18-9, migration 114). Not
   a service's: this is the one door a person the hotel does not employ opens,
   so it stays where the master keeps it. */
app.route("/api/guest", guestDoor);
app.route("/api/hotels", guestLinks);
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
  /* The services of docs/BUILD-PLAN-2026-09-18.md. `purchasing` is built;
     the rest were mounted empty on 18 September, before their chats started,
     so that none of them has to edit this file - which is what the purchasing
     chat had to do, because its door did not exist yet. */
  purchasing,
  laundry, spa, revenueManagement, accounting, onlineCheckin, guestMessaging,
  reputation, marketing,
  /* Leads and WhatsApp, read live from the leads app (D27-170). */
  leads,
  /* The CRS bridge (D27-168): read-only, its own routes and its reader. */
  crs,
  /* In-stay requests (D27-178, D27-181): work orders that carry a stay. */
  guestServices,
  /* Loyalty (D27-178, D27-179). */
  loyalty,
];
/* Every router, with the prefix it hangs from. Exported so that
   api/test/apiGate.test.ts can hold /api/channel - the one prefix that
   passes the gate with no person behind it - to exactly one door. */
export const SERVICE_MOUNTS = SERVICES.flatMap((service) => [...service.mounts]);

for (const [prefix, router] of SERVICE_MOUNTS) app.route(prefix, router);

app.onError((error, c) => {
  if (error instanceof Unauthenticated) {
    return c.json({ error: error.message }, 401);
  }

  /* A NUMBER THE DATABASE CANNOT HOLD (22003, QA FI-12 and X-3): ₹99,999,999,999
     on a charge, a rack rate or a count answered "Something went wrong". It is
     the person's figure, not the server's fault, and the transaction rolled
     back - so a plain refusal, once, for every route. */
  if ((error as { code?: string }).code === "22003") {
    return c.json({ ok: false, reason: "That number is too large. Nothing was changed." }, 400);
  }

  /* The caller gets the fact that it failed. The log gets the route's
     PATTERN and the error's KIND, never the address or the message: an
     address can hold the guest's link, a database message a guest's name,
     and this log is kept a year (D27-92). The stack's frames stay; its
     first line is the message and goes. */
  console.error("[api]", c.req.method, routeOf(c), errorKind(error),
    error instanceof Error ? error.stack?.split("\n").slice(1, 8).join("\n") : "");
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

  /* The channel manager's every-minute push to SU. Started here, after the
     port, and only when this file is the program: under the tests nothing
     must run on a timer. It does nothing at all until a hotel is switched on
     for the channel manager and has an account to run as. */
  channelManager.jobs.start();
  /* Guest messages' once-a-minute sweep (D18-11, D18-12). It sends nothing
     until the owner's sending settings and pace are in (D21-34, D21-76). */
  guestMessaging.jobs.start();
  /* The CRS bridge's five-minute read (D27-168). Reads nothing until the
     four CRS settings are on the server and a hotel is switched on. */
  crs.jobs.start();

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
    /* Before the pool closes: a push in flight has a client out. */
    await channelManager.jobs.stop();
    await guestMessaging.jobs.stop();
    await crs.jobs.stop();
    await stopListening();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
