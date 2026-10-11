// =============================================================================
// check.mjs - "A day at the hotel" (D27-300), phase 1: the day run as a CHECK
// =============================================================================
// The manual's shoot.mjs approach (headless Chrome over the DevTools protocol,
// the LOCAL test sign-in, steps a person takes), copied here so shoot.mjs is
// never touched. Differences:
//   - Chrome is started once and KEPT (its own profile, C:\videos\.chrome\day,
//     port 9391), so the day can be run a chapter at a time and looked at in
//     between; `stop` ends it.
//   - Every shot is saved twice: check\NN-<what>.png (plain, the check) and
//     check\arrows\NN-<what>.png (with the numbered arrows, proving the marks
//     the narration will name are on the screen).
//   - Every shot reports the API's refusals and errors (4xx/5xx) and the
//     page's own errors seen while its steps ran, and the toasts on screen.
//   - Downloads are allowed into C:\videos\day\downloads.
//
//   node check.mjs start
//   node check.mjs run day.shots.mjs [ids...]     (ids: DAY-05 or a range DAY-05..DAY-09)
//   node check.mjs as "General Manager"           sign in
//   node check.mjs go /h/5EL/cashiering           open an address
//   node check.mjs text [css]                     the page's words
//   node check.mjs eval "<js>"                    look at something
//   node check.mjs shot <name>                    a picture of the screen now
//   node check.mjs click "<spec>" [nth]           a click as a person makes it
//   node check.mjs stop
//
// Local demo only (http://localhost:5173, API 8787). Never the live system.
// =============================================================================

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.APP ?? "http://localhost:5173";
const PORT = Number(process.env.CDP_PORT ?? 9391);
const PROFILE = "C:\\videos\\.chrome\\day";
const OUT = join(HERE, "check");
const ARROWS = join(OUT, "arrows");
const DOWNLOADS = join(HERE, "downloads");
const STATE = join(HERE, ".state.json");
const LOG = join(HERE, "check.log");
const SIZES = { desk: [1280, 800], phone: [375, 812], wall: [1440, 900] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { who: null };
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const log = (line) => { console.log(line); appendFileSync(LOG, `${line}\n`); };

const [command, ...args] = process.argv.slice(2);

/* ── Chrome, of its own, kept between runs ───────────────────────────── */
async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return null; }
}
async function startChrome() {
  if (await targets()) return;
  mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate", "--window-size=1280,800", "about:blank",
  ], { stdio: "ignore", detached: true });
  chrome.unref();
  for (let i = 0; i < 60; i++) { if (await targets()) return; await sleep(250); }
  throw new Error("Chrome did not start.");
}

if (command === "stop") {
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null))?.json?.();
  if (v?.webSocketDebuggerUrl) {
    const b = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r) => { b.onopen = r; b.onerror = r; });
    b.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(500);
  }
  console.log("Chrome stopped.");
  process.exit(0);
}

await startChrome();

/* The browser itself: downloads into C:\videos\day\downloads. */
{
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const b = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { b.onopen = r; b.onerror = j; });
  mkdirSync(DOWNLOADS, { recursive: true });
  await new Promise((r) => {
    b.onmessage = () => r();
    b.send(JSON.stringify({ id: 1, method: "Browser.setDownloadBehavior",
      params: { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true } }));
  });
  b.close();
}

let list = await targets();
let page = list.find((t) => t.type === "page");
if (!page) {
  page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
const seen = { api: [], errors: [] };
const inFlight = new Set();
let lastApi = 0;
const requests = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    requests.set(msg.params.requestId, msg.params.request);
    if (msg.params.request.url.includes("/api/")) { inFlight.add(msg.params.requestId); lastApi = Date.now(); }
  } else if (msg.method === "Network.loadingFinished" || msg.method === "Network.loadingFailed") {
    if (inFlight.delete(msg.params.requestId)) lastApi = Date.now();
  } else if (msg.method === "Network.responseReceived") {
    const { response, requestId } = msg.params;
    if (response.url.includes("/api/") && response.status >= 400) {
      const req = requests.get(requestId);
      seen.api.push({ requestId, status: response.status, method: req?.method ?? "?", url: response.url.replace(/^https?:\/\/[^/]+/, "") });
    }
  } else if (msg.method === "Runtime.exceptionThrown") {
    seen.errors.push(`exception: ${msg.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? msg.params.exceptionDetails?.text}`);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    seen.errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
  } else if (msg.method === "Page.downloadWillBegin") {
    seen.errors.push(`(download: ${msg.params.suggestedFilename})`);
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
/* Downloads into C:ideosdaydownloads, on this page's own session too. */
await cdp("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS }).catch(() => {});
await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

/* The words of a refusal, read back from the API's answer. */
async function apiWords(entry) {
  try {
    const { body } = await cdp("Network.getResponseBody", { requestId: entry.requestId });
    return body.slice(0, 300);
  } catch { return ""; }
}

/* ── Finding things on the page, as a person would name them (shoot.mjs) ── */
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

async function has(spec, nth = 0) { return js(`${FIND}; !!window.__find(${JSON.stringify(spec)}, ${nth})`); }
async function waitFor(spec, ms = 8000, nth = 0) {
  for (let t = 0; t < ms; t += 200) { if (await has(spec, nth)) return true; await sleep(200); }
  throw new Error(`Not found on the page: ${spec}`);
}
/* The page settled: loaded, nothing drawing a grey block, and - beyond
   shoot.mjs - the API quiet for 800 ms. The app opens on its last copy of a
   list (the read cache) and re-reads it; a picture taken before that answer
   is a picture of the past (found 10 Oct: Due out still listing a guest
   checked out a minute earlier, for about five seconds after opening). */
async function settle() {
  for (let t = 0; t < 8000; t += 200) {
    const busy = await js(`document.readyState !== "complete"
      || !!document.querySelector('[aria-busy="true"], .animate-pulse')`);
    if (!busy) break;
    await sleep(200);
  }
  for (let t = 0; t < 8000; t += 100) {
    if (inFlight.size === 0 && Date.now() - lastApi > 800) break;
    await sleep(100);
  }
  await sleep(700);
}
async function centre(spec, nth) {
  return js(`${FIND}; (() => { const e = window.__find(${JSON.stringify(spec)}, ${nth ?? 0});
    if (!e) return null; e.scrollIntoView({ block: "center", inline: "nearest" });
    const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
}
async function click(spec, nth) {
  await waitFor(spec, 8000, nth ?? 0);
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
  state.who = label; saveState();
}
async function size(name = "desk") {
  const [w, h] = SIZES[name];
  const phone = name === "phone";
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: phone });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: phone });
}
async function picture(file) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
}
async function toasts() {
  return js(`[...document.querySelectorAll("[role=region] [role=status], [role=region] [role=alert], [data-sonner-toast]")]
    .map((e) => e.innerText.trim().replace(/\\s+/g, " ")).filter(Boolean)`);
}

/* ── The arrows (shoot.mjs's, as they will be drawn in the video) ─────── */
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
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) { missing.push(m.at + " (off screen)"); }
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

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/* ── One step, as a person takes it ───────────────────────────────────── */
async function doStep(step) {
  if (step.clickIf) {
    await sleep(400);
    if (await has(step.clickIf, step.nth ?? 0)) await click(step.clickIf, step.nth);
  }
  if (step.click) await click(step.click, step.nth);
  if (step.type) await type(step.type[0], step.type[1]);
  if (step.key) {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: step.key });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: step.key });
  }
  if (step.waitFor) await waitFor(step.waitFor, step.ms, step.nth ?? 0);
  if (step.wait) await sleep(step.wait);
  if (step.eval) {
    const v = await js(step.eval);
    if (v !== undefined && v !== null && v !== true) log(`      eval → ${JSON.stringify(v).slice(0, 400)}`);
  }
  if (step.scroll) await centre(step.scroll, step.nth);
  if (step.settle) await settle();
  if (step.go) { await cdp("Page.navigate", { url: /^(https?|file):/.test(step.go) ? step.go : `${APP}${step.go}` }); await settle(); }
}

async function runShots(file, only) {
  const { SHOTS } = await import(pathToFileURL(join(HERE, file)).href + `?t=${Date.now()}`);
  let wanted = SHOTS;
  if (only.length) {
    wanted = [];
    for (const o of only) {
      if (o.includes("..")) {
        const [a, b] = o.split("..");
        const i = SHOTS.findIndex((s) => s.id === a), j = SHOTS.findIndex((s) => s.id === b);
        if (i < 0 || j < 0) throw new Error(`No such range ${o}`);
        wanted.push(...SHOTS.slice(i, j + 1));
      } else {
        const s = SHOTS.find((x) => x.id === o);
        if (!s) throw new Error(`No such shot ${o}`);
        wanted.push(s);
      }
    }
  }
  mkdirSync(ARROWS, { recursive: true });
  let failed = 0;
  for (const shot of wanted) {
    seen.api.length = 0; seen.errors.length = 0;
    const name = `${shot.id.replace(/^DAY-/, "")}-${slug(shot.file ?? shot.title)}`;
    try {
      await size(shot.size ?? "desk");
      if (shot.as && shot.as !== state.who) await signInAs(shot.as);
      if (shot.path) {
        await cdp("Page.navigate", { url: /^(https?|file):/.test(shot.path) ? shot.path : `${APP}${shot.path}` });
        await settle();
      }
      for (const step of shot.steps ?? []) await doStep(step);
      await sleep(shot.pause ?? 300);
      if (shot.noShot) {
        log(`  · ${shot.id}  ${shot.title ?? ""}`);
      } else {
        for (const m of shot.marks ?? []) await waitFor(m.at, 4000, m.nth ?? 0).catch(() => {});
        await picture(join(OUT, `${name}.png`));
        const missing = await js(`${FIND}; ${DRAW}; window.__draw(${JSON.stringify(shot.marks ?? [])})`);
        await sleep(120);
        await picture(join(ARROWS, `${name}.png`));
        await js(`document.getElementById("__manual_overlay")?.remove()`);
        log(`  ✓ ${shot.id}  ${shot.title ?? ""}  → check\\${name}.png`);
        if (missing.length) log(`      ! marks not on the screen: ${missing.join(" | ")}`);
      }
    } catch (error) {
      failed++;
      log(`  ✗ ${shot.id}  ${shot.title ?? ""}  ${error.message.split("\n")[0]}`);
      try { await picture(join(OUT, `${name}--FAILED.png`)); log(`      picture: check\\${name}--FAILED.png`); } catch { /* none */ }
    }
    const t = await toasts().catch(() => []);
    if (t.length) log(`      toasts: ${t.join(" || ")}`);
    for (const a of seen.api) log(`      API ${a.status} ${a.method} ${a.url}  ${await apiWords(a)}`);
    for (const e of seen.errors) log(`      page: ${e}`);
    if (failed && shot.critical) break;
  }
  return failed;
}

/* ── The commands ─────────────────────────────────────────────────────── */
let code = 0;
try {
  if (command === "start") {
    console.log(`Chrome on ${PORT}, signed in as ${state.who ?? "nobody"}.`);
  } else if (command === "run") {
    const [file, ...only] = args;
    log(`\n== run ${file} ${only.join(" ")}  (${new Date().toLocaleString("en-IN")})`);
    code = (await runShots(file, only)) ? 1 : 0;
  } else if (command === "as") {
    await size("desk");
    await signInAs(args[0]);
    console.log(`Signed in as ${args[0]}: ${await js("location.pathname")}`);
  } else if (command === "go") {
    await size(args[1] ?? "desk");
    await cdp("Page.navigate", { url: /^(https?|file):/.test(args[0]) ? args[0] : `${APP}${args[0]}` });
    await settle();
    await sleep(Number(process.env.WAIT ?? 1500));
    console.log(await js("location.href"));
  } else if (command === "text") {
    const css = args[0] ?? "main";
    console.log(await js(`(document.querySelector(${JSON.stringify(css)}) ?? document.body).innerText`));
  } else if (command === "eval") {
    const v = await js(args[0]);
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  } else if (command === "shot") {
    mkdirSync(join(HERE, "look"), { recursive: true });
    const f = join(HERE, "look", `${args[0] ?? "now"}.png`);
    await picture(f);
    console.log(f);
  } else if (command === "click") {
    await click(args[0], args[1] ? Number(args[1]) : undefined);
    await sleep(800);
    const t = await toasts().catch(() => []);
    if (t.length) console.log(`toasts: ${t.join(" || ")}`);
  } else if (command === "type") {
    await type(args[0], args[1]);
  } else if (command === "steps") {
    /* A few steps given as JSON, for looking around. */
    for (const step of JSON.parse(args[0])) await doStep(step);
    await sleep(600);
    const t = await toasts().catch(() => []);
    if (t.length) console.log(`toasts: ${t.join(" || ")}`);
  } else {
    console.log("start | run <file> [ids] | as <label> | go <path> | text [css] | eval <js> | shot <name> | click <spec> | type <spec> <text> | steps <json> | stop");
  }
  await sleep(300);
  for (const a of seen.api) if (command !== "run") console.log(`API ${a.status} ${a.method} ${a.url}  ${await apiWords(a)}`);
  for (const e of seen.errors) if (command !== "run") console.log(`page: ${e}`);
} catch (error) {
  console.log(`✗ ${error.message.split("\n")[0]}`);
  code = 1;
}
ws.close();
process.exit(code);
