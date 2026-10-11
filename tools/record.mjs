// record.mjs — the screen recordings for the "Watch it done" part of each video.
//
//   node tools/record.mjs a8
//
// The same run as the manual's own screenshot tool (docs/manual/tools/shoot.mjs
// in the PMS checkout, read-only here): a headless Chrome of its own, the LOCAL
// test sign-in, the light look, the same steps from docs/manual/shots/a8.mjs.
// For each shot named in a "record" list of script/<chapter>.json, after its
// page has settled, it starts a screencast (JPEG frames as the page changes),
// does the steps with a visible cursor that glides to each click and ripples,
// types letter by letter, holds about 1.5 s, and stops.
//
// Writes: public/<chapter>/rec/<shot>/NNNN.jpg and src/data/rec-<chapter>.json
//   { "<shot>": { w, h, dur, frames: [{ file, t }] } }   t = seconds from the shot's start.
//
// Needs: the local web (5173), API (8787) and virtual printers (5199) running,
// on the demo database. Never the live system. Table N4 must be free at the
// start (the A8-00b step clears a paid bill left on it).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The PMS checkout: PMS= if given, else the original desktop's D:/fidato pms,
// else the 9-12 Oct PC's folder.
const PMS = process.env.PMS
  ?? ["D:/fidato pms", "C:/Users/rozar.ROZARIO/pms"].find((p) => existsSync(join(p, "docs", "manual")))
  ?? "D:/fidato pms";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP ?? "http://localhost:5173";
const PORT = Number(process.env.CDP_PORT ?? 9381);
const PROFILE = join(ROOT, ".chrome", "record");
const SIZES = { desk: [1280, 800], phone: [375, 812], wall: [1440, 900] };
const HOLD_MS = 1500;
const LETTER_MS = 60;
const GLIDE_MS = 400;

const chapter = process.argv[2];
if (!chapter) { console.log("Which chapter? node tools/record.mjs a8"); process.exit(1); }
const { SHOTS } = await import(pathToFileURL(join(PMS, "docs", "manual", "shots", `${chapter}.mjs`)).href);
const script = JSON.parse(readFileSync(join(ROOT, "script", `${chapter}.json`), "utf8"));
const RECORD = new Set(script.videos.flatMap((v) => v.record ?? []));

/* The run: the set-up shots, then from the first recorded shot to the last,
   in the manual's order (pictures-only shots outside that range are skipped). */
const ids = SHOTS.map((s) => s.id);
const recIdx = ids.map((id, i) => (RECORD.has(id) ? i : -1)).filter((i) => i >= 0);
const first = Math.min(...recIdx), last = Math.max(...recIdx);
const SETUP = ["A8-00", "A8-00b"].filter((id) => ids.includes(id));
const RUN = [...SETUP.map((id) => SHOTS[ids.indexOf(id)]), ...SHOTS.slice(first, last + 1)];
console.log(`Run: ${RUN.map((s) => s.id).join(" ")}`);
console.log(`Recorded: ${[...RECORD].join(" ")}\n`);

/* ── Chrome, of its own ─────────────────────────────────────────────── */
mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--disable-features=Translate", "--window-size=1440,900", "about:blank",
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
  } else if (msg.method === "Page.screencastFrame") {
    onFrame(msg.params);
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
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await cdp("Runtime.enable");

/* ── The recording ───────────────────────────────────────────────────── */
const OUT_JSON = join(ROOT, "src", "data", `rec-${chapter}.json`);
const result = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, "utf8")) : {};
let rec = null;
const now = () => (Date.now() - rec.start) / 1000;

function saveFrame(data, t) {
  rec.n++;
  const name = `${String(rec.n).padStart(4, "0")}.jpg`;
  writeFileSync(join(rec.dir, name), Buffer.from(data, "base64"));
  rec.frames.push({ file: `${chapter}/rec/${rec.id}/${name}`, t: Math.round(t * 1000) / 1000 });
}
function onFrame({ data, sessionId }) {
  cdp("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (rec && rec.live) saveFrame(data, now());
}
async function startRec(id, w, h) {
  const dir = join(ROOT, "public", chapter, "rec", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  rec = { id, dir, w, h, n: 0, frames: [], start: Date.now(), live: false };
  const { data } = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  rec.start = Date.now();
  saveFrame(data, 0);
  rec.live = true;
  await cdp("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
}
async function stopRec() {
  await sleep(300);
  /* The end state for sure, even if the last change made no frame. */
  const { data } = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  saveFrame(data, now());
  await sleep(HOLD_MS - 300);
  await cdp("Page.stopScreencast");
  rec.live = false;
  const dur = Math.round(now() * 1000) / 1000;
  result[rec.id] = { w: rec.w, h: rec.h, dur, frames: rec.frames };
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 1));
  const r = rec;
  rec = null;
  return r;
}

/* ── The cursor: drawn into the page, so the frames carry it ────────── */
let cursorOn = false;
let cur = [640, 400];
const ENSURE = (x, y) => `(() => {
  let c = document.getElementById("__rec_cursor");
  if (c) return false;
  c = document.createElement("div");
  c.id = "__rec_cursor";
  c.style.cssText = "position:fixed;left:0;top:0;width:30px;height:30px;pointer-events:none;z-index:2147483647;"
    + "transition:transform ${GLIDE_MS}ms cubic-bezier(.45,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))";
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M3 2 L3 23 L8.6 17.6 L12.8 27 L16.6 25.4 L12.5 16.2 L20.2 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  c.style.transform = "translate(${x - 3}px, ${y - 2}px)";
  document.documentElement.appendChild(c);
  c.getBoundingClientRect();
  return true;
})()`;
async function moveCursor(x, y) {
  await js(ENSURE(cur[0], cur[1]));
  await sleep(30);
  await js(`(() => { const c = document.getElementById("__rec_cursor"); c.style.transform = "translate(${x - 3}px, ${y - 2}px)"; })()`);
  const far = Math.hypot(x - cur[0], y - cur[1]) > 2;
  cur = [x, y];
  if (far) await sleep(GLIDE_MS + 60);
}
async function ripple(x, y) {
  await js(`(() => { const r = document.createElement("div");
    r.style.cssText = "position:fixed;left:${x - 24}px;top:${y - 24}px;width:48px;height:48px;border-radius:50%;"
      + "border:3px solid #FE611F;background:rgba(254,97,31,.28);pointer-events:none;z-index:2147483646;"
      + "transform:scale(.25);opacity:1;transition:transform 480ms ease-out, opacity 480ms ease-out";
    document.documentElement.appendChild(r); r.getBoundingClientRect();
    r.style.transform = "scale(1.5)"; r.style.opacity = "0";
    setTimeout(() => r.remove(), 700); })()`);
}

/* ── Finding things on the page (the manual's own finder) ────────────── */
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
    all = all.filter((e) => ![...e.children].some((c) => all.includes(c)));
  }
  return all.filter(visible)[nth] ?? null;
};`;

async function waitFor(spec, ms = 8000) {
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
  let at = await centre(spec, nth);
  if (!at) throw new Error(`Cannot click: ${spec}`);
  if (cursorOn) {
    await moveCursor(at[0], at[1]);
    /* The page may have moved under the glide (a window opening). */
    const again = await centre(spec, nth);
    if (!again) throw new Error(`Cannot click: ${spec}`);
    if (Math.hypot(again[0] - at[0], again[1] - at[1]) > 2) { at = again; await moveCursor(at[0], at[1]); }
    await ripple(at[0], at[1]);
    await sleep(120);
  } else {
    await sleep(150);
  }
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  }
  await sleep(350);
}

async function type(spec, text) {
  await click(spec);
  await js(`(() => { try { document.activeElement.select(); } catch { /* not every field selects */ } })()`);
  for (const ch of text) {
    await cdp("Input.insertText", { text: ch });
    await sleep(LETTER_MS);
  }
  await sleep(250);
}

async function signInAs(label) {
  await cdp("Page.navigate", { url: `${APP}/signin` });
  await settle();
  await js(`sessionStorage.clear(); localStorage.setItem("fidato.ui", JSON.stringify({ state: { hotelId: "5EL", sidebarCollapsed: false }, version: 0 }))`);
  await cdp("Page.navigate", { url: `${APP}/signin` });
  await settle();
  await waitFor(`text:${label}`).catch(() => {});
  const dev = await js(`document.body.innerText.toLowerCase().includes("development only")`);
  if (!dev) throw new Error(`the local sign-in page shows no "Development only" buttons`);
  await click(`text:${label}`);
  await sleep(1500);
}

/* ── Each shot ───────────────────────────────────────────────────────── */
let who = null;
let failed = 0;
const report = [];
for (const shot of RUN) {
  const recording = RECORD.has(shot.id);
  try {
    const [w, h] = SIZES[shot.size ?? "desk"];
    const phone = shot.size === "phone";
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: phone });
    cursorOn = false;
    if (shot.as && shot.as !== who) { await signInAs(shot.as); who = shot.as; }
    if (shot.path) {
      await cdp("Page.navigate", { url: /^(https?|file):/.test(shot.path) ? shot.path : `${APP}${shot.path}` });
      await settle();
    }
    const clicks = (shot.steps ?? []).some((s) => s.click || s.clickIf || s.type);
    if (recording) {
      if (shot.path || cur[0] > w || cur[1] > h) cur = [Math.round(w * 0.55), Math.round(h * 0.6)];
      await startRec(shot.id, w, h);
      cursorOn = clicks;
      if (cursorOn) { await js(ENSURE(cur[0], cur[1])); await sleep(500); }
    }
    for (const step of shot.steps ?? []) {
      if (step.clickIf) {
        await sleep(400);
        if (await js(`${FIND}; !!window.__find(${JSON.stringify(step.clickIf)})`)) await click(step.clickIf, step.nth);
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
    if (recording) {
      /* End on what the manual's picture shows: its arrows' targets drawn. */
      for (const m of shot.marks ?? []) await waitFor(m.at, 3000).catch(() => {});
      /* If the first of them is off the screen (a list scrolled under the
         click), bring it into view, as a person would scroll to it. */
      const m0 = (shot.marks ?? [])[0];
      if (m0) {
        const off = await js(`${FIND}; (() => { const e = window.__find(${JSON.stringify(m0.at)}, ${m0.nth ?? 0});
          if (!e) return false; const r = e.getBoundingClientRect();
          if (r.top >= 60 && r.bottom <= innerHeight - 10) return false;
          e.scrollIntoView({ block: "center", behavior: "smooth" }); return true; })()`);
        if (off) await sleep(900);
      }
      const r = await stopRec();
      const line = `  ● ${shot.id}  ${r.frames.length} frames, ${result[shot.id].dur.toFixed(1)} s  ${shot.title ?? ""}`;
      console.log(line); report.push(line);
    } else {
      console.log(`  · ${shot.id}  ${shot.title ?? ""}`);
    }
  } catch (error) {
    failed++;
    if (rec) { try { await cdp("Page.stopScreencast"); } catch { /* gone */ } rec = null; }
    const line = `  ✗ ${shot.id}  ${error.message}`;
    console.log(line); report.push(line);
    if (shot.critical) break;
  }
}

ws.close();
chrome.kill();
console.log(failed ? `\n  ${failed} shot(s) failed.` : "\n  Every shot done.");
process.exit(failed ? 1 : 0);
