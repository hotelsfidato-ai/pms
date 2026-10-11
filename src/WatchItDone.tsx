import React from "react";
import { Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./Cards";
import { Caption } from "./Caption";
import { REC_LEAD, REC_VOICE_AT, RecClip, RecPlan, sec } from "./timeline";
import { FONT, MUTED, ORANGE, WHITE } from "./theme";

/* The browser-like window the recording plays in. A recording of another size
   (a phone, a wall screen) is fitted inside it whole, on white. */
const WIN = { w: 1184, h: 740, bar: 42, top: 78 };
const WIN_LEFT = (1920 - WIN.w) / 2;
const XFADE = 0.25; /* seconds of source, between two shots */

const frameAt = (clip: RecClip, t: number) => {
  const fr = clip.frames;
  let lo = 0;
  let hi = fr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return fr[lo].file;
};

const Shot: React.FC<{ file: string; opacity?: number }> = ({ file, opacity = 1 }) => (
  <Img
    src={staticFile(file)}
    style={{ position: "absolute", left: 0, top: 0, width: WIN.w, height: WIN.h, objectFit: "contain", background: "#fff", opacity }}
  />
);

export const WatchItDone: React.FC<{ plan: RecPlan; label: string }> = ({ plan, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = Math.max(0, frame / fps - REC_LEAD) * plan.rate;
  const tt = Math.min(t, plan.srcDur - 0.001);
  let i = 0;
  for (let k = 0; k < plan.clips.length; k++) if (plan.clips[k].start <= tt) i = k;
  const clip = plan.clips[i];
  const local = tt - clip.start;
  const prev = i > 0 ? plan.clips[i - 1] : null;
  const fadeIn = prev ? interpolate(local, [0, XFADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const chipIn = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop>
      <div
        style={{
          position: "absolute", left: WIN_LEFT, top: 18, display: "flex", alignItems: "center", gap: 14,
          background: ORANGE, color: WHITE, borderRadius: 999, padding: "8px 26px 8px 20px",
          fontFamily: FONT, fontSize: 30, fontWeight: 700, opacity: chipIn,
        }}
      >
        <svg width="22" height="24" viewBox="0 0 22 24"><path d="M2 2 L20 12 L2 22 Z" fill="#fff" /></svg>
        Watch it done
      </div>
      <div style={{ position: "absolute", right: WIN_LEFT, top: 26, fontFamily: FONT, fontSize: 30, color: MUTED, opacity: chipIn }}>
        {label}
      </div>
      <div
        style={{
          position: "absolute", left: WIN_LEFT, top: WIN.top, width: WIN.w, height: WIN.h + WIN.bar,
          borderRadius: 16, overflow: "hidden", background: "#fff",
          boxShadow: "0 24px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ height: WIN.bar, background: "#e8ecf2", display: "flex", alignItems: "center", gap: 9, padding: "0 18px", borderBottom: "1px solid #d5dbe4" }}>
          <div style={{ width: 13, height: 13, borderRadius: 7, background: "#ff5f57" }} />
          <div style={{ width: 13, height: 13, borderRadius: 7, background: "#febc2e" }} />
          <div style={{ width: 13, height: 13, borderRadius: 7, background: "#28c840" }} />
          <div
            style={{
              marginLeft: 22, flex: 1, maxWidth: 620, height: 28, borderRadius: 14, background: "#fff",
              display: "flex", alignItems: "center", padding: "0 16px", fontFamily: FONT, fontSize: 17, color: "#5b6576",
            }}
          >
            Fidato PMS
          </div>
        </div>
        <div style={{ position: "relative", width: WIN.w, height: WIN.h }}>
          {prev && fadeIn < 1 ? <Shot file={frameAt(prev, prev.dur)} /> : null}
          <Shot file={frameAt(clip, local)} opacity={fadeIn} />
        </div>
      </div>
      <Sequence from={sec(REC_VOICE_AT)} premountFor={fps}>
        <Caption text={plan.line.text} durFrames={sec(plan.line.dur)} />
      </Sequence>
    </Backdrop>
  );
};
