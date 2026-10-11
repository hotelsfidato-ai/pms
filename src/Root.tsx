import React from "react";
import { Composition, Folder } from "remotion";
import { CHAPTERS } from "./chapters";
import { ChapterCardVideo, chapterCardFrames, chapterFrames, ChapterVideo } from "./ChapterVideo";
import { TaskVideo } from "./TaskVideo";
import { plan } from "./timeline";
import { FPS, H, W } from "./theme";

/* Every chapter whose data is in src/data (chapters.ts), in a folder of its
   own ("A8-Restaurant"): one composition per task video (A8-01 … A8-12), each
   as long as its voice and recording; the chapter card (A8-ChapterCard); and
   the whole chapter (A8-Chapter). */
const folderName = (id: string, title: string) => `${id}-${title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {CHAPTERS.map((ch) => (
        <Folder key={ch.key} name={folderName(ch.id, ch.title)}>
          {ch.videos.map((v) => (
            <Composition
              key={v.id}
              id={v.id}
              component={TaskVideo}
              durationInFrames={plan(v, ch.rec).total}
              fps={FPS}
              width={W}
              height={H}
              defaultProps={{ id: v.id }}
            />
          ))}
          <Composition
            id={`${ch.id}-ChapterCard`}
            component={ChapterCardVideo}
            durationInFrames={chapterCardFrames}
            fps={FPS}
            width={W}
            height={H}
            defaultProps={{ ch: ch.key }}
          />
          <Composition
            id={`${ch.id}-Chapter`}
            component={ChapterVideo}
            durationInFrames={chapterFrames(ch)}
            fps={FPS}
            width={W}
            height={H}
            defaultProps={{ ch: ch.key }}
          />
        </Folder>
      ))}
    </>
  );
};
