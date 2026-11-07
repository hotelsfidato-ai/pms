import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import { mayReach } from "@/components/app/navigation";
import FeedbackPage from "@/modules/reputation/pages/Feedback";

/* Guest feedback (D27-383 item 10): for the owner, an administrator and the
   GM; a part nobody scored is a dash, never a zero; a low answer is red; the
   screen says when the hotel is not asking. */

const PAGE = {
  on: false, latest: 100,
  months: [{ month: "2026-11", answers: 2, overall: 3.5, room: 3, cleanliness: null, food: 4, staff: 5, low: 1 }],
  answers: [
    { id: "f-1", answeredAt: "2026-11-07T10:00", overall: 2, room: 1, cleanliness: null, food: null, staff: 4,
      comment: "The AC was loud.", low: true, stayId: "s-1", reference: "FH-1", guest: "Kalyani Rege", roomNumber: "301" },
  ],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Guest feedback", () => {
  it("is the GM's, the owner's and an administrator's - not the desk's", () => {
    for (const role of ["owner", "admin", "gm"] as const) expect(mayReach(role, "/h/:code/feedback"), role).toBe(true);
    for (const role of ["hotel_manager", "front_desk", "finance", "read_only", "housekeeping"] as const) {
      expect(mayReach(role, "/h/:code/feedback"), role).toBe(false);
    }
  });

  it("shows the months with a dash for a part nobody scored, a low answer in red, and that it is off", async () => {
    vi.spyOn(apiModule, "api").mockResolvedValue(PAGE as never);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/h/5EL/feedback"]}>
          <Routes><Route path="/h/:code/feedback" element={<FeedbackPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>);
    expect((await screen.findAllByText("Nov 2026")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.5").length).toBeGreaterThan(0);
    /* Cleanliness that month: a dash, never 0.0. */
    expect(screen.queryAllByText("0.0")).toHaveLength(0);
    expect(screen.getAllByText("The AC was loud.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 of 5")[0]!.className).toMatch(/brand-red/);
    expect(document.querySelector("[data-feedback-off]")?.textContent).toMatch(/not asking guests for feedback/);
  });
});
