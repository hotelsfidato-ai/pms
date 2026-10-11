// render-all.mjs — every chapter whose data is complete, ONE CHAPTER AT A TIME:
// the task videos that are missing or no longer match their data, the chapter
// card if it is missing or its titles changed, then the full chapter joined.
// Run it again later to pick up chapters whose data was finished afterwards;
// what is already made and unchanged is left alone.
//
//   node tools/render-all.mjs               every chapter in src/data
//   node tools/render-all.mjs a2 a4         only these chapters
//   node tools/render-all.mjs --skip=a8     every chapter but these (comma-separated)
//   node tools/render-all.mjs --dry         only say what would be made
//
// A chapter is complete when src/data/<ch>.json and marks-<ch>.json are there,
// every voice file and picture they name is in public/<ch>/, and its data has
// not been written in the last SETTLE seconds (default 90: a helper may still
// be at it; the run waits for it and looks again). "Up to date" is judged by
// out/<ch>/parts/stamps.json (see staleness() in lib.mjs).
// Each chapter is made by `node tools/render.mjs <ch> --stale`; its output goes
// to out/<ch>/render-all.log. CONCURRENCY (default 3: the PC is busy).

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import { chapterKeys, dataTime, loadChapter, mmss, probe, ROOT, staleness, writeStamp } from "./lib.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const skip = new Set(args.filter((a) => a.startsWith("--skip=")).flatMap((a) => a.slice(7).split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean));
const only = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
const SETTLE = Number(process.env.SETTLE ?? 90);
const CONCURRENCY = process.env.CONCURRENCY ?? "3";
const sleep = (s) => spawnSync(process.execPath, ["-e", `setTimeout(()=>{},${Math.ceil(s * 1000)})`]);
const stamp = () => new Date().toTimeString().slice(0, 8);

const keys = () => chapterKeys().filter((k) => (!only.length || only.includes(k)) && !skip.has(k));
const results = new Map(); /* key -> { ok, rendered, full, length, minutes } */
const failed = new Set();
const notReady = new Map();
const upToDate = new Set();

for (let pass = 1; pass <= 8; pass++) {
  let worked = false;
  const waiting = [];
  for (const key of keys()) {
    if (failed.has(key)) continue;
    const ch = loadChapter(key);
    if (ch.errors.length) { notReady.set(key, ch.errors); continue; }
    notReady.delete(key);
    const age = (Date.now() - dataTime(key)) / 1000;
    if (age < SETTLE) { waiting.push({ key, left: SETTLE - age }); continue; }
    const s = staleness(ch);
    if (!s.videos.length && !s.card && !s.join) {
      if (!dry) for (const [name, value] of Object.entries(s.adopt)) writeStamp(ch, name, value);
      upToDate.add(key);
      continue;
    }
    upToDate.delete(key);
    const what = `${s.videos.length} of ${ch.videos.length} videos${s.card ? " + chapter card" : ""}${s.join ? " + join" : ""}`;
    if (dry) {
      console.log(`${key}: would make ${what}`);
      for (const x of s.videos) console.log(`    ${x.v.id}: ${x.why}`);
      for (const n of ch.notes) console.log(`    note: ${n}`);
      continue;
    }
    const log = join(ROOT, "out", key, "render-all.log");
    mkdirSync(join(ROOT, "out", key), { recursive: true });
    console.log(`[${stamp()}] ${key} (${ch.title}): ${what}; log out/${key}/render-all.log`);
    const fd = openSync(log, "a");
    writeSync(fd, `\n===== ${new Date().toISOString()} render.mjs ${key} --stale =====\n`);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(ROOT, "tools", "render.mjs"), key, "--stale"], {
      cwd: ROOT, stdio: ["ignore", fd, fd], env: { ...process.env, CONCURRENCY },
    });
    closeSync(fd);
    const minutes = (Date.now() - t0) / 60000;
    worked = true;
    if (r.status !== 0) {
      failed.add(key);
      console.log(`[${stamp()}] ${key}: FAILED after ${minutes.toFixed(1)} min (see the log)`);
      results.set(key, { ok: false, rendered: s.videos.length, minutes });
      continue;
    }
    const got = probe(ch.full);
    const prev = results.get(key);
    results.set(key, { ok: true, rendered: (prev?.rendered ?? 0) + s.videos.length, full: ch.full, length: got.frames != null ? mmss(got.frames / 30) : "?", minutes: (prev?.minutes ?? 0) + minutes });
    console.log(`[${stamp()}] ${key}: done in ${minutes.toFixed(1)} min: ${ch.full} (${results.get(key).length})`);
  }
  if (dry) break;
  if (worked) continue;
  if (waiting.length) {
    const wait = Math.min(SETTLE, Math.max(...waiting.map((w) => w.left))) + 2;
    console.log(`[${stamp()}] waiting ${Math.round(wait)} s: data still being written for ${waiting.map((w) => w.key).join(", ")}`);
    sleep(wait);
    continue;
  }
  break;
}

console.log("\nSummary");
for (const [key, r] of results) {
  console.log(r.ok
    ? `  ${key}: ${r.rendered} video(s) made in ${r.minutes.toFixed(1)} min; full chapter ${r.length}: ${r.full}`
    : `  ${key}: FAILED (out/${key}/render-all.log)`);
}
for (const key of upToDate) if (!results.has(key)) console.log(`  ${key}: up to date`);
for (const [key, errs] of notReady) console.log(`  ${key}: not ready: ${errs.slice(0, 3).join("; ")}${errs.length > 3 ? ` (+${errs.length - 3} more)` : ""}`);
const have = new Set(chapterKeys());
for (const f of readdirSync(join(ROOT, "script")).filter((n) => n.endsWith(".json")).sort()) {
  const key = f.slice(0, -5);
  if (!have.has(key) && (!only.length || only.includes(key)) && !skip.has(key)) {
    const missing = [`${key}.json`, `marks-${key}.json`].filter((n) => !existsSync(join(ROOT, "src", "data", n)));
    console.log(`  ${key}: script only, no src/data/${missing.join(" or ")} yet`);
  }
}
if (failed.size) process.exit(1);
