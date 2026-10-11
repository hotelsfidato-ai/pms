// voice.mjs — the voice-over for a chapter's videos, made on this PC by Piper
// (free, offline: tools/piper, voice en_US-lessac-medium).
//
//   node tools/voice.mjs a8
//
// Reads script/<chapter>.json, speaks every line into public/<chapter>/voice/,
// and writes src/data/<chapter>.json: each video's lines with their lengths,
// which the Remotion compositions are timed from. The words on screen are the
// script's; only the spoken copy is spelled out for the voice (KOT -> K O T).

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIPER = join(ROOT, "tools", "piper", "piper.exe");
const MODEL = join(ROOT, "tools", "piper", "voices", "en_US-lessac-medium.onnx");

const chapter = process.argv[2];
if (!chapter) { console.log("Which chapter? node tools/voice.mjs a8"); process.exit(1); }
const script = JSON.parse(readFileSync(join(ROOT, "script", `${chapter}.json`), "utf8"));

/** How the voice should say it. The screen keeps the script's words. */
export function spoken(text) {
  return text
    .replace(/\bKOTs\b/g, "K O T's")
    .replace(/\bKOT\b/g, "K O T")
    .replace(/\bUPI\b/g, "U P I")
    .replace(/\bGM\b/g, "G M")
    .replace(/\bPC\b/g, "P C")
    .replace(/\bPMS\b/g, "P M S")
    .replace(/\b([A-Z]{1,2})(\d+)\b/g, "$1 $2")
    .replace(/₹\s?([\d,]+)/g, "$1 rupees")
    .replace(/[–—]/g, ", ");
}

const slug = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Every line, in order, with where its sound goes. */
const lines = [];
const videos = script.videos.map((v, i) => {
  const dir = join(ROOT, "public", chapter, "voice", v.id);
  mkdirSync(dir, { recursive: true });
  let k = 0;
  const line = (text) => {
    if (!text) return null;
    const name = `${String(++k).padStart(2, "0")}.wav`;
    const out = { text, voice: `${chapter}/voice/${v.id}/${name}`, file: join(dir, name) };
    lines.push(out);
    return out;
  };
  return {
    id: v.id,
    slug: `${v.id}-${slug(v.title)}`,
    section: v.section,
    title: v.title,
    intro: line(v.intro),
    record: v.record ? { shots: v.record, line: line(v.recordSay) } : null,
    scenes: (v.scenes ?? []).map((s) => ({ shot: s.shot, focus: s.focus ?? null, line: line(s.say) })),
    checklist: (v.checklist ?? []).map((t) => line(t)),
    outro: line(v.outro),
    next: script.videos[i + 1]?.title ?? null,
  };
});

/* Only what changed is spoken again: each sound keeps the words it was made
   from beside it (<n>.wav.txt); the same words, the same sound. */
const fresh = lines.filter((l) => {
  try { return readFileSync(l.file + ".txt", "utf8") !== spoken(l.text) || !existsSync(l.file); }
  catch { return true; }
});
console.log(`  ${lines.length - fresh.length} lines unchanged, ${fresh.length} to speak`);

/* Piper once for what is left: one JSON line per spoken line. */
if (fresh.length) await new Promise((resolve, reject) => {
  const p = spawn(PIPER, ["--model", MODEL, "--json-input", "--length_scale", "1.06", "--sentence_silence", "0.25"],
    { cwd: dirname(PIPER), stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err += d; });
  p.on("error", reject);
  p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`piper exited ${code}\n${err.slice(-800)}`)));
  for (const l of fresh) p.stdin.write(JSON.stringify({ text: spoken(l.text), output_file: l.file }) + "\n");
  p.stdin.end();
});
for (const l of fresh) writeFileSync(l.file + ".txt", spoken(l.text));

/** A WAV's length in seconds, from its header. */
function seconds(file) {
  const b = readFileSync(file);
  let rate = 22050, block = 2, at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === "fmt ") { rate = b.readUInt32LE(at + 12); block = b.readUInt16LE(at + 20); }
    if (id === "data") return Math.min(size, b.length - at - 8) / (rate * block);
    at += 8 + size + (size % 2);
  }
  throw new Error(`no sound in ${file}`);
}

let total = 0, missing = 0;
for (const l of lines) {
  if (!existsSync(l.file) || statSync(l.file).size < 100) { missing++; continue; }
  l.dur = Math.round(seconds(l.file) * 1000) / 1000;
  total += l.dur;
  delete l.file;
}
if (missing) { console.log(`  ${missing} line(s) not spoken.`); process.exit(1); }

mkdirSync(join(ROOT, "src", "data"), { recursive: true });
writeFileSync(join(ROOT, "src", "data", `${chapter}.json`), JSON.stringify({
  chapter: script.chapter, title: script.title, manualShots: script.manualShots, videos,
}, null, 2));
console.log(`  ✓ ${lines.length} lines spoken, ${Math.round(total)} s of voice, for ${videos.length} videos (src/data/${chapter}.json)`);
