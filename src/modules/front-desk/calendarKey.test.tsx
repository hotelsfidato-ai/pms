import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { useSession } from "@/lib/session";
import type { DeskRules } from "@/lib/api";
import { HOTEL, go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE CALENDAR'S COLOUR KEY NAMES EVERY BAR COLOUR (the owner's D27-319 (1))

   A bar can be any of seven colours (BAR in pages/StayView.tsx) and the key
   above the chart named three: In house, Due out, Confirmed. And a hotel may
   choose its own colours (D27-260 Q6), which the bars wear - so the key
   wears them too, or it names a colour no bar has.
   ══════════════════════════════════════════════════════════════════ */

const key = async () =>
  (await screen.findByText("In house", { selector: "p > span" }, { timeout: 10000 })).parentElement!;

beforeEach(() => {
  startSignedIn();
  go(`/h/${HOTEL}/calendar`);
});

describe("the Calendar's colour key", () => {
  it("names all seven bar colours, in plain words", async () => {
    render(<App />);
    expect([...(await key()).children].map((c) => c.textContent)).toEqual([
      "In house", "Due out", "Confirmed", "Waiting for the hotel", "Checked out", "No show", "Cancelled",
    ]);
  });

  it("shows the hotel's own colour where it chose one", async () => {
    useSession.setState((s) => ({ hotels: s.hotels.map((h) => ({
      ...h, deskRules: { ...h.deskRules, statusColours: { "in-house": "#123456" } } as DeskRules })) }));
    render(<App />);
    const swatch = (await key()).querySelector("i") as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("rgb(18, 52, 86)");
  });
});
