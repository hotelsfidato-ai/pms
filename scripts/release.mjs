#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   A RELEASE THAT CHECKS ITSELF (D27-276, point 2)

     node scripts/release.mjs release/all-5oct      your PC, in D:\fidato pms

   Refuses, with a sentence, unless:
     1. the branch exists and origin/main is behind it, so the push is a
        fast-forward;
     2. a FULL gates run on a clean copy is green for exactly its commit
        (gates.sh writes the commit on line 1 of .local/gates/progress.txt;
        every copy's file is looked at);
     3. its release copy, .claude/worktrees/<branch with / as ->, holds that
        commit with nothing uncommitted (made here if missing);
     4. the website builds THERE with the Firebase sign-in settings. A copy
        has no root .env, and on 4 October a release copy's build had none
        and live sign-in broke until a rebuild. So only the VITE_FIREBASE_
        lines go into .env.production.local, removed again afterwards;
     5. the build has the live API address, the sign-in settings and no
        test sign-in.
   Then it PRINTS the owner's steps (RELEASE-4OCT.md Part A), and after
   Fidato's each customer's in deploy/customers.txt, the pilot first. It never
   pushes, deploys or touches the server: nothing leaves this machine (19
   September). It never prints a value from .env.
   ══════════════════════════════════════════════════════════════════ */
import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.fidatohotels.com";
const EMAIL = "influvateseo@gmail.com";
const FULL = ["web types", "api types", "strip", "web tests", "api tests", "database", "replay", "pg16"];

/** release/all-5oct -> release-all-5oct, the release copy's folder. */
export const copyName = (branch) => branch.replaceAll("/", "-");

/** Why this progress.txt does not prove a full, clean, green run on `commit`; null when it does. */
export function gatesRefusal(text, commit) {
  const lines = text.split(/\r?\n/);
  const head = /^commit ([0-9a-f]{40}) (\S+)( dirty)?$/.exec(lines[0] ?? "");
  if (!head) return "records no commit (written before gates.sh recorded one), so it proves nothing about this release";
  if (head[1] !== commit) return `is a run on ${head[1].slice(0, 8)}, not on ${commit.slice(0, 8)}`;
  if (head[2] !== "full") return `is a ${head[2]} run, not a full one`;
  if (head[3]) return "ran with uncommitted changes in its copy, so it did not judge exactly this commit";
  const exits = new Map();
  for (const l of lines) {
    const m = /^\s+(.+?)\s+exit (\d+)/.exec(l);
    if (m) exits.set(m[1], Number(m[2]));
  }
  const missing = FULL.filter((s) => !exits.has(s));
  if (missing.length) return `has not finished: no ${missing.join(", ")} yet`;
  const red = FULL.filter((s) => exits.get(s) !== 0);
  if (red.length) return `is red: ${red.join(", ")}`;
  return null;
}

/** The VITE_FIREBASE_ lines of a .env, and one of their values (quotes taken off). */
export function firebaseSettings(envText) {
  const lines = envText.split(/\r?\n/).filter((l) => l.startsWith("VITE_FIREBASE_"));
  const value = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  };
  return { lines, value };
}

/** deploy/customers.txt (D27-278): "<code> <API address> <app origin> <port>" a
    line, # and blank lines skipped, in order: the first is the pilot. */
export function parseCustomers(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean).map((l) => {
    const f = l.split(/\s+/);
    if (f.length !== 4) throw new Error(`deploy/customers.txt: "${l}" is not <code> <API address> <app origin> <port>`);
    const [code, domain, origin, port] = f;
    return { code, domain, origin, port };
  });
}

/** Each customer's server steps after Fidato's, the pilot first, pinned to
    this release's commit so a customer done days later gets the same code
    (deploy/README.md, "Add a customer"). "" when there are none. */
export function customerSteps(customers, commit) {
  if (!customers.length) return "";
  return `
  B · the customers on the shared server, after A6 answers, in this order
      (deploy/customers.txt). The first is the pilot: do it, use it, and do
      the others only once it is right.
` + customers.map((c, i) => `
  B${i + 1} · ${c.code}${i === 0 ? " (the pilot)" : ""}, the server (A2 to open it)
       sudo -u postgres env DB=fidato_${c.code} /usr/local/bin/fidato-backup /var/backups/fidato
       sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato-${c.code} fetch
       sudo git -C /opt/fidato-${c.code} merge --ff-only ${commit}
       cd /opt/fidato-${c.code} && sudo CUSTOMER=${c.code} PORT=${c.port} DOMAIN=${c.domain} APP_ORIGIN=${c.origin} EMAIL=${EMAIL} deploy/launch.sh
       Expect green: https://${c.domain} is live. A red x: stop, send the master the output. Then type exit.
       Your PC, PowerShell: curl.exe -s https://${c.domain}/health
`).join("");
}

const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const out = (...args) => git(...args).stdout.trim();
const refuse = (why) => {
  console.error(`\n  x REFUSED: ${why}\n`);
  process.exit(1);
};
const ok = (what) => console.log(`  ok  ${what}`);

function main() {
  const branch = process.argv[2];
  if (!branch) refuse("name the release branch, for example: node scripts/release.mjs release/all-5oct");
  const root = resolve(dirname(out("rev-parse", "--path-format=absolute", "--git-common-dir")));

  // 1 · the branch, and a fast-forward from what GitHub last had
  const commit = out("rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`);
  if (!commit) refuse(`there is no branch ${branch} on this machine.`);
  const live = out("rev-parse", "--verify", "--quiet", "origin/main");
  if (!live) refuse("this machine has no origin/main to compare with.");
  console.log(`\n  ${branch}   ${commit}\n  origin/main   ${live}   (as this machine last saw GitHub)\n`);
  if (git("merge-base", "--is-ancestor", live, commit).status !== 0) {
    refuse(`origin/main (${live.slice(0, 8)}) is not behind ${branch}, so the push would not be a fast-forward.`);
  }
  ok("the push will be a fast-forward");
  // MEMORY 381: a release branch the plan has moved past. Warns, never refuses (D27-277).
  const lacks = git("log", "--format=%s", `${commit}..refs/heads/cp6`);
  const subjects = lacks.status === 0 ? lacks.stdout.split("\n").filter(Boolean) : [];
  if (subjects.length) {
    console.log(`  !  cp6 has ${subjects.length} commit${subjects.length === 1 ? "" : "s"} this release does not include`);
    for (const s of subjects.slice(0, 10)) console.log(`       ${s}`);
  }

  // 2 · a full, clean, green gates run on exactly this commit, in any copy
  const copies = out("worktree", "list", "--porcelain").split("\n")
    .filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  const runs = copies.map((c) => resolve(c, ".local/gates/progress.txt")).filter(existsSync)
    .map((f) => [f, gatesRefusal(readFileSync(f, "utf8"), commit)]);
  const green = runs.find(([, why]) => !why);
  if (!green) {
    for (const [f, why] of runs) console.log(`  ${f}\n      ${why}`);
    refuse(`no full gates run on a clean copy is green for ${commit.slice(0, 8)}. Run ` +
      `bash scripts/gates.sh <label> (Git Bash, about 35 minutes) in a clean copy at that commit, then run this again.`);
  }
  ok(`a full gates run is green for ${commit.slice(0, 8)}: ${green[0]}`);

  // 3 · the release copy, at exactly this commit
  const copy = join(root, ".claude", "worktrees", copyName(branch));
  if (!existsSync(copy)) {
    const add = git("worktree", "add", copy, branch);
    if (add.status !== 0) refuse(`could not make the release copy ${copy}: ${add.stderr.trim()}`);
  }
  const held = out("-C", copy, "rev-parse", "HEAD");
  if (held !== commit) {
    refuse(`${copy} holds ${held.slice(0, 8) || "no commit"}, not ${branch} at ${commit.slice(0, 8)}. ` +
      "Move or remove that copy yourself; this script does not change it.");
  }
  if (out("-C", copy, "status", "--porcelain")) {
    refuse(`${copy} has uncommitted changes, so a build there would not be exactly ${commit.slice(0, 8)}.`);
  }
  for (const nm of ["node_modules", join("api", "node_modules")]) {
    if (!existsSync(join(copy, nm))) symlinkSync(join(root, nm), join(copy, nm), "junction");
  }
  ok(`the release copy holds ${commit.slice(0, 8)}: ${copy}`);
  // The customers this release then goes to, from the release's own list (D27-278).
  const listed = join(copy, "deploy", "customers.txt");
  let customers = [];
  try {
    customers = parseCustomers(existsSync(listed) ? readFileSync(listed, "utf8") : "");
  } catch (error) {
    refuse(error.message);
  }

  // 4 · the build, with the sign-in settings and the live API address
  const fb = firebaseSettings(readFileSync(join(root, ".env"), "utf8"));
  const projectId = fb.value("VITE_FIREBASE_PROJECT_ID");
  const apiKey = fb.value("VITE_FIREBASE_API_KEY");
  if (!projectId || !apiKey) refuse(`${join(root, ".env")} has no Firebase project id or API key; the website would build without sign-in.`);
  if (git("-C", copy, "check-ignore", "-q", ".env.production.local").status !== 0) {
    refuse(".env.production.local is not ignored by git in the release copy; the sign-in settings will not be written there.");
  }
  const envFile = join(copy, ".env.production.local");
  mkdirSync(join(root, ".local"), { recursive: true });
  const log = join(root, ".local", `release-${copyName(branch)}.log`);
  console.log(`\n  building the website in the release copy (a few minutes); the log: ${log}`);
  let status;
  try {
    writeFileSync(envFile, fb.lines.join("\n") + "\n");
    // No VITE_ setting from this shell may reach the build: the files decide.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_")));
    const fd = openSync(log, "w");
    try {
      status = spawnSync("npm run build:app", { cwd: copy, env: { ...env, API_URL: API }, stdio: ["ignore", fd, fd], shell: true }).status;
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(envFile, { force: true });
  }
  const built = readFileSync(log, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  if (status !== 0) {
    console.log(built.trimEnd().split("\n").slice(-25).map((l) => `    ${l}`).join("\n"));
    refuse(`the build failed (exit ${status}); its last lines are above, the whole log is ${log}.`);
  }
  ok("npm run build:app passed (.env.production.local removed again)");

  // 5 · what the build holds
  const dist = join(copy, "dist");
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const apiUrl = (() => { try { return JSON.parse(read(join(dist, "config.json"))).apiUrl; } catch { return "nothing"; } })();
  const js = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(dist, "assets", f), "utf8")).join("\n");
  const bundle = /src="\/assets\/(index-[^"]+\.js)"/.exec(read(join(dist, "index.html")))?.[1];
  const checks = [
    [apiUrl === API, `dist/config.json's apiUrl: ${apiUrl}`],
    [js.includes(projectId), `the Firebase project id from .env in dist/assets: ${js.includes(projectId) ? "present" : "MISSING"}`],
    [js.includes(apiKey), `the Firebase API key from .env in dist/assets: ${js.includes(apiKey) ? "present" : "MISSING"}`],
    [/✓ no test sign-in in dist \(\d+ files checked\)/.test(built), "check-no-dev-login passed in the build"],
    [Boolean(bundle), `the main bundle: ${bundle ?? "NOT FOUND in dist/index.html"}`],
  ];
  for (const [pass, what] of checks) console.log(`  ${pass ? "ok" : "x "}  ${what}`);
  if (checks.some(([pass]) => !pass)) refuse("the build is not fit to publish; see the x lines above.");

  // 6 · the owner's steps, printed and never run
  const s = commit.slice(0, 8);
  console.log(`
  READY. Nothing has been pushed, deployed or sent; these steps are the owner's.

  A1 · your PC, PowerShell: put the release on GitHub
       cd "${root}"; git push origin ${branch}:main
       Expect a fast-forward from ${live.slice(0, 8)} to ${s}.

  A2 · your PC, PowerShell: open the server
       ssh -i "$HOME\\Downloads\\ssh-key-2026-09-01.key" opc@130.210.49.220

  A3 · the server: a backup first
       sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato

  A4 · the server: the new code
       sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
       Expect "Fast-forward" to ${s}.

  A5 · the server: the database changes, then the API restarts
       cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=${EMAIL} deploy/launch.sh
       Expect green: ${API} is live. A red x: stop, send the master the output. Then type exit.

  A6 · your PC, PowerShell: the API answers
       curl.exe -s ${API}/health

  A7 · your PC, PowerShell: publish the website FROM THE RELEASE COPY
       cd "${copy}"; firebase deploy --only hosting:app
       Expect "Deploy complete!". The live site should then load ${bundle}.
${customerSteps(customers, commit)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
