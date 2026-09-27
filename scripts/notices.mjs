/* ══════════════════════════════════════════════════════════════════
   THIRD-PARTY NOTICES — who wrote the code this product is built on

     node scripts/notices.mjs

   Reads package-lock.json and api/package-lock.json (production
   packages only: `dev` ones never reach a hotel) and the licence files
   the installed packages ship, and writes two files:

     THIRD-PARTY-NOTICES.md          every package, version and licence,
                                     and what needs a person's eye
     public/third-party-notices.txt  the web app's packages with their
                                     licence texts — Vite copies public/
                                     into every build, so it ships with
                                     the JavaScript it describes

   Why (D27-15, the audit's A15): MIT, ISC and BSD require their
   copyright and licence text in every copy, Apache-2.0 also its NOTICE,
   and the JavaScript sent to every browser is a copy. The API runs on
   our own server and is not handed to anyone, so it is listed but its
   texts are not shipped.

   Run it after any dependency change, with node_modules installed (it
   refuses if an installed version differs from the lockfile).
   ══════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PERMISSIVE = /^(MIT|MIT\/X11|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|Unlicense|OFL-1\.1|Zlib)$/;

/* No licence in the lockfile — each checked by hand on 27 September 2026. */
const BY_HAND = {
  buffers:
    "MIT. The published 0.1.1 (2011) carries no licence at all. The author's repository " +
    "(github.com/substack/node-buffers, since deleted; mirror github.com/franchb/node-buffers-substack-orig) " +
    "states MIT/X11, and Debian ships it as MIT (sources.debian.org/copyright/license/node-buffers/0.1.1-2/). " +
    "Reached through exceljs > unzipper > binary. Confirm with the lawyer.",
  limiter:
    "MIT. An old-style `licenses` array says MIT and the package ships LICENSE.txt (MIT). " +
    "Reached through firebase-admin > jwks-rsa.",
  "png-js":
    "MIT. The package ships LICENSE (MIT, Copyright (c) 2017 Devon Govett). Reached through pdfkit.",
};
/* Offered under a choice of licences: the one taken. */
const CHOSEN = {
  "(MIT OR GPL-3.0-or-later)": "MIT, as the licence allows. GPL is never taken.",
};

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const ISC = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const author = (a) => (typeof a === "string" ? a : a?.name) ?? "-";

function packages(dir) {
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages;
  const seen = new Map();
  for (const [path, p] of Object.entries(lock)) {
    if (!path || p.dev || p.link) continue;
    const name = p.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
    if (seen.has(`${name}@${p.version}`)) continue;
    const at = join(dir, path);
    if (!existsSync(join(at, "package.json"))) throw new Error(`${name} is not installed in ${dir} - npm ci first`);
    const pkg = JSON.parse(readFileSync(join(at, "package.json"), "utf8"));
    if (pkg.version !== p.version) throw new Error(`${name}: installed ${pkg.version}, lockfile ${p.version}`);
    const files = readdirSync(at).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
    seen.set(`${name}@${p.version}`, {
      name, version: p.version, license: p.license ?? null, author: author(pkg.author),
      texts: files.map((f) => [f, readFileSync(join(at, f), "utf8").replace(/\r\n?/g, "\n").trim()]),
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const web = packages(".");
const api = packages("api");

const note = (p) =>
  BY_HAND[p.name] ? `By hand: ${BY_HAND[p.name]}`
  : CHOSEN[p.license] ? `Choice of licences: ${CHOSEN[p.license]}`
  : !p.license ? "NO LICENCE FOUND - ask the lawyer"
  : p.license.replace(/[()]/g, "").split(/ AND /).every((l) => PERMISSIVE.test(l.trim())) ? ""
  : "NOT ON THE PERMISSIVE LIST - ask the lawyer";

/* The classifier is the one thing here that can be quietly wrong. */
console.assert(note({ name: "x", license: "GPL-3.0" }).startsWith("NOT"), "GPL must be flagged");
console.assert(note({ name: "x", license: "(MIT AND Zlib)" }) === "", "MIT AND Zlib is permissive");
console.assert(note({ name: "x", license: null }).startsWith("NO LICENCE"), "no licence must be flagged");

const count = (list) => Object.entries(list.reduce((c, p) => ({ ...c, [p.license ?? "none"]: (c[p.license ?? "none"] ?? 0) + 1 }), {}))
  .sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(" · ");
const table = (list) => ["| Package | Version | Licence | Note |", "|---|---|---|---|",
  ...list.map((p) => `| ${p.name} | ${p.version} | ${p.license ?? "-"} | ${note(p)} |`)].join("\n");
const flagged = [...web.map((p) => ["web app", p]), ...api.map((p) => ["API", p])].filter(([, p]) => note(p));
const bad = flagged.filter(([, p]) => /^NOT? /.test(note(p)));

writeFileSync("THIRD-PARTY-NOTICES.md", `# Third-party notices

The open-source packages this product is built on, and their licences. **Generated** by
\`node scripts/notices.mjs\` from \`package-lock.json\` and \`api/package-lock.json\`
(production packages only). Do not edit by hand: change a dependency, run it again.

## In short

${bad.length ? `- **${bad.length} package(s) are NOT known to be permissive** - see "Needs a person's eye".` : `- **Everything is permissive.** Nothing is GPL, LGPL, AGPL, EUPL or MPL, so nothing here
  obliges the product's own code to be published, and hosting it for buyers triggers nothing.`}
- The duty that remains is to **pass the notices on**: MIT, ISC and BSD want their copyright
  and licence text in every copy, Apache-2.0 also its NOTICE file, and the OFL the font's licence.
- **How it ships:** the web app's texts are in \`public/third-party-notices.txt\`. Vite copies
  \`public/\` into every build, so it is served beside the app, at \`/third-party-notices.txt\`.
  The API runs on the product's own server and is not given to anyone, so it is listed here
  and its texts are not shipped.

**Web app** (${web.length} packages): ${count(web)}

**API** (${api.length} packages): ${count(api)}

## Needs a person's eye

| Where | Package | Version | Licence | Note |
|---|---|---|---|---|
${flagged.map(([w, p]) => `| ${w} | ${p.name} | ${p.version} | ${p.license ?? "-"} | ${note(p)} |`).join("\n")}

## The web app

${table(web)}

## The API

${table(api)}
`);

const apache = web.flatMap((p) => p.texts).find(([, t]) => /^\s*Apache License\s+Version 2\.0/.test(t) && t.includes("END OF TERMS AND CONDITIONS"))?.[1];
if (!apache) throw new Error("no verbatim Apache-2.0 text found among the web app's packages");
const standard = { MIT, ISC, "Apache-2.0": apache };

writeFileSync("public/third-party-notices.txt", `Third-party software in this application

This application includes the open-source packages below. Each is listed with
its version, its licence, and the licence and notice files it ships. A package
that ships no licence file is under the standard text of its licence, given
once at the end.

${web.map((p) => `================================================================================
${p.name} ${p.version}
Licence: ${p.license}${p.author !== "-" ? `\nAuthor: ${p.author}` : ""}
${p.texts.length ? p.texts.map(([f, t]) => `\n--- ${f}\n\n${t}`).join("\n") : `\n(no licence file in the package: the ${p.license} text at the end applies)`}
`).join("\n")}
================================================================================
STANDARD LICENCE TEXTS
${Object.entries(standard).map(([l, t]) => `\n--- ${l}\n\n${t}\n`).join("")}`);

console.log(`  web app ${web.length}, API ${api.length}, ${flagged.length} to look at, ${bad.length} not permissive`);
/* A new dependency under a licence nobody has looked at fails the run. */
if (bad.length) process.exit(1);
