/* ══════════════════════════════════════════════════════════════════
   WRITE dist/config.json — where this build's API lives

   ⚠ NOTHING CREATED THIS FILE AND THE APP FETCHES IT ON EVERY LOAD.

   `src/lib/api.ts` resolves the API address at RUNTIME from
   `/config.json`, so the backend can move without rebuilding every
   client. Deliberate, and right. But the file was never written by
   anything: not the repo, not the build, not `deploy/launch.sh` —
   which says in a comment that it deliberately no longer writes
   VITE_* because config.json exists, and does not write config.json
   either.

   `fetch("/config.json")` then 404s, `api.ts` falls back to
   `VITE_API_URL ?? "http://localhost:8787"`, and a deployed app asks
   the TESTER'S OWN MACHINE for the hotel's data. Every screen renders,
   every screen is empty, and nothing anywhere says why — the exact
   silent-empty failure the preflight's CORS check exists to prevent,
   arriving through the one door the preflight cannot see, because it
   runs on the server and this is a static file on a CDN.

   So: written by a script that REFUSES without an address, rather than
   defaulted to something plausible. A build that cannot say where its
   API is must not produce one that points at localhost.

     API_URL=https://api.example.com npm run build:app

   Written into dist/ rather than public/, because public/ is also
   served by the dev server, which must not point at a real hotel.
   ══════════════════════════════════════════════════════════════════ */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const url = (process.env.API_URL ?? "").trim();
const out = process.env.OUT_DIR ?? "dist";

const die = (msg) => {
  console.error(`\n  \x1b[31mx ${msg}\x1b[0m\n`);
  process.exit(1);
};

if (!url) {
  die(
    "API_URL is not set, so this build has nowhere to send its requests.\n" +
    "    Set it to where the API answers — the name with the certificate,\n" +
    "    not the instance IP, or the browser blocks it as mixed content:\n\n" +
    "      API_URL=https://api.yourdomain.com npm run build:app",
  );
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  die(`API_URL is not a URL: ${url}`);
}

/* http:// from an https:// page is blocked by the browser with nothing
   in the interface to say so. Caught here, where there is a person to
   read it, rather than at a hotel desk. localhost is exempt — that IS
   how somebody builds against their own machine. */
const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
if (parsed.protocol !== "https:" && !local) {
  die(
    `API_URL is ${parsed.protocol}//, and the app is served over https.\n` +
    "    The browser blocks that call and shows nothing — every screen\n" +
    "    renders empty with no error. Use https, which means the API needs\n" +
    "    a name and a certificate, not an IP address.",
  );
}

if (!existsSync(out)) {
  die(`${out}/ does not exist — run the build first.`);
}

const file = join(out, "config.json");
writeFileSync(file, JSON.stringify({ apiUrl: parsed.origin }, null, 2) + "\n");
console.log(`\n  \x1b[32m✓\x1b[0m ${file} → ${parsed.origin}\n`);
