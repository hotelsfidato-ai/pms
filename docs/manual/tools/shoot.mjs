// =============================================================================
// shoot.mjs — the manual's screenshots, taken from the local demo (D27-268, D27-293)
// =============================================================================
// The owner: real screenshots of the demo hotel (made-up guests only), with
// numbered orange arrows matching the steps. This drives a Chrome of its own
// (headless, through the DevTools protocol - no package needed), signs in with
// the LOCAL test sign-in (which the production build does not carry), does
// each picture's steps, draws the arrows over the page, and saves a PNG into
// docs/manual/img/. Run it again after a screen changes, and the book's
// picture changes with it (the book is kept current: D27-293).
//
//   node docs/manual/tools/shoot.mjs a8            every picture in shots/a8.mjs
//   node docs/manual/tools/shoot.mjs a8 A8-3 A8-4  only those
//
// Where: this PC, with the local web (5173) and API (8787) running and the demo
// database. Never the live system.
// =============================================================================

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUAL = join(HERE, "..");
const ROOT = join(MANUAL, "..", "..");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP ?? "http://localhost:5173";
const PORT = Number(process.env.CDP_PORT ?? 9333);
const PROFILE = join(ROOT, ".local", `manual-chrome-${PORT}`);
const SIZES = { desk: [1280, 800], phone: [375, 812], wall: [1440, 900] };

const [chapter, ...only] = process.argv.slice(2);
if (!chapter) {
  console.log("Which chapter? node docs/manual/tools/shoot.mjs a8 [ids...]");
  process.exit(1);
}
const { SHOTS } = await import(pathToFileURL(join(MANUAL, "shots", `${chapter}.mjs`)).href);
const wanted = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;

/* ── Chrome, of its own ─────────────────────────────────────────────── */
mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--disable-features=Translate", "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pageWs;
for (let i = 0; i < 60 && !pageWs; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!pageWs) await sleep(250);
}
if (!pageWs) { console.log("Chrome did not start."); chrome.kill(); process.exit(1); }

const ws = new WebSocket(pageWs);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await cdp("Page.enable");
/* The book is printed on white: the light look, whatever this PC prefers. */
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await cdp("Runtime.enable");

/* ── Finding things on the page, as a person would name them ─────────── */
const FIND = `
window.__find = (spec, nth = 0) => {
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0
    && getComputedStyle(e).visibility !== "hidden"; };
  const [kind, ...rest] = spec.split(":"); const want = rest.join(":");
  let all = [];
  if (kind === "css") all = [...document.querySelectorAll(want)];
  else if (kind === "label") {
    all = [...document.querySelectorAll("[aria-label]")].filter((e) => e.getAttribute("aria-label") === want);
    if (!all.length) all = [...document.querySelectorAll("[aria-label]")].filter((e) => e.getAttribute("aria-label").includes(want));
  } else {
    const els = [...document.querySelectorAll("body *")].filter((e) => !e.closest("#__manual_overlay"));
    const text = (e) => (e.innerText ?? "").trim().replace(/\\s+/g, " ");
    all = els.filter((e) => text(e) === want);
    if (!all.length) all = els.filter((e) => text(e).includes(want));
    /* The innermost: an element none of whose children also matches. */
    all = all.filter((e) => ![...e.children].some((c) => all.includes(c)));
  }
  return all.filter(visible)[nth] ?? null;
};`;

/* SHOOT_WAIT (ms): a busy D: drive can take longer than 8 s to draw a page
   after a load (15 Oct: Tables at 9 s) - SHOOT_WAIT=30000 waits longer. */
async function waitFor(spec, ms = Number(process.env.SHOOT_WAIT ?? 8000)) {
  for (let t = 0; t < ms; t += 200) {
    if (await js(`${FIND}; !!window.__find(${JSON.stringify(spec)})`)) return true;
    await sleep(200);
  }
  throw new Error(`Not found on the page: ${spec}`);
}

async function settle() {
  for (let t = 0; t < 8000; t += 200) {
    const busy = await js(`document.readyState !== "complete"
      || !!document.querySelector('[aria-busy="true"], .animate-pulse')`);
    if (!busy) break;
    await sleep(200);
  }
  await sleep(700);
}

async function centre(spec, nth) {
  return js(`${FIND}; (() => { const e = window.__find(${JSON.stringify(spec)}, ${nth ?? 0});
    if (!e) return null; e.scrollIntoView({ block: "center", inline: "nearest" });
    const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
}

async function click(spec, nth) {
  await waitFor(spec);
  const at = await centre(spec, nth);
  if (!at) throw new Error(`Cannot click: ${spec}`);
  await sleep(150);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  }
  await sleep(350);
}

async function type(spec, text) {
  await click(spec);
  await js(`(() => { try { document.activeElement.select(); } catch { /* not every field selects */ } })()`);
  await cdp("Input.insertText", { text });
  await sleep(250);
}

async function signInAs(label) {
  await cdp("Page.navigate", { url: `${APP}/signin` });
  await settle();
  await js(`sessionStorage.clear(); localStorage.setItem("fidato.ui", JSON.stringify({ state: { hotelId: "5EL", sidebarCollapsed: false }, version: 0 }))`);
  await cdp("Page.navigate", { url: `${APP}/signin` });
  await settle();
  await click(`text:${label}`);
  await sleep(1500);
}

/* ── The arrows ──────────────────────────────────────────────────────── */
const DRAW = `
window.__draw = (marks) => {
  document.getElementById("__manual_overlay")?.remove();
  const W = innerWidth, H = innerHeight, NS = "http://www.w3.org/2000/svg";
  const box = document.createElement("div");
  box.id = "__manual_overlay";
  box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.innerHTML = '<defs><marker id="__head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#FE611F"/></marker></defs>';
  box.appendChild(svg); document.body.appendChild(box);
  const missing = [];
  for (const m of marks) {
    const e = window.__find(m.at, m.nth ?? 0);
    if (!e) { missing.push(m.at); continue; }
    const r = e.getBoundingClientRect();
    const pad = 4, gap = 46;
    let side = m.side ?? (r.right + gap + 20 < W ? "right" : "left");
    const pos = (s) => s === "right" ? [r.right + gap, r.top + r.height / 2, r.right + pad + 2, r.top + r.height / 2]
      : s === "left" ? [r.left - gap, r.top + r.height / 2, r.left - pad - 2, r.top + r.height / 2]
      : s === "top" ? [r.left + r.width / 2, r.top - gap, r.left + r.width / 2, r.top - pad - 2]
      : [r.left + r.width / 2, r.bottom + gap, r.left + r.width / 2, r.bottom + pad + 2];
    let [cx, cy, tx, ty] = pos(side);
    cx = Math.max(18, Math.min(W - 18, cx)); cy = Math.max(18, Math.min(H - 18, cy));
    if (m.outline !== false) {
      const o = document.createElementNS(NS, "rect");
      o.setAttribute("x", r.left - pad); o.setAttribute("y", r.top - pad);
      o.setAttribute("width", r.width + pad * 2); o.setAttribute("height", r.height + pad * 2);
      o.setAttribute("rx", 8); o.setAttribute("fill", "none"); o.setAttribute("stroke", "#FE611F");
      o.setAttribute("stroke-width", 2.5); svg.appendChild(o);
    }
    const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1;
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", cx + dx / len * 16); l.setAttribute("y1", cy + dy / len * 16);
    l.setAttribute("x2", tx); l.setAttribute("y2", ty);
    l.setAttribute("stroke", "#FE611F"); l.setAttribute("stroke-width", 3); l.setAttribute("marker-end", "url(#__head)");
    svg.appendChild(l);
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", 15);
    c.setAttribute("fill", "#FE611F"); c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", 2.5);
    svg.appendChild(c);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", cx); t.setAttribute("y", cy + 5.5); t.setAttribute("text-anchor", "middle");
    t.setAttribute("font", "700 16px system-ui, sans-serif"); t.setAttribute("fill", "#fff");
    t.textContent = String(m.n); svg.appendChild(t);
  }
  return missing;
};`;

/* ── Each picture ─────────────────────────────────────────────────────── */
let who = null;
let failed = 0;
mkdirSync(join(MANUAL, "img"), { recursive: true });
for (const shot of wanted) {
  try {
    const [w, h] = SIZES[shot.size ?? "desk"];
    const phone = shot.size === "phone";
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: phone });
    if (shot.as && shot.as !== who) { await signInAs(shot.as); who = shot.as; }
    if (shot.path) {
      await cdp("Page.navigate", { url: /^(https?|file):/.test(shot.path) ? shot.path : `${APP}${shot.path}` });
      await settle();
    }
    for (const step of shot.steps ?? []) {
      /* Only if it is there - a "Got it" already pressed, say. */
      if (step.clickIf) {
        await sleep(400);
        if (await js(`${FIND}; !!window.__find(${JSON.stringify(step.clickIf)})`)) await click(step.clickIf, step.nth);
      }
      /* No connection for THIS browser only (the offline bar), so nobody has
         to stop the API others are using. { offline: false } brings it back. */
      if (step.offline !== undefined) {
        await cdp("Network.enable");
        await cdp("Network.emulateNetworkConditions", {
          offline: step.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
      }
      if (step.click) await click(step.click, step.nth);
      if (step.type) await type(step.type[0], step.type[1]);
      if (step.key) await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: step.key });
      if (step.waitFor) await waitFor(step.waitFor, step.ms);
      if (step.wait) await sleep(step.wait);
      if (step.eval) await js(step.eval);
      if (step.scroll) await centre(step.scroll, step.nth);
      if (step.settle) await settle();
    }
    await sleep(shot.pause ?? 300);
    /* A step of the run with no picture of its own. */
    if (shot.noShot) { console.log(`  · ${shot.id}  ${shot.title ?? ""}`); continue; }
    /* A printed document as the printer gets it (D27-342): the page's own
       print rules on A4, saved as .local/<id>.pdf; no arrows. */
    if (shot.pdf) {
      const { data } = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
      writeFileSync(join(ROOT, ".local", `${shot.id}.pdf`), Buffer.from(data, "base64"));
      console.log(`  ✓ ${shot.id}  ${shot.title ?? ""} (.local/${shot.id}.pdf)`);
      continue;
    }
    /* Every arrow's target on the page first: a page still drawing is not a
       page without it. */
    for (const m of shot.marks ?? []) await waitFor(m.at).catch(() => {});
    const missing = await js(`${FIND}; ${DRAW}; window.__draw(${JSON.stringify(shot.marks ?? [])})`);
    if (missing.length) throw new Error(`arrow targets not on the page: ${missing.join(" | ")}`);
    await sleep(120);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(MANUAL, "img", `${shot.id}.png`), Buffer.from(data, "base64"));
    await js(`document.getElementById("__manual_overlay")?.remove()`);
    console.log(`  ✓ ${shot.id}  ${shot.title ?? ""}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${shot.id}  ${error.message}`);
    /* What the page showed instead, for whoever reads the failure. */
    await cdp("Page.captureScreenshot", { format: "png" }).then(({ data }) =>
      writeFileSync(join(ROOT, ".local", `shoot-failed-${shot.id}.png`), Buffer.from(data, "base64"))).catch(() => {});
    if (shot.critical) break;
  }
}

ws.close();
chrome.kill();
console.log(failed ? `\n  ${failed} picture(s) not taken.` : "\n  Every picture taken.");
process.exit(failed ? 1 : 0);
