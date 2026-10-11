import React from "react";
import { AbsoluteFill, interpolate, Series, useCurrentFrame, useVideoConfig } from "remotion";
import { ChapterCard } from "./Cards";
import { Chapter, chapterByKey } from "./chapters";
import { TaskVideo } from "./TaskVideo";
import { CHAPTER_CARD, plan, sec } from "./timeline";
import { NAVY } from "./theme";

export const chapterCardFrames = sec(CHAPTER_CARD);
export const chapterFrames = (ch: Chapter) => chapterCardFrames + ch.videos.reduce((n, v) => n + plan(v, ch.rec).total, 0);

/* The chapter card alone (rendered on its own and joined to the task videos). */
export const ChapterCardVideo: React.FC<{ ch: string }> = ({ ch }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <AbsoluteFill style={{ opacity }}>
        <ChapterCard ch={chapterByKey(ch)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* The whole chapter: the card, then every task video in order. The MP4 of it
   is made by joining the rendered parts (tools/render.mjs), not rendered again. */
export const ChapterVideo: React.FC<{ ch: string }> = ({ ch }) => {
  const { fps } = useVideoConfig();
  const c = chapterByKey(ch);
  return (
    <Series>
      <Series.Sequence durationInFrames={chapterCardFrames} premountFor={fps} name="Chapter card">
        <ChapterCardVideo ch={ch} />
      </Series.Sequence>
      {c.videos.map((v) => (
        <Series.Sequence key={v.id} durationInFrames={plan(v, c.rec).total} premountFor={fps} name={v.id}>
          <TaskVideo id={v.id} />
        </Series.Sequence>
      ))}
    </Series>
  );
};
