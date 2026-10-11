// audiocheck.mjs — is there voice in an MP4's audio? Decodes it (mono, 8 kHz
// WAV, with Remotion's own ffmpeg) and prints how much of it is speech, and the peak.
//
//   node tools/audiocheck.mjs out/a8/*.mp4

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, "out", "_audiocheck.wav");
for (const file of process.argv.slice(2)) {
  const r = spawnSync("npx", ["remotion", "ffmpeg", "-v", "error", "-y", "-i", `"${file}"`, "-vn", "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-f", "wav", `"${TMP}"`],
    { cwd: ROOT, shell: true, encoding: "utf8" });
  let wav;
  try { wav = readFileSync(TMP); } catch { console.log(`✗ ${file}: no audio decoded ${r.stderr}`); continue; }
  rmSync(TMP, { force: true });
  const at = wav.indexOf("data");
  const pcm = wav.subarray(at + 8);
  const n = Math.floor(pcm.length / 2);
  let peak = 0;
  let loud = 0;
  const win = 800; /* 0.1 s */
  const wins = Math.floor(n / win);
  for (let w = 0; w < wins; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) {
      const s = pcm.readInt16LE(i * 2) / 32768;
      sum += s * s;
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
    if (Math.sqrt(sum / win) > 0.02) loud++;
  }
  console.log(`${loud > 0 ? "✓" : "✗"} ${file}: ${(n / 8000).toFixed(1)} s of audio, speech in ${Math.round((loud / Math.max(1, wins)) * 100)}%, peak ${peak.toFixed(2)}`);
}
