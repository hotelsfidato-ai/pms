import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";
import { HOTEL, go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   A HOTEL WITH NO ROOMS — FD-5, the owner's words (D17-23)

   `getStayView` answers `null`, successfully, when a hotel has no rooms.
   Rooms and Calendar read that as "still loading" and drew the skeleton
   forever. A file of its own, because the Rooms states file shares one
   query cache across its tests.
   ══════════════════════════════════════════════════════════════════ */

vi.mock("@/modules/front-desk/data/stayview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/front-desk/data/stayview")>();
  return { ...actual, getStayView: async () => null };
});

describe("Rooms at a hotel with no rooms", () => {
  it("says so in the owner's words instead of loading forever", async () => {
    startSignedIn();
    go(`/h/${HOTEL}/stay`);
    render(<App />);

    expect(await screen.findByText("No rooms set up yet")).toBeTruthy();
    expect(screen.getByText("Add them in Room types.")).toBeTruthy();
    expect(document.querySelector("[data-rooms-skeleton]")).toBeNull();
  });
});
