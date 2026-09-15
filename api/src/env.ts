/* ══════════════════════════════════════════════════════════════════
   CONFIGURATION

   Read once, validated once, and the process refuses to start if
   something required is missing. A server that boots with a broken
   config and fails on the first request fails in front of a clerk
   instead of in front of whoever deployed it.
   ══════════════════════════════════════════════════════════════════ */

/* Node 22 reads .env itself — no dotenv dependency. A deployed box
   sets real environment variables and has no file, so a missing one
   is not an error here; a missing VALUE is, and `required` says so. */
import { fileURLToPath } from "node:url";

try {
  /* fileURLToPath, not URL.pathname — on Windows the latter yields
     "/D:/..." and loadEnvFile cannot open it. */
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  /* No .env file. Fine when the environment is set another way. */
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[config] ${name} is not set. Copy api/.env.example to api/.env and fill it in.`,
    );
  }
  return value;
}

const nodeEnv = process.env["NODE_ENV"] ?? "development";
const isProduction = nodeEnv === "production";

/**
 * Local development has no Firebase service account, so there is a way
 * to name the staff member directly with a header.
 *
 * It is a hole, and it is treated as one. The process REFUSES TO START
 * if it is on in production — it does not warn, it does not disable
 * itself quietly, it throws. A dev bypass that survives a deploy is
 * how a stranger signs in as the owner.
 */
const allowDevAuth = process.env["ALLOW_DEV_AUTH"] === "1";

if (allowDevAuth && isProduction) {
  throw new Error(
    "[config] ALLOW_DEV_AUTH=1 with NODE_ENV=production. This would let " +
      "anyone name themselves any staff member with a header. Refusing to start.",
  );
}

export const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env["PORT"] ?? 8787),

  /* pms_app owns rows and nothing else — it cannot create, alter or
     drop. Connecting as pms_migrate or postgres would bypass RLS and
     make every isolation guarantee in the schema decorative. */
  databaseUrl: required("DATABASE_URL"),

  /* A JSON service account, as a single-line string. Unlike the web
     config in src/lib/firebase.ts, this IS a secret. */
  firebaseServiceAccount: process.env["FIREBASE_SERVICE_ACCOUNT"] ?? null,

  allowDevAuth,

  /* A LIST, not one origin. The staff app, the admin console and any
     future client are separate origins the moment the frontend stops
     being served off this box, and a single string caps the system at
     one browser client forever — which is the ceiling you meet first
     when the till, the CRS and the console all want in.

     Comma-separated. The variable keeps its name so an existing .env
     with one value still works unchanged. */
  corsOrigins: (process.env["CORS_ORIGIN"] ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
} as const;

if (allowDevAuth) {
  console.warn(
    "\n  ⚠  ALLOW_DEV_AUTH is on. The x-dev-staff-id header names the caller.\n" +
      "     Development only. The process refuses to start this way in production.\n",
  );
}

if (!env.firebaseServiceAccount && !allowDevAuth) {
  throw new Error(
    "[config] No FIREBASE_SERVICE_ACCOUNT and no ALLOW_DEV_AUTH. " +
      "Nothing could authenticate, so every request would be rejected. Refusing to start.",
  );
}
