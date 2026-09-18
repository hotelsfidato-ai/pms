import { fileURLToPath } from "node:url";

/* ══════════════════════════════════════════════════════════════════
   WHICH DATABASE A MAINTENANCE SCRIPT WRITES TO (the owner's D17-90)

   Every chat works in its own copy of this repository, each with its own
   `api/.env` naming its own database, and every copy shares one Postgres
   server. These scripts used to end with

       process.env["SUPER_DATABASE_URL"] ?? "postgres://…/fidato"

   which reads NOTHING from the copy it is running in. On 17 September a
   chat ran the demo loader in its own copy and it began tearing down 5EL
   in the MAIN development database; an append-only guard stopped it and
   nothing was kept (MEMORY 287, CM-1). A built-in fallback on a shared
   server is not a default: it is somebody else's data.

   So: this copy's own settings decide, and with nothing to go on the
   script REFUSES rather than guessing.

     1. ADMIN_DATABASE_URL or SUPER_DATABASE_URL already in the
        environment wins — that is how the test harness and the server
        are told, deliberately, and it is never a guess.
     2. Otherwise this copy's api/.env: ADMIN_DATABASE_URL, then
        SUPER_DATABASE_URL, then DATABASE_URL — whose database, host and
        port are kept and whose user is swapped for the LOCAL development
        superuser, because these are bulk administrative loads that no
        application role may do.
     3. Otherwise it refuses.

   Step 2's swap is only for a database on this machine. A remote host is
   refused: guessing a superuser's password against somebody's server is
   not a thing to do by default.
   ══════════════════════════════════════════════════════════════════ */

/** The development superuser, as START-HERE.md sets it up. */
const DEV_SUPERUSER = "postgres";
const DEV_PASSWORD = "pw";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface ChosenDatabase {
  /** The connection string. NEVER printed. */
  url: string;
  /** "fidato_cm on 127.0.0.1:55432" — safe to print, no password. */
  where: string;
  /** Where the answer came from, for the line the script prints. */
  from: string;
}

export type Choice =
  | { ok: true; database: ChosenDatabase }
  | { ok: false; reason: string };

const describe = (url: URL) =>
  `${decodeURIComponent(url.pathname.replace(/^\//, "")) || "(no database named)"} on ${url.host}`;

function parse(value: string, from: string): Choice {
  /* A connection string over a unix socket - the shape a deployed box uses,
     `postgres://postgres@/fidato?host=/var/run/postgresql` - has no host, and
     `new URL` refuses it. It is still a real setting somebody wrote on
     purpose, so it is read by hand rather than turned down. */
  let where: string | null = null;
  try {
    const url = new URL(value);
    if (url.pathname.replace(/^\//, "")) where = describe(url);
  } catch {
    const m = /^postgres(?:ql)?:\/\/[^/]*\/([^/?#]+)/.exec(value);
    if (m) where = `${decodeURIComponent(m[1]!)} over a socket`;
  }
  if (!where) {
    return {
      ok: false,
      reason: `${from} is not a connection string naming a database, so this script will not run on it.`,
    };
  }
  return { ok: true, database: { url: value, where, from } };
}

/** The choice, given what the environment holds and what this copy's
    settings file holds. Pure, so `api/test/scriptDatabase.test.ts` can
    try every case without a database. */
export function chooseDatabase(
  environment: Record<string, string | undefined>,
  settings: Record<string, string | undefined>,
): Choice {
  for (const name of ["ADMIN_DATABASE_URL", "SUPER_DATABASE_URL"] as const) {
    const value = environment[name]?.trim();
    if (value) return parse(value, `${name} (already set in this shell)`);
  }
  for (const name of ["ADMIN_DATABASE_URL", "SUPER_DATABASE_URL"] as const) {
    const value = settings[name]?.trim();
    if (value) return parse(value, `${name} in this copy's api/.env`);
  }

  const app = settings["DATABASE_URL"]?.trim();
  if (!app) {
    return {
      ok: false,
      reason:
        "This copy does not say which database to use. Refusing to run, rather than "
        + "writing to another copy's data.\n"
        + "  Put DATABASE_URL in this copy's api/.env (copy api/.env.example), or run the "
        + "script with SUPER_DATABASE_URL set.",
    };
  }

  let url: URL;
  try {
    url = new URL(app);
  } catch {
    return { ok: false, reason: "DATABASE_URL in this copy's api/.env is not a connection string this script can read." };
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      reason:
        `DATABASE_URL in this copy's api/.env points at ${url.host}, which is not this machine. `
        + "These scripts connect as a superuser and will not guess one for another server.\n"
        + "  Run the script with ADMIN_DATABASE_URL or SUPER_DATABASE_URL set to that server's "
        + "administrative connection string.",
    };
  }

  const superuser = new URL(app);
  superuser.username = DEV_SUPERUSER;
  superuser.password = DEV_PASSWORD;
  return {
    ok: true,
    database: {
      url: superuser.toString(),
      where: describe(superuser),
      from: "DATABASE_URL in this copy's api/.env, as the local superuser",
    },
  };
}

/** This copy's api/.env, or {} when it has none. Values are never printed. */
function settingsOfThisCopy(): Record<string, string | undefined> {
  const before = new Set(Object.keys(process.env));
  try {
    /* fileURLToPath, not URL.pathname: on Windows the latter yields
       "/D:/…" and loadEnvFile cannot open it (api/src/env.ts). */
    process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch {
    return {};
  }
  const settings: Record<string, string | undefined> = {};
  for (const name of ["ADMIN_DATABASE_URL", "SUPER_DATABASE_URL", "DATABASE_URL"]) {
    /* A name the file introduced, or one it may have overwritten: either
       way the file is this copy's own word on the matter. */
    if (process.env[name] !== undefined || before.has(name)) settings[name] = process.env[name];
  }
  return settings;
}

/**
 * The database this script may write to, or a refusal in a sentence.
 * Prints where it is writing - never the connection string, which holds
 * a password.
 */
export function databaseForScript(script: string): string {
  const environment = { ...process.env };
  const choice = chooseDatabase(environment, settingsOfThisCopy());
  if (!choice.ok) {
    console.error(`\n  ${script}: ${choice.reason}\n`);
    process.exit(2);
  }
  console.log(`  ${script}: writing to ${choice.database.where} (${choice.database.from})`);
  return choice.database.url;
}
