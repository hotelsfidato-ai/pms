// render.mjs — a chapter's videos as MP4s, for any chapter with its data in
// src/data (<ch>.json from voice.mjs, marks-<ch>.json from marks.mjs, and
// rec-<ch>.json from record.mjs if it has recordings).
//
//   node tools/render.mjs a2                 every task video, the chapter card, then the full chapter
//   node tools/render.mjs a2 A2-03 A2-07     only those task videos (then the full chapter joined again)
//   node tools/render.mjs a2 --stale         only what is missing or no longer matches its data, then join
//   node tools/render.mjs a2 --join          only join the full chapter from what is already rendered
//   node tools/render.mjs a2 --card          only the chapter card again, then join
//
// Writes out/<ch>/<slug>.mp4 (one per task video), out/<ch>/parts/<CH>-00-chapter-card.mp4
// and out/<ch>/<CH>-<chapter-slug>-full-chapter.mp4.
// The compositions are bundled ONCE per run (.bundle/<ch>, removed at the end).
// Each task video: npx remotion render <bundle> <id> out/<ch>/<slug>.mp4 (H.264, AAC),
// checked afterwards: its frames must be the number the timeline planned.
// The full chapter is NOT rendered again: the chapter card is rendered on its
// own (with a silent audio track, so every part has the same streams) and the
// parts are joined with `npx remotion ffmpeg -f concat ... -c copy`.
// out/<ch>/parts/stamps.json records what each MP4 was made from (--stale reads it).
// Concurrency 4 of this PC's 8 threads by default (CONCURRENCY=3 to go gentler).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundle, cardStamp, dropBundle, loadChapter, mmss, npx, planFrames, probe, q, staleness, videoStamp, writeStamp } from "./lib.mjs";

const [chapter, ...rest] = process.argv.slice(2);
if (!chapter) { console.log("Which chapter? node tools/render.mjs a2 [ids...] [--stale|--join|--card]"); process.exit(1); }
const joinOnly = rest.includes("--join");
const cardOnly = rest.includes("--card");
const staleOnly = rest.includes("--stale");
const only = rest.filter((a) => !a.startsWith("--"));
const CONCURRENCY = process.env.CONCURRENCY ?? "4";

const ch = loadChapter(chapter);
if (ch.errors.length) {
  console.log(`Chapter ${chapter} cannot be made yet:\n  ${ch.errors.join("\n  ")}`);
  process.exit(1);
}
for (const n of ch.notes) console.log(`  note: ${n}`);
const unknown = only.filter((id) => !ch.videos.some((v) => v.id === id));
if (unknown.length) { console.log(`Not in chapter ${chapter}: ${unknown.join(", ")}`); process.exit(1); }
const OUT = ch.out;
const PARTS = join(OUT, "parts");
mkdirSync(PARTS, { recursive: true });

/* What to render. */
let todo = [];
let card = false;
let mustJoin = true;
if (staleOnly) {
  const s = staleness(ch);
  for (const [name, value] of Object.entries(s.adopt)) writeStamp(ch, name, value);
  todo = s.videos.map((x) => x.v);
  for (const x of s.videos) console.log(`  ${x.v.id}: ${x.why}`);
  card = !!s.card;
  if (s.card) console.log(`  chapter card: ${s.card}`);
  mustJoin = s.join || todo.length > 0 || card;
  if (!todo.length && !card && !mustJoin) { console.log(`Chapter ${chapter}: up to date.`); process.exit(0); }
} else if (!joinOnly) {
  todo = only.length ? ch.videos.filter((v) => only.includes(v.id)) : cardOnly ? [] : ch.videos;
  card = cardOnly || !only.length || !existsSync(ch.card);
}

const failed = [];
if (todo.length || card) {
  const dir = bundle(chapter);
  if (!dir) { console.log("Could not bundle the compositions."); process.exit(1); }
  try {
    for (const v of todo) {
      const stamp = videoStamp(ch, v);
      const out = join(OUT, `${v.slug}.mp4`);
      const r = npx(["remotion", "render", q(dir), v.id, q(out), "--codec=h264", `--concurrency=${CONCURRENCY}`]);
      if (r.status !== 0) { console.log(`  ✗ ${v.id} failed (${r.status})`); failed.push(v.id); continue; }
      const want = planFrames(v, ch.rec).total;
      const got = probe(out);
      const ok = got.frames === want && got.audio != null;
      console.log(`  ${ok ? "✓" : "✗"} ${v.id}: ${got.frames} frames (${mmss(got.frames / 30)}), planned ${want}${got.audio == null ? ", NO SOUND TRACK" : ""}`);
      if (!ok) { failed.push(v.id); continue; }
      writeStamp(ch, v.id, stamp);
    }
    if (card) {
      const stamp = cardStamp(ch);
      const r = npx(["remotion", "render", q(dir), `${ch.CH}-ChapterCard`, q(ch.card), "--codec=h264", "--enforce-audio-track", `--concurrency=${CONCURRENCY}`]);
      if (r.status !== 0) { console.log(`  ✗ chapter card failed (${r.status})`); failed.push("card"); }
      else writeStamp(ch, "card", stamp);
    }
  } finally {
    dropBundle(dir);
  }
}
if (failed.length) { console.log(`Failed: ${failed.join(", ")} (the full chapter is not joined again)`); process.exit(1); }

/* The full chapter: the card, then every task video, joined without re-encoding. */
if (mustJoin) {
  const list = [ch.card, ...ch.videos.map((v) => join(OUT, `${v.slug}.mp4`))];
  const missing = list.filter((f) => !existsSync(f));
  if (missing.length) { console.log(`Not joined, missing:\n  ${missing.join("\n  ")}`); process.exit(1); }
  const listFile = join(PARTS, "concat.txt");
  writeFileSync(listFile, list.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n") + "\n");
  const r = npx(["remotion", "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", q(listFile), "-c", "copy", "-movflags", "+faststart", q(ch.full)]);
  if (r.status !== 0) { console.log(`  ✗ join failed (${r.status})`); process.exit(1); }
  const got = probe(ch.full);
  console.log(`\nDone: ${ch.full} (${got.frames != null ? mmss(got.frames / 30) : "?"})`);
}
