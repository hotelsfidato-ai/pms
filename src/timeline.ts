// Every video's timeline, in frames, worked out from the voice lengths
// (src/data/<ch>.json) and the recordings (src/data/rec-<ch>.json); the
// chapters themselves are read in chapters.ts. Root.tsx uses it for each
// composition's length; TaskVideo.tsx uses it to place each part.
// tools/lib.mjs (frames for stills, and the render checks) mirrors plan() by
// hand: change both together.
import { FPS } from "./theme";

export type Line = { text: string; voice: string; dur: number };
export type Scene = { shot: string; focus: number | null; line: Line };
export type Video = {
  id: string;
  slug: string;
  section: string;
  title: string;
  intro: Line;
  record: { shots: string[]; line: Line } | null;
  scenes: Scene[];
  checklist: Line[];
  outro: Line;
  next: string | null;
};
export type Mark = { x: number; y: number; dx: number; dy: number };
export type Picture = { w: number; h: number; marks: Record<string, Mark> };
export type RecShot = { w: number; h: number; dur: number; frames: { file: string; t: number }[] };

export const sec = (s: number) => Math.round(s * FPS);

/* ── Lengths (seconds) ─────────────────────────────────────────────── */
export const TITLE_LEAD = 0.5;
const TITLE_TAIL = 0.8;
export const REC_LEAD = 0.35; /* the recording starts after the segment fades in */
export const REC_VOICE_AT = 0.45;
const REC_TAIL = 0.6;
const REC_CAP = 25; /* longest "Watch it done", sped up beyond this */
export const SCENE_PAD = 0.4;
export const CHECK_LEAD = 0.9;
const CHECK_TAIL = 1.2;
export const OUTRO_LEAD = 0.4;
const OUTRO_TAIL = 2.0;
export const CHAPTER_CARD = 7;

export type RecClip = { shot: string; start: number; dur: number; frames: RecShot["frames"] }; /* seconds of source */
export type RecPlan = { from: number; dur: number; rate: number; clips: RecClip[]; srcDur: number; line: Line };
export type ScenePlan = Scene & { from: number; dur: number };
export type CheckPlan = { from: number; dur: number; items: (Line & { from: number; dur: number })[] };
export type Plan = {
  title: { from: number; dur: number };
  record: RecPlan | null;
  scenes: ScenePlan[];
  scenesFrom: number;
  scenesDur: number;
  checklist: CheckPlan | null;
  outro: { from: number; dur: number };
  total: number;
};

/* "Watch it done" only when the video names recordings and every one of them
   is in the chapter's rec-<ch>.json; otherwise the video is a picture tour. */
export const hasRecording = (v: Video, rec: Record<string, RecShot>): boolean =>
  !!v.record && v.record.shots.length > 0 && v.record.shots.every((s) => !!rec[s] && rec[s].frames.length > 0);

export function plan(v: Video, rec: Record<string, RecShot>): Plan {
  let at = 0;
  const title = { from: at, dur: sec(TITLE_LEAD + v.intro.dur + TITLE_TAIL) };
  at += title.dur;

  let record: RecPlan | null = null;
  if (v.record && hasRecording(v, rec)) {
    const clips: RecClip[] = [];
    let s = 0;
    for (const shot of v.record.shots) {
      const r = rec[shot];
      clips.push({ shot, start: s, dur: r.dur, frames: r.frames });
      s += r.dur;
    }
    const rate = s > REC_CAP ? s / REC_CAP : 1;
    const shown = s / rate;
    const body = Math.max(REC_LEAD + shown, REC_VOICE_AT + v.record.line.dur) + REC_TAIL;
    record = { from: at, dur: sec(body), rate, clips, srcDur: s, line: v.record.line };
    at += record.dur;
  }

  const scenesFrom = at;
  const scenes: ScenePlan[] = [];
  for (const sc of v.scenes) {
    const dur = sec(sc.line.dur + SCENE_PAD);
    scenes.push({ ...sc, from: at - scenesFrom, dur });
    at += dur;
  }
  const scenesDur = at - scenesFrom;

  let checklist: CheckPlan | null = null;
  if (v.checklist && v.checklist.length) {
    const from = at;
    let t = sec(CHECK_LEAD);
    const items = v.checklist.map((l) => {
      const it = { ...l, from: t, dur: sec(l.dur + SCENE_PAD) };
      t += it.dur;
      return it;
    });
    checklist = { from, dur: t + sec(CHECK_TAIL), items };
    at += checklist.dur;
  }

  const outro = { from: at, dur: sec(OUTRO_LEAD + v.outro.dur + OUTRO_TAIL) };
  at += outro.dur;
  return { title, record, scenes, scenesFrom, scenesDur, checklist, outro, total: at };
}

/* ── Captions: at most two lines on screen, timed by their share of words ── */
export const CAPTION_MAX = 112;

function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  /* At a comma, colon or semicolon nearest the middle, else at a space. */
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length - 1; i++) {
    if ((s[i] === "," || s[i] === ":" || s[i] === ";") && s[i + 1] === " ") {
      if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
  }
  if (best < 0) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
  }
  if (best < 0) return [s];
  const a = s.slice(0, best + 1).trim();
  const b = s.slice(best + 1).trim();
  return [...splitLong(a, max), ...splitLong(b, max)];
}

export function captionPages(text: string, max = CAPTION_MAX): { text: string; start: number }[] {
  const sentences = (text.match(/[^.!?]+[.!?]+["')]?(\s+|$)|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const s of sentences) parts.push(...splitLong(s, max));
  const pages: string[] = [];
  for (const p of parts) {
    const last = pages.length - 1;
    if (last >= 0 && pages[last].length + 1 + p.length <= max) pages[last] = `${pages[last]} ${p}`;
    else pages.push(p);
  }
  const total = pages.reduce((n, p) => n + p.length, 0) || 1;
  let acc = 0;
  return pages.map((p) => {
    const start = acc / total;
    acc += p.length;
    return { text: p, start };
  });
}
