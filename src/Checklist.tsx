import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "./Cards";
import { CheckPlan } from "./timeline";
import { DIM, MUTED, NAVY_3, ORANGE, WHITE } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/* The shift in short: each line appears as the voice reads it. */
export const Checklist: React.FC<{ plan: CheckPlan; section: string; title: string }> = ({ plan, section, title }) => {
  const frame = useCurrentFrame();
  let current = -1;
  plan.items.forEach((it, k) => { if (it.from <= frame) current = k; });
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 200, top: 70, width: 1520 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 26, opacity: interpolate(frame, [0, 12], [0, 1], clamp) }}>
          <div style={{ fontSize: 38, fontWeight: 700, color: ORANGE }}>{section}</div>
          <div style={{ fontSize: 62, fontWeight: 700, color: WHITE }}>{title}</div>
        </div>
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 16 }}>
          {plan.items.map((it, k) => {
            const local = frame - it.from;
            if (local < 0) return null;
            const isNow = k === current;
            const [head, ...rest] = it.text.split(": ");
            const body = rest.join(": ");
            return (
              <div
                key={k}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 26,
                  opacity: interpolate(local, [0, 10], [0, 1], { ...clamp, easing: ease }),
                  translate: `${interpolate(local, [0, 10], [30, 0], { ...clamp, easing: ease })}px 0px`,
                }}
              >
                <div
                  style={{
                    flex: "0 0 auto", width: 52, height: 52, borderRadius: 26, marginTop: 1,
                    background: isNow ? ORANGE : NAVY_3, color: WHITE, display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700,
                  }}
                >
                  {isNow ? k + 1 : (
                    <svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 13.5 L10.5 19 L21 7.5" stroke={ORANGE} strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </div>
                <div style={{ fontSize: 38, lineHeight: 1.32, color: isNow ? WHITE : MUTED }}>
                  {body ? (
                    <>
                      <span style={{ fontWeight: 700, color: isNow ? ORANGE : DIM }}>{head}:</span> {body}
                    </>
                  ) : head}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Backdrop>
  );
};
