// =============================================================================
// build.mjs — puts the manual together (D27-268, D27-293)
// =============================================================================
// The book is kept current chapter by chapter: each chapter is its own file in
// docs/manual/chapters/ (a0.html, a1.html, a8.html …), and this joins them,
// in the plan's order, behind a cover and a contents page that are worked out
// from the chapters themselves - so the contents can never disagree with them.
//
//   node docs/manual/tools/build.mjs          writes docs/manual/manual.html
//
// Then open manual.html in Chrome and Ctrl+P, Save as PDF (A4). The pictures are
// taken by tools/shoot.mjs. src/test/manual.test.ts checks every menu screen is
// in a chapter, and that manual.html was built from the chapters as they are.
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANUAL = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The plan (docs/manual/PLAN.md): Part A, then Part B. */
export const PLAN = [
  { c: "A0", file: "a0", title: "Getting started" },
  { c: "A1", file: "a1", title: "The front desk day" },
  { c: "A2", file: "a2", title: "Bookings" },
  { c: "A3", file: "a3", title: "Check-in" },
  { c: "A4", file: "a4", title: "The guest's bill" },
  { c: "A5", file: "a5", title: "Check-out" },
  { c: "A6", file: "a6", title: "Housekeeping" },
  { c: "A7", file: "a7", title: "Night audit" },
  { c: "A8", file: "a8", title: "Restaurant" },
  { c: "A9", file: "a9", title: "Stores and purchasing" },
  { c: "A10", file: "a10", title: "Guest messages" },
  { c: "A11", file: "a11", title: "Reports" },
  { c: "A12", file: "a12", title: "Approvals, cash expenses, notifications" },
  { c: "A13", file: "a13", title: "Spa, laundry, loyalty" },
  { c: "B1", file: "b1", title: "The system at a glance", part: "B" },
  { c: "B2", file: "b2", title: "People and security", part: "B" },
  { c: "B3", file: "b3", title: "Money rules", part: "B" },
  { c: "B4", file: "b4", title: "Rooms and rates", part: "B" },
  { c: "B5", file: "b5", title: "Connections", part: "B" },
  { c: "B6", file: "b6", title: "Each module in depth", part: "B" },
  { c: "B7", file: "b7", title: "Edge cases", part: "B" },
  { c: "B8", file: "b8", title: "Tests and checks", part: "B" },
  { c: "B9", file: "b9", title: "Running it", part: "B" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Each chapter: its file's text, title and section headings, or null. */
export function readChapters() {
  return PLAN.map((p) => {
    const path = join(MANUAL, "chapters", `${p.file}.html`);
    if (!existsSync(path)) return { ...p, html: null, sections: [] };
    const html = readFileSync(path, "utf8").split("\r\n").join("\n").trimEnd();
    const title = strip(/<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? p.title);
    const sections = [...html.matchAll(/<h2[^>]*><span class="n">([^<]+)<\/span>([\s\S]*?)<\/h2>/g)]
      .map((m) => `${m[1]} ${strip(m[2])}`);
    return { ...p, title, html, sections };
  });
}

export function build() {
  const head = readFileSync(join(MANUAL, "parts", "head.html"), "utf8").split("\r\n").join("\n");
  const legend = readFileSync(join(MANUAL, "parts", "legend.html"), "utf8").split("\r\n").join("\n");
  const chapters = readChapters();
  const written = chapters.filter((c) => c.html);
  const pictures = written.reduce((n, c) => n + (c.html.match(/<img /g) ?? []).length, 0);
  const toTake = written.reduce((n, c) => n + (c.html.match(/class="shot-plan/g) ?? []).length, 0);

  const tocRow = (c) => c.html
    ? `    <li class="here"><span class="c">${c.c}</span><a class="t" href="#${c.file}">${esc(c.title)}</a><span class="state">In this book</span>
      <span class="s">${esc(c.sections.join(" · "))}</span></li>`
    : `    <li><span class="c">${c.c}</span><span class="t">${esc(c.title)}</span><span class="state">To come</span></li>`;

  const cover = `<!-- ═════════════════════════════════ COVER ═════════════════════════════════ -->
<section class="cover">
  <div class="ring"></div>
  <div class="brand">Fidato Hotels</div>
  <div class="bar"></div>
  <h1>Fidato PMS</h1>
  <p class="sub">The manual</p>
  <p class="part"><span>Part A</span> · The staff manual, step by step<br><span>Part B</span> · The owner's book, how and why</p>
  <p class="draft">In this edition: ${written.map((c) => c.c).join(", ")}</p>
  <div class="foot">
    The screens in this book are from the test hotel, 5 Elements Akkalkot. Every guest in it is made up.<br>
    Decision numbers such as D27-249 are the owner's decisions; the list is kept in <code style="background:none;color:inherit">docs/briefs/decisions-*.md</code>.<br>
    ${pictures} pictures${toTake ? `, ${toTake} still to be taken` : ""}. Built from the chapters in docs/manual/chapters.
  </div>
</section>
`;

  const toc = `<!-- ════════════════════════════════ CONTENTS ═══════════════════════════════ -->
<section class="sheet toc">
  <h1>Contents</h1>

  <h2>Part A · The staff manual</h2>
  <ol>
${chapters.filter((c) => !c.part).map(tocRow).join("\n")}
  </ol>

  <h2>Part B · The owner's book</h2>
  <ol>
${chapters.filter((c) => c.part === "B").map(tocRow).join("\n")}
  </ol>

${legend}</section>
`;

  const book = `${head}
${cover}
${toc}
${written.map((c) => c.html).join("\n\n")}

</div>
</body>
</html>
`;
  return book;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(MANUAL, "manual.html");
  /* --check: is manual.html the chapters as they are now? (src/test/manual.test.ts) */
  if (process.argv.includes("--check")) {
    const now = readFileSync(out, "utf8").split("\r\n").join("\n");
    if (now !== build()) {
      console.log("manual.html is not the chapters as they are: run node docs/manual/tools/build.mjs");
      process.exit(1);
    }
    console.log("manual.html is up to date");
    process.exit(0);
  }
  writeFileSync(out, build());
  const chapters = readChapters();
  console.log(`  ✓ manual.html: ${chapters.filter((c) => c.html).map((c) => c.c).join(", ")} (${chapters.filter((c) => !c.html).length} to come)`);
}
