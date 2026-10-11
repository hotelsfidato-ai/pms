import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Chapter } from "./chapters";
import { DIM, FONT, MUTED, NAVY, NAVY_2, NAVY_3, ORANGE, WHITE } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/* Rises into place: fade and a short slide, from `at` frames. */
const rise = (frame: number, at: number, dist = 26) => ({
  opacity: interpolate(frame, [at, at + 14], [0, 1], { ...clamp, easing: ease }),
  translate: `0px ${interpolate(frame, [at, at + 14], [dist, 0], { ...clamp, easing: ease })}px`,
});

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1400px 900px at 82% 12%, ${NAVY_3} 0%, ${NAVY_2} 35%, ${NAVY} 75%)`,
      fontFamily: FONT,
    }}
  >
    <div style={{ position: "absolute", right: -220, bottom: -260, width: 760, height: 760, borderRadius: "50%", border: `2px solid rgba(254,97,31,0.16)` }} />
    <div style={{ position: "absolute", right: -120, bottom: -160, width: 560, height: 560, borderRadius: "50%", border: `2px solid rgba(254,97,31,0.10)` }} />
    {children}
  </AbsoluteFill>
);

const Kicker: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => (
  <div style={{ fontSize: 34, letterSpacing: 5, fontWeight: 600, color: ORANGE, textTransform: "uppercase", ...style }}>{text}</div>
);

/* The eyebrow over every card of a chapter: "Fidato PMS · Restaurant". */
export const eyebrow = (chapterTitle: string) => `Fidato PMS · ${chapterTitle}`;

/* A long title is set smaller so that it stays on two lines (A8's longest,
   42 letters, keeps the full size). */
const TITLE_FULL = 54;

export const TitleCard: React.FC<{ chapterTitle: string; section: string; title: string; intro: string }> = ({ chapterTitle, section, title, intro }) => {
  const frame = useCurrentFrame();
  const size = title.length > TITLE_FULL ? Math.max(72, Math.round((104 * TITLE_FULL) / title.length)) : 104;
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 150, top: 0, bottom: 0, width: 10, background: ORANGE, ...rise(frame, 0, 0) }} />
      <div style={{ position: "absolute", left: 220, top: 230, width: 1500 }}>
        <Kicker text={eyebrow(chapterTitle)} style={rise(frame, 2)} />
        <div style={{ marginTop: 44, display: "flex", ...rise(frame, 6) }}>
          <div style={{ fontSize: 42, fontWeight: 700, color: ORANGE, border: `3px solid ${ORANGE}`, borderRadius: 14, padding: "4px 22px" }}>{section}</div>
        </div>
        <div style={{ marginTop: 30, fontSize: size, lineHeight: 1.06, fontWeight: 700, color: WHITE, ...rise(frame, 9) }}>{title}</div>
        <div style={{ marginTop: 46, fontSize: 42, lineHeight: 1.42, color: MUTED, maxWidth: 1420, ...rise(frame, 16) }}>{intro}</div>
      </div>
    </Backdrop>
  );
};

export const OutroCard: React.FC<{ text: string; next: string | null; chapterTitle: string }> = ({ text, next, chapterTitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 220, top: 210, width: 1480 }}>
        <Kicker text={eyebrow(chapterTitle)} style={rise(frame, 0)} />
        <div style={{ marginTop: 48, fontSize: 60, lineHeight: 1.28, fontWeight: 600, color: WHITE, ...rise(frame, 4) }}>{text}</div>
        <div style={{ marginTop: 80, height: 3, width: 240, background: ORANGE, ...rise(frame, Math.round(0.8 * fps), 0) }} />
        {next ? (
          <div style={{ marginTop: 40, ...rise(frame, Math.round(0.9 * fps)) }}>
            <div style={{ fontSize: 32, letterSpacing: 4, color: DIM, fontWeight: 600, textTransform: "uppercase" }}>Next</div>
            <div style={{ marginTop: 10, fontSize: 70, fontWeight: 700, color: WHITE }}>{next}</div>
          </div>
        ) : (
          <div style={{ marginTop: 40, fontSize: 56, fontWeight: 700, color: ORANGE, ...rise(frame, Math.round(0.9 * fps)) }}>
            End of the {chapterTitle} series
          </div>
        )}
      </div>
    </Backdrop>
  );
};

/* The list of a chapter's videos, two columns. Up to 8 rows (16 videos) and
   titles of up to 45 letters fit at full size (A8: 6 rows, 42 letters);
   more, and the list is set smaller to stay on the card. */
const LIST_ROWS = 8;
const LIST_LETTERS = 45;
const HEAD_LETTERS = 32;

export const ChapterCard: React.FC<{ ch: Chapter }> = ({ ch }) => {
  const frame = useCurrentFrame();
  const videos = ch.videos;
  const half = Math.ceil(videos.length / 2);
  const cols = [videos.slice(0, half), videos.slice(half)];
  const longest = videos.reduce((n, v) => Math.max(n, v.title.length), 0);
  const k = Math.min(1, LIST_ROWS / Math.max(1, half), LIST_LETTERS / Math.max(1, longest));
  const head = `Chapter ${ch.chapter} · ${ch.title}`;
  const headSize = head.length > HEAD_LETTERS ? Math.max(60, Math.round((96 * HEAD_LETTERS) / head.length)) : 96;
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 150, top: 0, bottom: 0, width: 10, background: ORANGE }} />
      <div style={{ position: "absolute", left: 220, top: 120, width: 1560 }}>
        <Kicker text="Fidato PMS · Tutorials" style={rise(frame, 0)} />
        <div style={{ marginTop: 26, fontSize: headSize, fontWeight: 700, color: WHITE, ...rise(frame, 5) }}>
          Chapter {ch.chapter} · {ch.title}
        </div>
        <div style={{ marginTop: 18, fontSize: 38, color: MUTED, ...rise(frame, 9) }}>
          {videos.length} short video{videos.length === 1 ? "" : "s"}
        </div>
        <div style={{ marginTop: 60 * k, display: "flex", gap: 50, width: 1640 }}>
          {cols.map((col, c) => (
            <div key={c} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 26 * k }}>
              {col.map((v, i) => (
                <div key={v.id} style={{ display: "flex", alignItems: "baseline", gap: 18 * k, whiteSpace: "nowrap", ...rise(frame, 16 + (c * half + i) * Math.min(4, Math.max(1, Math.floor(48 / videos.length))), 18) }}>
                  <div style={{ flex: `0 0 ${Math.round(118 * Math.max(k, 0.85))}px`, fontSize: 31 * k, fontWeight: 700, color: ORANGE }}>{v.section}</div>
                  <div style={{ fontSize: 33 * k, color: WHITE, fontWeight: 500 }}>{v.title}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Backdrop>
  );
};
