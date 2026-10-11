import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { captionPages } from "./timeline";
import { FONT, ORANGE, WHITE } from "./theme";

/* The spoken words at the bottom: white on a dark bar, at most two lines,
   each page shown for its share of the voice. Frame 0 = the voice starts. */
export const Caption: React.FC<{ text: string; durFrames: number }> = ({ text, durFrames }) => {
  const frame = useCurrentFrame();
  const pages = useMemo(() => captionPages(text), [text]);
  const p = frame / Math.max(1, durFrames);
  let idx = 0;
  for (let i = 0; i < pages.length; i++) if (pages[i].start <= p) idx = i;
  const page = pages[idx];
  const pageFrom = page.start * durFrames;
  const opacity = interpolate(frame - pageFrom, [0, 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const barIn = interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 34, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1720,
          background: "rgba(7, 13, 24, 0.88)",
          borderRadius: 20,
          borderBottom: `5px solid ${ORANGE}`,
          padding: "18px 46px 20px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
          opacity: barIn,
          translate: `0px ${interpolate(barIn, [0, 1], [16, 0])}px`,
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            color: WHITE,
            fontSize: 46,
            lineHeight: 1.3,
            fontWeight: 500,
            textAlign: "center",
            opacity,
          }}
        >
          {page.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
