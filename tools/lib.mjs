// lib.mjs — what render.mjs, render-all.mjs and stills.mjs share: which
// chapters have their data, whether a chapter can be made, each video's frames
// (a copy of src/timeline.ts's plan(): change both together), one bundle per
// run, and the stamps that say what an MP4 was made from.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "src", "data");
export const PUBLIC = join(ROOT, "public");
export const OUT_ROOT = join(ROOT, "out");
export const FPS = 30;
export const sec = (s) => Math.round(s * FPS);

/** "Restaurant" -> "restaurant", for file names. */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** a0, a2 … a9, a10 … (letters, then the number). */
export function order(a, b) {
  const pa = a.match(/^([a-z]*)(\d*)(.*)$/);
  const pb = b.match(/^([a-z]*)(\d*)(.*)$/);
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  const na = pa[2] === "" ? -1 : Number(pa[2]);
  const nb = pb[2] === "" ? -1 : Number(pb[2]);
  if (na !== nb) return na - nb;
  return pa[3] < pb[3] ? -1 : pa[3] > pb[3] ? 1 : 0;
}

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/** Every chapter with both src/data/<ch>.json and src/data/marks-<ch>.json. */
export function chapterKeys() {
  const names = new Set(readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
  return [...names].filter((n) => !n.startsWith("marks-") && !n.startsWith("rec-") && names.has(`marks-${n}`)).sort(order);
}

/** The chapter's data files, and when the newest of them was written. */
export function dataFiles(key) {
  return [join(DATA, `${key}.json`), join(DATA, `marks-${key}.json`), join(DATA, `rec-${key}.json`)].filter((f) => existsSync(f));
}
export const dataTime = (key) => Math.max(...dataFiles(key).map(mtime));

/** Every chapter's pictures (a scene may show another chapter's picture). */
function allMarks() {
  const out = [];
  for (const f of readdirSync(DATA).filter((n) => /^marks-.+\.json$/.test(n))) {
    try { out.push({ key: f.slice(6, -5), marks: readJson(join(DATA, f)) }); } catch { /* being written */ }
  }
  return out.sort((a, b) => order(a.key, b.key));
}

/** "Watch it done" only when every recording the video names is in rec-<ch>.json. */
export const hasRecording = (v, rec) =>
  !!v.record && v.record.shots.length > 0 && v.record.shots.every((s) => !!rec[s] && rec[s].frames.length > 0);

/** Each part of a video, in frames: the same sums as plan() in src/timeline.ts. */
export function planFrames(v, rec) {
  let at = 0;
  const title = { from: at, dur: sec(0.5 + v.intro.dur + 0.8) };
  at += title.dur;
  let record = null;
  if (hasRecording(v, rec)) {
    let s = 0;
    for (const shot of v.record.shots) s += rec[shot].dur;
    const rate = s > 25 ? s / 25 : 1;
    const shown = s / rate;
    const body = Math.max(0.35 + shown, 0.45 + v.record.line.dur) + 0.6;
    record = { from: at, dur: sec(body) };
    at += record.dur;
  }
  const scenes = [];
  for (const sc of v.scenes) {
    const dur = sec(sc.line.dur + 0.4);
    scenes.push({ ...sc, from: at, dur });
    at += dur;
  }
  let checklist = null;
  if (v.checklist && v.checklist.length) {
    const from = at;
    let t = sec(0.9);
    for (const l of v.checklist) t += sec(l.dur + 0.4);
    checklist = { from, dur: t + sec(1.2), inner: t };
    at += checklist.dur;
  }
  const outro = { from: at, dur: sec(0.4 + v.outro.dur + 2.0) };
  at += outro.dur;
  return { title, record, scenes, checklist, outro, total: at };
}

/** A chapter read from src/data, with what is wrong (errors) or worth knowing (notes). */
export function loadChapter(key) {
  const errors = [];
  const notes = [];
  let data = null;
  let marks = null;
  let rec = {};
  try { data = readJson(join(DATA, `${key}.json`)); } catch (e) { errors.push(`src/data/${key}.json: ${e.message}`); }
  try { marks = readJson(join(DATA, `marks-${key}.json`)); } catch (e) { errors.push(`src/data/marks-${key}.json: ${e.message}`); }
  const recFile = join(DATA, `rec-${key}.json`);
  if (existsSync(recFile)) { try { rec = readJson(recFile); } catch (e) { errors.push(`src/data/rec-${key}.json: ${e.message}`); } }
  const ch = { key, CH: key.toUpperCase(), data, marks, rec, errors, notes, out: join(OUT_ROOT, key) };
  if (errors.length) return ch;
  if (typeof data.title !== "string" || !Array.isArray(data.videos) || !data.videos.length) {
    errors.push(`src/data/${key}.json has no title or no videos`);
    return ch;
  }
  ch.title = data.title;
  ch.full = join(ch.out, `${ch.CH}-${slug(data.title)}-full-chapter.mp4`);
  ch.card = join(ch.out, "parts", `${ch.CH}-00-chapter-card.mp4`);
  const others = allMarks();
  const order2 = [...others.filter((m) => m.key === key), ...others.filter((m) => m.key !== key)];
  if (!order2.some((m) => m.key === key)) order2.unshift({ key, marks });
  ch.pictureOf = (shot) => {
    for (const m of order2) {
      const pic = m.marks[shot];
      if (pic && typeof pic.w === "number") return { pic, file: join(PUBLIC, m.key, "shots", `${shot}.png`), owner: m.key };
    }
    return null;
  };
  const lineOk = (l) => l && typeof l.text === "string" && typeof l.voice === "string" && typeof l.dur === "number";
  const ids = new Set();
  for (const v of data.videos) {
    const where = v.id ?? "?";
    if (!v.id || !v.slug || !v.title || !lineOk(v.intro) || !lineOk(v.outro) || !Array.isArray(v.scenes)) { errors.push(`${where}: incomplete (id, slug, title, intro, outro, scenes)`); continue; }
    if (ids.has(v.id)) errors.push(`${v.id}: used twice`);
    ids.add(v.id);
    v.checklist = v.checklist ?? [];
    v.record = v.record ?? null;
    const lines = [v.intro, ...v.scenes.map((s) => s.line), ...v.checklist, v.outro];
    if (v.record) {
      if (hasRecording(v, rec)) {
        lines.push(v.record.line);
        for (const shot of v.record.shots) {
          const fr = rec[shot].frames;
          for (const f of [fr[0], fr[fr.length - 1]]) if (!existsSync(join(PUBLIC, f.file))) errors.push(`${v.id}: recording frame ${f.file} missing`);
        }
      } else {
        notes.push(`${v.id}: no "Watch it done" (recordings ${v.record.shots.join(", ")} not in rec-${key}.json): a picture tour`);
      }
    }
    for (const l of lines) {
      if (!lineOk(l)) { errors.push(`${v.id}: a line without its sound`); continue; }
      const f = join(PUBLIC, l.voice);
      if (!existsSync(f) || statSync(f).size < 100) errors.push(`${v.id}: voice ${l.voice} missing`);
    }
    for (const s of v.scenes) {
      const p = ch.pictureOf(s.shot);
      if (!p) { errors.push(`${v.id}: picture ${s.shot} is in no marks-*.json`); continue; }
      if (!existsSync(p.file)) { errors.push(`${v.id}: picture public/${p.owner}/shots/${s.shot}.png missing`); continue; }
      if (p.owner !== key) notes.push(`${v.id}: picture ${s.shot} is chapter ${p.owner}'s`);
      if (s.focus != null && !(p.pic.marks ?? {})[String(s.focus)]) notes.push(`${v.id}: ${s.shot} arrow ${s.focus} not found by marks.mjs: the scene shows the whole picture`);
    }
    if (!v.scenes.length) notes.push(`${v.id}: no scenes`);
  }
  ch.videos = data.videos;
  return ch;
}

/* ── Stamps: what each MP4 was made from ───────────────────────────────── */
const hashCache = new Map();
function fileHash(f) {
  if (!existsSync(f)) return "missing";
  const st = statSync(f);
  const k = `${f}|${st.size}|${st.mtimeMs}`;
  if (!hashCache.has(k)) hashCache.set(k, createHash("sha1").update(readFileSync(f)).digest("hex").slice(0, 16));
  return hashCache.get(k);
}
/** The files a video is made from: its voice and its pictures. */
export function videoInputs(ch, v) {
  const lines = [v.intro, ...v.scenes.map((s) => s.line), ...v.checklist, v.outro];
  if (hasRecording(v, ch.rec)) lines.push(v.record.line);
  const files = lines.map((l) => join(PUBLIC, l.voice));
  for (const s of v.scenes) { const p = ch.pictureOf(s.shot); if (p) files.push(p.file); }
  return [...new Set(files)];
}
/** Everything a task video depends on, as one hash: its lines, its pictures'
    sizes and arrows, its recordings, the sound and picture files themselves. */
export function videoStamp(ch, v) {
  const pics = {};
  for (const s of v.scenes) { const p = ch.pictureOf(s.shot); pics[s.shot] = p ? p.pic : null; }
  const recs = hasRecording(v, ch.rec) ? v.record.shots.map((s) => [s, ch.rec[s].dur, ch.rec[s].w, ch.rec[s].h, ch.rec[s].frames]) : null;
  const files = videoInputs(ch, v).map((f) => [f.slice(ROOT.length).replace(/\\/g, "/"), fileHash(f)]);
  return createHash("sha1").update(JSON.stringify({ chapter: ch.title, v, pics, recs, files })).digest("hex").slice(0, 20);
}
export const cardStamp = (ch) =>
  createHash("sha1").update(JSON.stringify({ chapter: ch.data.chapter, title: ch.title, videos: ch.videos.map((v) => [v.id, v.section, v.title]) })).digest("hex").slice(0, 20);

const stampFile = (ch) => join(ch.out, "parts", "stamps.json");
export function readStamps(ch) { try { return readJson(stampFile(ch)); } catch { return {}; } }
export function writeStamp(ch, name, value) {
  const s = readStamps(ch);
  s[name] = value;
  mkdirSync(join(ch.out, "parts"), { recursive: true });
  writeFileSync(stampFile(ch), JSON.stringify(s, null, 1));
}

/** Which MP4s are missing or no longer match their data. An MP4 made before
    stamps existed (A8's) counts as current unless one of its own sound or
    picture files is newer than it; it is then stamped as it is. */
export function staleness(ch) {
  const stamps = readStamps(ch);
  const adopt = {};
  const videos = [];
  for (const v of ch.videos) {
    const mp4 = join(ch.out, `${v.slug}.mp4`);
    const now = videoStamp(ch, v);
    if (!existsSync(mp4)) { videos.push({ v, why: "missing" }); continue; }
    if (stamps[v.id]) { if (stamps[v.id] !== now) videos.push({ v, why: "data changed" }); continue; }
    const t = mtime(mp4);
    const newer = videoInputs(ch, v).filter((f) => mtime(f) > t);
    if (newer.length) videos.push({ v, why: `older than ${newer.length} of its files` });
    else adopt[v.id] = now;
  }
  let card = null;
  const nowCard = cardStamp(ch);
  if (!existsSync(ch.card)) card = "missing";
  else if (stamps.card && stamps.card !== nowCard) card = "data changed";
  else if (!stamps.card) adopt.card = nowCard;
  const parts = [ch.card, ...ch.videos.map((v) => join(ch.out, `${v.slug}.mp4`))];
  const join_ = !existsSync(ch.full) || parts.some((p) => mtime(p) > mtime(ch.full));
  return { videos, card, join: join_, adopt };
}

/* ── Running ───────────────────────────────────────────────────────────── */
export function npx(args, opts = {}) {
  if (!opts.quiet) console.log(`\n> npx ${args.join(" ")}`);
  return spawnSync("npx", args, { cwd: ROOT, stdio: opts.capture ? "pipe" : "inherit", shell: true, encoding: "utf8" });
}
export const q = (p) => `"${p}"`;

/** One bundle of the compositions for a whole run (each render then starts
    at once instead of bundling and copying public/ again). */
export function bundle(label) {
  const dir = join(ROOT, ".bundle", label);
  for (let attempt = 1; attempt <= 2; attempt++) {
    rmSync(dir, { recursive: true, force: true });
    const r = npx(["remotion", "bundle", "src/index.ts", "--out-dir", q(dir), "--log=warn"]);
    if (r.status === 0 && existsSync(join(dir, "index.html"))) return dir;
    console.log(`  bundle failed (${r.status})${attempt === 1 ? ", trying once more in 10 s (a data file may have been mid-write)" : ""}`);
    if (attempt === 1) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
  }
  return null;
}
export const dropBundle = (dir) => { if (dir) rmSync(dir, { recursive: true, force: true }); };

/** Frames of video and seconds of sound in an MP4. */
export function probe(file) {
  const r = npx(["remotion", "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,nb_frames,duration", "-of", "compact", q(file)], { capture: true, quiet: true });
  const streams = `${r.stdout ?? ""}`.split(/\r?\n/).filter((l) => l.startsWith("stream|")).map((l) =>
    Object.fromEntries(l.split("|").slice(1).map((kv) => kv.split("="))));
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  return { frames: video ? Number(video.nb_frames) : null, audio: audio ? Number(audio.duration) : null };
}

export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
