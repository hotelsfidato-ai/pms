import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   ONE FOLDER PER SERVICE — THE DOORS (docs/SERVICE-FOLDERS-PLAN.md)

   The owner split the code by service on 15 September so that several
   agents can work at once, each inside one service. That only holds if a
   service cannot quietly depend on another's insides: an agent reshaping
   finance's internals would break the restaurant without ever opening it.

   So a service is used by others ONLY through its front door — its
   `index.ts`. The shared core may also read each service's registration
   files (`nav.ts`, `routes.tsx`), which is how the menu and the screen
   addresses are assembled without a shared list anybody has to edit.

   The same rule for the server: `api/src/modules/<service>/index.ts` is the
   only file another service, or the core, may import.

   Every service folder carries its `index.ts` and its `MODULE.md` from the
   moment it exists — the brief an agent reads before its first edit.
   ══════════════════════════════════════════════════════════════════ */

/* This file lives in src/test. */
const ROOT = join(__dirname, "..", "..");
const WEB = join(ROOT, "src");
const WEB_MODULES = join(WEB, "modules");
const API = join(ROOT, "api", "src");
const API_MODULES = join(API, "modules");

const SOURCE = /\.(ts|tsx)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

const SPECIFIERS =
  /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|vi\.mock\(\s*["']([^"']+)["']/g;

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(SPECIFIERS)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4])!);
  return out;
}

/** The service a path belongs to, or null for the shared core. */
function serviceOf(path: string, modulesRoot: string): string | null {
  const rel = relative(modulesRoot, path);
  if (rel.startsWith("..") || rel === "") return null;
  return rel.split(sep)[0]!;
}

/** What is left of the path inside its service: "index", "nav", "pages/Till"… */
function insideOf(path: string, modulesRoot: string): string {
  const parts = relative(modulesRoot, path).split(sep).slice(1);
  return parts.join("/").replace(/\.(ts|tsx)$/, "");
}

interface Crossing { file: string; spec: string; }

function crossings(
  files: string[], modulesRoot: string,
  resolveSpec: (spec: string, from: string) => string | null,
): Crossing[] {
  const bad: Crossing[] = [];
  for (const file of files) {
    const from = serviceOf(file, modulesRoot);
    for (const spec of specifiersOf(file)) {
      const target = resolveSpec(spec, file);
      if (!target) continue;
      const to = serviceOf(target, modulesRoot);
      if (!to || to === from) continue;
      const inside = insideOf(target, modulesRoot);
      const door = inside === "" || inside === "index";
      /* The core assembles the menu and the screen addresses from each
         service's own registration files. Only the core may. */
      const registration = from === null && (inside === "nav" || inside === "routes");
      if (!door && !registration) {
        bad.push({ file: relative(ROOT, file).split(sep).join("/"), spec });
      }
    }
  }
  return bad;
}

const webResolve = (spec: string, from: string): string | null => {
  if (spec.startsWith("@/")) return join(WEB, spec.slice(2));
  if (spec.startsWith(".")) return resolve(dirname(from), spec);
  return null;
};

const apiResolve = (spec: string, from: string): string | null =>
  spec.startsWith(".") ? resolve(dirname(from), spec) : null;

/* Crossings that exist and are being removed. Must only ever shrink, and
   is empty once the move is finished. A NEW crossing fails at once. */
const KNOWN_WEB: string[] = [];
const KNOWN_API: string[] = [];

const services = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory()) : [];

describe("one folder per service", () => {
  it("in the web app, a service is reached only through its front door", () => {
    const found = crossings(walk(WEB), WEB_MODULES, webResolve)
      .map((c) => `${c.file} → ${c.spec}`);
    expect(found.filter((f) => !KNOWN_WEB.includes(f))).toEqual([]);
  });

  it("on the server, a service is reached only through its front door", () => {
    const found = crossings(walk(API), API_MODULES, apiResolve)
      .map((c) => `${c.file} → ${c.spec}`);
    expect(found.filter((f) => !KNOWN_API.includes(f))).toEqual([]);
  });

  it("every service folder has its front door, its brief and its defect log", () => {
    /* DEFECTS.md joined the list on 16 September, at the owner's request: a
       session working on one service must see that service's defects and what
       was already done about them, without reading the whole of PENDING.md.
       A folder without one silently loses its history the next time somebody
       solves the same fault. */
    const missing: string[] = [];
    for (const name of services(WEB_MODULES)) {
      for (const file of ["index.ts", "MODULE.md", "DEFECTS.md"]) {
        if (!existsSync(join(WEB_MODULES, name, file))) missing.push(`src/modules/${name}/${file}`);
      }
    }
    for (const name of services(API_MODULES)) {
      if (!existsSync(join(API_MODULES, name, "index.ts"))) missing.push(`api/src/modules/${name}/index.ts`);
    }
    expect(missing).toEqual([]);
  });

  it("the server's services use the web app's names", () => {
    /* One word per service in both places, so a claim is one word. */
    const web = new Set(services(WEB_MODULES));
    expect(services(API_MODULES).filter((n) => !web.has(n))).toEqual([]);
  });
});
