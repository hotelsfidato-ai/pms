import { readFileSync, writeFileSync } from "node:fs";

/* ══════════════════════════════════════════════════════════════════
   THE BUILT APP, AS AN ARTIFACT PAGE

   `vite build --mode preview` produces one complete HTML document.
   An Artifact is not given a document — it is given the CONTENTS of a
   body, and the host wraps it in its own doctype, html and head.

   Publishing the document as-is would nest <html> inside <body>.
   Browsers tolerate that, and tolerating is not the same as working:
   the host's own head would be the one that counts, and anything this
   build put in its head — the stylesheet above all — would be
   relocated by the parser in ways nobody chose.

   So this unwraps it: title, styles, the mount point and the script,
   in that order. Title first because only the first 8KB is scanned for
   it, and the inlined bundle is two megabytes.
   ══════════════════════════════════════════════════════════════════ */

const src = readFileSync("dist-artifact/index.html", "utf8");

const grabAll = (tag) => {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[0]);
  return out;
};

const title = /<title>([\s\S]*?)<\/title>/i.exec(src)?.[1]?.trim() ?? "Fidato PMS";
const styles = grabAll("style");
const scripts = grabAll("script");

if (styles.length === 0) throw new Error("No <style> found — refusing to ship an unstyled page.");
if (scripts.length === 0) throw new Error("No <script> found — refusing to ship a page that does nothing.");

/* The mount point the bundle looks for. Taken from the source rather
   than assumed: a build that renamed it would produce a blank page and
   no error anywhere. */
const rootId = /<div id="([^"]+)"><\/div>/.exec(src)?.[1];
if (!rootId) throw new Error("No mount div found in the build output.");

const page = [
  `<title>${title}</title>`,
  ...styles,
  `<div id="${rootId}"></div>`,
  ...scripts,
].join("\n");

writeFileSync("dist-artifact/artifact.html", page);

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`  title      ${title}`);
console.log(`  styles     ${styles.length}`);
console.log(`  scripts    ${scripts.length}`);
console.log(`  mount      #${rootId}`);
console.log(`  in         ${mb(src.length)} MB  ->  out ${mb(page.length)} MB`);
if (page.length > 16 * 1048576) {
  throw new Error("Over the 16 MB artifact limit.");
}
