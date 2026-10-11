// Every chapter the videos can be made of, read from src/data by name:
//   src/data/<ch>.json        the lines and their lengths (tools/voice.mjs)
//   src/data/marks-<ch>.json  each picture's size and arrows (tools/marks.mjs)
//   src/data/rec-<ch>.json    the screen recordings, if any (tools/record.mjs)
// A chapter is registered when its <ch>.json AND marks-<ch>.json are there and
// every picture its scenes name can be found. Its pictures are public/<ch>/shots/,
// its voice public/<ch>/voice/ (the data's own paths).
import type { Picture, RecShot, Video } from "./timeline";

declare global {
  interface ImportMeta {
    webpackContext: (
      request: string,
      options: { recursive?: boolean; regExp?: RegExp },
    ) => { keys: () => string[]; (id: string): unknown };
  }
}

export type Chapter = {
  key: string; /* "a8": its folder in public/ and the name of its data files */
  id: string; /* "A8": the start of its composition ids (A8-ChapterCard, A8-Chapter) */
  chapter: string; /* as the data names it, for the chapter card */
  title: string; /* "Restaurant" */
  videos: Video[];
  marks: Record<string, Picture>;
  rec: Record<string, RecShot>;
};

/* Every JSON in src/data, by its name without ".json". */
const ctx = import.meta.webpackContext("./data", { recursive: false, regExp: /\.json$/ });
const FILES: Record<string, unknown> = {};
for (const k of ctx.keys()) {
  const name = k.replace(/^.*[\\/]/, "").replace(/\.json$/, "");
  if (name in FILES) continue;
  const m = ctx(k) as { __esModule?: boolean; default?: unknown };
  FILES[name] = m && m.__esModule && "default" in m ? m.default : m;
}

/* a0, a2 … a9, a10 … (letters, then the number). */
const order = (a: string, b: string) => {
  const pa = a.match(/^([a-z]*)(\d*)(.*)$/)!;
  const pb = b.match(/^([a-z]*)(\d*)(.*)$/)!;
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  const na = pa[2] === "" ? -1 : Number(pa[2]);
  const nb = pb[2] === "" ? -1 : Number(pb[2]);
  if (na !== nb) return na - nb;
  return pa[3] < pb[3] ? -1 : pa[3] > pb[3] ? 1 : 0;
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/* Every chapter's pictures, so a scene may show a picture of another chapter. */
const ALL_MARKS: { key: string; marks: Record<string, Picture> }[] = Object.keys(FILES)
  .filter((n) => n.startsWith("marks-") && isObj(FILES[n]))
  .map((n) => ({ key: n.slice("marks-".length), marks: FILES[n] as Record<string, Picture> }))
  .sort((a, b) => order(a.key, b.key));

export type Shown = { pic: Picture; src: string };

/** A scene's picture: the chapter's own first, else another chapter's. */
export function pictureOf(key: string, shot: string): Shown | null {
  const own = ALL_MARKS.filter((m) => m.key === key);
  for (const m of [...own, ...ALL_MARKS.filter((x) => x.key !== key)]) {
    const pic = m.marks[shot];
    if (isObj(pic) && typeof pic.w === "number" && typeof pic.h === "number") return { pic, src: `${m.key}/shots/${shot}.png` };
  }
  return null;
}

const lineOk = (l: unknown) => isObj(l) && typeof l.text === "string" && typeof l.voice === "string" && typeof l.dur === "number";

/* Why a chapter cannot be made yet, or null. */
function problem(key: string, data: unknown): string | null {
  if (!isObj(data) || !Array.isArray(data.videos) || typeof data.title !== "string") return "no title or videos";
  for (const v of data.videos as Video[]) {
    if (!isObj(v) || typeof v.id !== "string" || !lineOk(v.intro) || !lineOk(v.outro) || !Array.isArray(v.scenes)) return `video ${v?.id ?? "?"} incomplete`;
    for (const s of v.scenes) {
      if (!lineOk(s.line)) return `${v.id}: a scene without its line`;
      if (!pictureOf(key, s.shot)) return `${v.id}: picture ${s.shot} not in any marks-*.json`;
    }
    for (const l of v.checklist ?? []) if (!lineOk(l)) return `${v.id}: a checklist line without its sound`;
  }
  return null;
}

export const CHAPTERS: Chapter[] = [];
const seen = new Set<string>();
for (const key of Object.keys(FILES).filter((n) => !n.startsWith("marks-") && !n.startsWith("rec-")).sort(order)) {
  if (!(`marks-${key}` in FILES)) continue;
  const data = FILES[key];
  const why = problem(key, data);
  if (why) {
    console.warn(`Chapter ${key} left out: ${why}`);
    continue;
  }
  const d = data as { chapter?: string; title: string; videos: Video[] };
  const videos = d.videos.filter((v) => {
    if (seen.has(v.id)) {
      console.warn(`${key}: video id ${v.id} is already used by another chapter, left out`);
      return false;
    }
    seen.add(v.id);
    return true;
  });
  const rec = FILES[`rec-${key}`];
  CHAPTERS.push({
    key,
    id: key.toUpperCase(),
    chapter: d.chapter ?? key.toUpperCase(),
    title: d.title,
    videos: videos.map((v) => ({ ...v, checklist: v.checklist ?? [], record: v.record ?? null, next: v.next ?? null })),
    marks: FILES[`marks-${key}`] as Record<string, Picture>,
    rec: isObj(rec) ? (rec as Record<string, RecShot>) : {},
  });
}

export const chapterByKey = (key: string): Chapter => {
  const c = CHAPTERS.filter((x) => x.key === key)[0];
  if (!c) throw new Error(`No chapter ${key}`);
  return c;
};

export const videoById = (id: string): { ch: Chapter; v: Video } => {
  for (const ch of CHAPTERS) {
    const v = ch.videos.filter((x) => x.id === id)[0];
    if (v) return { ch, v };
  }
  throw new Error(`No video ${id}`);
};
