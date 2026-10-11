import React from "react";
import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";
import type { Shown } from "./chapters";
import { Picture, ScenePlan, sec } from "./timeline";
import { NAVY, ORANGE } from "./theme";

/* A scene with its picture: its own size (a desk 1280x800, a wall screen
   1440x900, a phone 375x812, any other) and where it is in public/. */
export type ShownScene = ScenePlan & Shown;

/* The manual's picture, and a camera that glides to each numbered arrow. */
const ZOOM = 1.8;
const OFFSET = 70; /* picture px from the circle toward where its arrow points */
const BOX = { l: 40, t: 36, r: 1880, b: 876 }; /* the whole picture fits here */
const REGION = { w: 1920, h: 912 }; /* what the camera keeps covered: above the captions */
const GLIDE = 18; /* frames, about 0.6 s */
const XFADE = 12;

type Cam = { cx: number; cy: number; z: number };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const markOf = (sc: ShownScene) => {
  const pic = sc.pic;
  return sc.focus != null && pic && pic.marks ? pic.marks[String(sc.focus)] ?? null : null;
};
const fit = (pic: Picture): Cam => ({ cx: pic.w / 2, cy: pic.h / 2, z: 1 });
const camOf = (sc: ShownScene): Cam => {
  const pic = sc.pic;
  const m = markOf(sc);
  return m ? { cx: m.x + m.dx * OFFSET, cy: m.y + m.dy * OFFSET, z: ZOOM } : fit(pic);
};
const mix = (a: Cam, b: Cam, p: number): Cam => ({
  cx: a.cx + (b.cx - a.cx) * p,
  cy: a.cy + (b.cy - a.cy) * p,
  z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * p),
});

/* Where the picture sits on screen for a camera. `cover` is how far down the
   zoomed picture must reach: the whole frame (1080) when the arrow stays clear
   of the captions, else only the part above them (REGION.h). Every term is
   continuous, so a glide never jumps. */
function place(pic: Picture, cam: Cam, cover: number = REGION.h) {
  const s0 = Math.min((BOX.r - BOX.l) / pic.w, (BOX.b - BOX.t) / pic.h);
  const S = s0 * cam.z;
  const PW = pic.w * S;
  const PH = pic.h * S;
  let L = REGION.w / 2 - cam.cx * S;
  let T = REGION.h / 2 - cam.cy * S;
  L = PW >= REGION.w ? Math.min(0, Math.max(REGION.w - PW, L)) : (REGION.w - PW) / 2;
  const mid = (REGION.h - PH) / 2;
  T = Math.min(Math.max(0, mid), Math.max(Math.min(cover - PH, mid), T));
  return { S, L, T, PW, PH };
}

/* How far down this scene's zoom may cover: the full frame, unless that would
   put its arrow (circle and what it points at) under the caption bar. */
const CAPTION_TOP = 870;
const coverOf = (sc: ShownScene): number => {
  const m = markOf(sc);
  if (!m) return REGION.h;
  const pic = sc.pic;
  const cam = camOf(sc);
  const { S, T } = place(pic, cam, 1080);
  const low = Math.max(m.y * S + T + 15 * S + 14, cam.cy * S + T + 24);
  return low <= CAPTION_TOP ? 1080 : REGION.h;
};

const PictureAt: React.FC<{ sc: ShownScene; cam: Cam; cover: number; opacity?: number }> = ({ sc, cam, cover, opacity = 1 }) => {
  const { L, T, PW, PH } = place(sc.pic, cam, cover);
  return (
    <Img
      src={staticFile(sc.src)}
      style={{
        position: "absolute", left: L, top: T, width: PW, height: PH, opacity,
        borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.45)", background: "#fff",
      }}
    />
  );
};

const Ring: React.FC<{ pic: Picture; cam: Cam; cover: number; mark: { x: number; y: number }; opacity: number; t: number }> = ({ pic, cam, cover, mark, opacity, t }) => {
  if (opacity <= 0) return null;
  const { S, L, T } = place(pic, cam, cover);
  const x = L + mark.x * S;
  const y = T + mark.y * S;
  const r = 15 * S + 12;
  const phase = (t % 36) / 36;
  const r2 = r * (1 + 0.85 * phase);
  return (
    <>
      <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `5px solid ${ORANGE}`, boxShadow: "0 0 18px rgba(254,97,31,0.6)", opacity }} />
      <div style={{ position: "absolute", left: x - r2, top: y - r2, width: r2 * 2, height: r2 * 2, borderRadius: "50%", border: `4px solid ${ORANGE}`, opacity: opacity * (1 - phase) * 0.85 }} />
    </>
  );
};

export const Scenes: React.FC<{ scenes: ShownScene[] }> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let i = 0;
  for (let k = 0; k < scenes.length; k++) if (scenes[k].from <= frame) i = k;
  const sc = scenes[i];
  const local = frame - sc.from;
  const prev = i > 0 ? scenes[i - 1] : null;
  const same = !!prev && prev.shot === sc.shot;
  const delay = same ? 0 : 6;
  const p = spring({ frame: local - delay, fps, config: { damping: 200 }, durationInFrames: GLIDE });
  const start = same && prev ? camOf(prev) : fit(sc.pic);
  const cam = mix(start, camOf(sc), p);
  const cover0 = same && prev ? coverOf(prev) : coverOf(sc);
  const cover = cover0 + (coverOf(sc) - cover0) * p;
  const mark = markOf(sc);
  const prevMark = same && prev ? markOf(prev) : null;
  const newPic = !!prev && !same;
  const fadeIn = newPic ? interpolate(local, [0, XFADE], [0, 1], clamp) : 1;

  return (
    <AbsoluteFill style={{ background: NAVY }}>
      {newPic && prev && local < XFADE ? <PictureAt sc={prev} cam={camOf(prev)} cover={coverOf(prev)} /> : null}
      <PictureAt sc={sc} cam={cam} cover={cover} opacity={fadeIn} />
      {prevMark && local < 8 ? (
        <Ring pic={sc.pic} cam={cam} cover={cover} mark={prevMark} opacity={interpolate(local, [0, 7], [1, 0], clamp)} t={local + 20} />
      ) : null}
      {mark ? (
        <Ring pic={sc.pic} cam={cam} cover={cover} mark={mark} opacity={interpolate(local, [delay + GLIDE - 6, delay + GLIDE + 4], [0, 1], clamp)} t={local} />
      ) : null}
      {scenes.map((s, k) => (
        <Sequence key={k} from={s.from} durationInFrames={s.dur} premountFor={fps} name={`Caption ${s.shot}${s.focus ? ` #${s.focus}` : ""}`}>
          <Caption text={s.line.text} durFrames={sec(s.line.dur)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
