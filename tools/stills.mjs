// stills.mjs — three frames of each task video, to look at before showing anyone:
// the title card, the first scene zoomed to an arrow (or the checklist, or the
// first picture of a tour without arrows), the outro; and the chapter card.
//
//   node tools/stills.mjs a2 [ids...]          from the compositions (one bundle per run)
//   node tools/stills.mjs a2 [ids...] --mp4    from the rendered MP4s in out/a2 (what was made)
//
// Writes out/<ch>/stills/<id>-1-title.png, -2-scene.png, -3-outro.png and
// <CH>-00-chapter-card.png. The frame numbers come from planFrames() in
// lib.mjs, the copy of src/timeline.ts.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bundle, dropBundle, loadChapter, npx, planFrames, q, sec } from "./lib.mjs";

const [chapter, ...rest] = process.argv.slice(2);
if (!chapter) { console.log("Which chapter? node tools/stills.mjs a2 [ids...] [--mp4]"); process.exit(1); }
const fromMp4 = rest.includes("--mp4");
const only = rest.filter((a) => !a.startsWith("--"));
const ch = loadChapter(chapter);
if (ch.errors.length) { console.log(`Chapter ${chapter} cannot be made yet:\n  ${ch.errors.join("\n  ")}`); process.exit(1); }
const OUT = join(ch.out, "stills");
mkdirSync(OUT, { recursive: true });

function frames(v) {
  const p = planFrames(v, ch.rec);
  let scene = null;
  for (const sc of p.scenes) {
    const pic = ch.pictureOf(sc.shot)?.pic;
    if (sc.focus != null && pic?.marks?.[String(sc.focus)]) { scene = sc.from + 30; break; }
  }
  if (scene == null && p.checklist) scene = p.checklist.from + p.checklist.inner - sec(0.6);
  if (scene == null && p.scenes.length) scene = p.scenes[0].from + 30;
  return { title: 50, scene, outro: p.outro.from + sec(1.7) };
}

const todo = only.length ? ch.videos.filter((v) => only.includes(v.id)) : ch.videos;
const jobs = []; /* [composition id, mp4, frame, out png, label] */
for (const v of todo) {
  const f = frames(v);
  for (const [n, name, frame] of [[1, "title", f.title], [2, "scene", f.scene], [3, "outro", f.outro]]) {
    if (frame != null) jobs.push([v.id, join(ch.out, `${v.slug}.mp4`), frame, join(OUT, `${v.id}-${n}-${name}.png`), `${v.id} ${name}`]);
  }
}
if (!only.length) jobs.push([`${ch.CH}-ChapterCard`, ch.card, 120, join(OUT, `${ch.CH}-00-chapter-card.png`), "chapter card"]);

let dir = null;
if (!fromMp4) { dir = bundle(`stills-${chapter}`); if (!dir) process.exit(1); }
let bad = 0;
try {
  for (const [id, mp4, frame, out, label] of jobs) {
    let r;
    if (fromMp4) {
      if (!existsSync(mp4)) { console.log(`✗ ${label}: ${mp4} not rendered`); bad++; continue; }
      r = npx(["remotion", "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", (frame / 30).toFixed(3), "-i", q(mp4), "-frames:v", "1", q(out)], { capture: true, quiet: true });
    } else {
      r = npx(["remotion", "still", q(dir), id, q(out), `--frame=${frame}`], { capture: true, quiet: true });
    }
    if (r.status !== 0) bad++;
    console.log(`${r.status === 0 ? "✓" : "✗"} ${label} @${frame}${r.status === 0 ? "" : `\n${r.stderr || r.stdout}`}`);
  }
} finally {
  dropBundle(dir);
}
console.log(`\n${jobs.length - bad} stills in ${OUT}`);
if (bad) process.exit(1);
