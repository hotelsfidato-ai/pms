import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { OutroCard, TitleCard } from "./Cards";
import { pictureOf, videoById } from "./chapters";
import { Checklist } from "./Checklist";
import { Scenes, ShownScene } from "./Scenes";
import { WatchItDone } from "./WatchItDone";
import { Line, OUTRO_LEAD, plan, REC_VOICE_AT, sec, TITLE_LEAD } from "./timeline";
import { NAVY, ORANGE } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* Each part fades in from the navy and out to it. */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, dur - 8, dur], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const Voice: React.FC<{ line: Line; at: number }> = ({ line, at }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={at} durationInFrames={sec(line.dur) + 3} premountFor={fps} name={`Voice ${line.voice}`}>
      <Html5Audio src={staticFile(line.voice)} />
    </Sequence>
  );
};

const Progress: React.FC<{ total: number }> = ({ total }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / Math.max(1, total - 1)) * 100}%`, background: ORANGE, opacity: 0.9 }} />
  );
};

export const TaskVideo: React.FC<{ id: string }> = ({ id }) => {
  const { fps } = useVideoConfig();
  const { ch, v } = videoById(id);
  const p = plan(v, ch.rec);
  const label = `${v.section} · ${v.title}`;
  const scenes: ShownScene[] = p.scenes.map((s) => {
    const shown = pictureOf(ch.key, s.shot);
    if (!shown) throw new Error(`${id}: no picture ${s.shot}`);
    return { ...s, ...shown };
  });

  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Sequence from={p.title.from} durationInFrames={p.title.dur} premountFor={fps} name="Title">
        <Fade dur={p.title.dur}>
          <TitleCard chapterTitle={ch.title} section={v.section} title={v.title} intro={v.intro.text} />
        </Fade>
      </Sequence>
      {p.record ? (
        <Sequence from={p.record.from} durationInFrames={p.record.dur} premountFor={fps} name="Watch it done">
          <Fade dur={p.record.dur}>
            <WatchItDone plan={p.record} label={label} />
          </Fade>
        </Sequence>
      ) : null}
      {p.scenes.length ? (
        <Sequence from={p.scenesFrom} durationInFrames={p.scenesDur} premountFor={fps} name="Scenes">
          <Fade dur={p.scenesDur}>
            <Scenes scenes={scenes} />
          </Fade>
        </Sequence>
      ) : null}
      {p.checklist ? (
        <Sequence from={p.checklist.from} durationInFrames={p.checklist.dur} premountFor={fps} name="Checklist">
          <Fade dur={p.checklist.dur}>
            <Checklist plan={p.checklist} section={v.section} title={v.title} />
          </Fade>
        </Sequence>
      ) : null}
      <Sequence from={p.outro.from} durationInFrames={p.outro.dur} premountFor={fps} name="Outro">
        <Fade dur={p.outro.dur}>
          <OutroCard text={v.outro.text} next={v.next} chapterTitle={ch.title} />
        </Fade>
      </Sequence>

      <Voice line={v.intro} at={p.title.from + sec(TITLE_LEAD)} />
      {p.record ? <Voice line={p.record.line} at={p.record.from + sec(REC_VOICE_AT)} /> : null}
      {p.scenes.map((s, k) => <Voice key={`s${k}`} line={s.line} at={p.scenesFrom + s.from} />)}
      {p.checklist ? p.checklist.items.map((it, k) => <Voice key={`c${k}`} line={it} at={p.checklist!.from + it.from} />) : null}
      <Voice line={v.outro} at={p.outro.from + sec(OUTRO_LEAD)} />

      <Progress total={p.total} />
    </AbsoluteFill>
  );
};
