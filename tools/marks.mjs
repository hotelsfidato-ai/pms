// marks.mjs — where each numbered orange arrow is in the manual's pictures.
//
//   node tools/marks.mjs a8
//
// Copies the chapter's pictures (docs/manual/img/A8-*.png in the PMS checkout)
// into public/<chapter>/shots/, then finds in each one the orange numbered
// circles the manual's shoot.mjs drew (r 15, #FE611F, white ring, white digit),
// reads each circle's number by drawing the same digits and comparing, and the
// way its arrow points. Writes src/data/marks-<chapter>.json, which the videos'
// camera uses to zoom to "arrow 2" when the voice names it.
// Uses a Chrome of its own (headless) for the pixels and the digits.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The PMS checkout: PMS= if given, else the original desktop's D:/fidato pms,
// else the 9-12 Oct PC's folder.
const PMS = process.env.PMS
  ?? ["D:/fidato pms", "C:/Users/rozar.ROZARIO/pms"].find((p) => existsSync(join(p, "docs", "manual")))
  ?? "D:/fidato pms";
const IMG = process.env.IMG ?? join(PMS, "docs", "manual", "img");
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9351);

const chapter = process.argv[2];
if (!chapter) { console.log("Which chapter? node tools/marks.mjs a8"); process.exit(1); }
const prefix = `${chapter.toUpperCase()}-`;
const files = readdirSync(IMG).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).sort();
const SHOTS = join(ROOT, "public", chapter, "shots");
mkdirSync(SHOTS, { recursive: true });
for (const f of files) copyFileSync(join(IMG, f), join(SHOTS, f));

/* How many arrows each picture has: the manual's own list of its pictures. */
const { pathToFileURL } = await import("node:url");
const SPEC = (await import(pathToFileURL(join(PMS, "docs", "manual", "shots", `${chapter}.mjs`)).href)).SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = join(ROOT, ".chrome", `marks-${PORT}`);
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let pageWs;
for (let i = 0; i < 60 && !pageWs; i++) {
  try { pageWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; }
  catch { /* not up yet */ }
  if (!pageWs) await sleep(250);
}
if (!pageWs) { console.log("Chrome did not start."); chrome.kill(); process.exit(1); }
const ws = new WebSocket(pageWs);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.j(new Error(msg.error.message)) : p.r(msg.result); } };
const cdp = (method, params = {}) => new Promise((r, j) => { const id = nextId++; pending.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const FINDER = `
window.__marks = async (src, K) => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data;
  const at = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return [0, 0, 0]; const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const orange = ([r, g, b]) => Math.abs(r - 254) < 30 && Math.abs(g - 97) < 38 && Math.abs(b - 31) < 45;
  const white = ([r, g, b]) => r > 225 && g > 225 && b > 225;
  /* Integral image of orange, for a fast "how much orange around here". */
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
    row += (Math.abs(px[i] - 254) < 30 && Math.abs(px[i + 1] - 97) < 38 && Math.abs(px[i + 2] - 31) < 45) ? 1 : 0;
    S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const box = (x, y, h) => { const a = Math.max(0, x - h), b = Math.max(0, y - h), c = Math.min(W, x + h + 1), d = Math.min(H, y + h + 1);
    return S[d * (W + 1) + c] - S[b * (W + 1) + c] - S[d * (W + 1) + a] + S[b * (W + 1) + a]; };
  const ring = (x, y, r, test, n = 24) => { let k = 0; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; if (test(at(x + r * Math.cos(t), y + r * Math.sin(t)))) k++; } return k / n; };
  /* Three passes, strictest first. A circle drawn close to another orange line
     (its own target's outline, another arrow, an orange button) fails the
     strict "nothing orange just outside it" test, so the looser passes only
     FILL a picture's missing arrows (K, from the manual's own list), never
     add a second circle within 22 px of one already found. */
  const PASSES = [
    { o11: 0.8, w: 0.75, o19: 0.4 },
    { o11: 0.75, w: 0.55, o19: 0.7 },
    { o11: 0.6, w: 0.4, o19: 1.01 },
  ];
  const circles = [];
  for (const [p, pass] of PASSES.entries()) {
    if (p > 0 && K && circles.length >= K) break;
    const found = [];
    for (let y = 10; y < H - 10; y += 2) for (let x = 10; x < W - 10; x += 2) {
      if (box(x, y, 9) < 250) continue;
      const o11 = ring(x, y, 11, orange), w = ring(x, y, 15.2, white), o19 = ring(x, y, 19, orange, 32);
      if (o11 < pass.o11 || w < pass.w || o19 > pass.o19) continue;
      found.push({ x, y, s: box(x, y, 9), q: o11 + w - o19 / 2 });
    }
    /* One per circle: the best of each cluster. */
    found.sort((a, b) => (p === 0 ? b.s - a.s : b.q - a.q));
    for (const f of found) {
      if (p > 0 && K && circles.length >= K) break;
      if (!circles.some((c) => Math.hypot(c.x - f.x, c.y - f.y) < 22)) circles.push({ ...f, pass: p });
    }
  }
  for (const c of circles) {
    let best = -1;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const s = ring(c.x + dx, c.y + dy, 15.2, white, 48) + ring(c.x + dx, c.y + dy, 12, orange, 48);
      if (s > best) { best = s; c.rx = c.x + dx; c.ry = c.y + dy; }
    }
    c.x = c.rx; c.y = c.ry;
  }
  /* Its number: the same circle and digit drawn here, compared shade by shade
     (the green channel: orange 97, white 255) inside the disc; and a picture's
     numbers run 1, 2, 3 … one each, so the best one-to-one reading wins. */
  const R = 11;
  const shade = (get, x, y) => { const v = []; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    if (i * i + j * j > R * R) continue; v.push(Math.max(0, Math.min(1, (get(x + i, y + j)[1] - 97) / 158))); } return v; };
  const ncc = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let k = 0; k < n; k++) { ma += a[k]; mb += b[k]; } ma /= n; mb /= n;
    let ab = 0, aa = 0, bb = 0; for (let k = 0; k < n; k++) { const x = a[k] - ma, y = b[k] - mb; ab += x * y; aa += x * x; bb += y * y; }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0; };
  const ref = new OffscreenCanvas(48, 48), rc = ref.getContext("2d", { willReadFrequently: true });
  const refs = [];
  for (let n = 1; n <= 12; n++) for (const ox of [-1, -0.5, 0, 0.5, 1]) for (const oy of [-1, -0.5, 0, 0.5, 1]) {
    rc.clearRect(0, 0, 48, 48); rc.fillStyle = "#FE611F"; rc.beginPath(); rc.arc(24 + ox, 24 + oy, 15, 0, Math.PI * 2); rc.fill();
    rc.fillStyle = "#fff"; rc.font = "700 16px system-ui, sans-serif"; rc.textAlign = "center"; rc.fillText(String(n), 24 + ox, 29.5 + oy);
    const d = rc.getImageData(0, 0, 48, 48).data;
    refs.push({ n, v: shade((x, y) => { const i = (y * 48 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }, 24, 24) });
  }
  const k = circles.length; K = Math.max(K || 0, k);
  const score = circles.map((c) => { const best = new Array(13).fill(-1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = shade(at, c.x + dx, c.y + dy);
      for (const r of refs) { const s = ncc(v, r.v); if (s > best[r.n]) best[r.n] = s; } }
    return best; });
  /* One-to-one: every way of giving 1..k to the k circles (k is small). */
  let bestSum = -Infinity, bestPerm = null;
  const perm = (left, used, sum, acc) => { if (left === k) { if (sum > bestSum) { bestSum = sum; bestPerm = acc.slice(); } return; }
    for (let n = 1; n <= K; n++) if (!used[n]) { used[n] = true; acc.push(n); perm(left + 1, used, sum + score[left][n], acc); acc.pop(); used[n] = false; } };
  if (K <= 8) perm(0, [], 0, []);
  else bestPerm = score.map((b) => b.indexOf(Math.max(...b.slice(1))));
  circles.forEach((c, i) => { c.n = bestPerm[i]; c.score = score[i][c.n];
    c.alone = score[i].indexOf(Math.max(...score[i].slice(1))); });
  for (const c of circles) {
    /* The way its arrow goes: the most orange just outside the ring. */
    let most = -1;
    for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; let q = 0;
      for (let r = 19; r <= 34; r += 1.5) if (orange(at(c.x + r * Math.cos(t), c.y + r * Math.sin(t)))) q++;
      if (q > most) { most = q; c.dx = Math.round(Math.cos(t) * 100) / 100; c.dy = Math.round(Math.sin(t) * 100) / 100; } }
  }
  return { w: W, h: H, circles: circles.map(({ x, y, n, score, alone, dx, dy }) => ({ n, x, y, dx, dy, alone, score: Math.round(score * 100) / 100 })) };
};`;

await cdp("Runtime.enable");
await js(FINDER);
const out = {};
let doubtful = 0;
for (const f of files) {
  const src = `data:image/png;base64,${readFileSync(join(SHOTS, f)).toString("base64")}`;
  const id = f.replace(/\.png$/, "");
  const K = (SPEC.find((x) => x.id === id)?.marks ?? []).length;
  const r = await js(`window.__marks(${JSON.stringify(src)}, ${K})`);
  const marks = {};
  for (const c of r.circles) {
    if (marks[c.n]) { doubtful++; console.log(`  ? ${id}: two circles read as ${c.n}`); continue; }
    marks[c.n] = { x: c.x, y: c.y, dx: c.dx, dy: c.dy, score: c.score };
    if (c.score < 0.75 || c.alone !== c.n) { doubtful++; console.log(`  ? ${id}: circle ${c.n} at ${c.x},${c.y} read with ${c.score} (alone it reads ${c.alone})`); }
  }
  out[id] = { w: r.w, h: r.h, marks };
  for (let n = 1; n <= K; n++) if (!marks[n]) { doubtful++; console.log(`  ! ${id}: arrow ${n} not found`); }
  console.log(`  ${id}  ${r.w}×${r.h}  ${Object.keys(marks).sort().map((n) => `${n}@${marks[n].x},${marks[n].y}`).join("  ")}`);
}
mkdirSync(join(ROOT, "src", "data"), { recursive: true });
writeFileSync(join(ROOT, "src", "data", `marks-${chapter}.json`), JSON.stringify(out, null, 1));
ws.close(); chrome.kill();
console.log(`\n  ${files.length} pictures, ${doubtful} doubtful (src/data/marks-${chapter}.json)`);
