import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import GroupPanelPage from "@/modules/reservations/pages/GroupPanel";
import type { GroupDetail, GroupRoom } from "@/modules/reservations/data/groups";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP PANEL'S LEAD BUTTON SENDS THE RIGHT REQUEST (D22-52)

   The room booked first leads until the desk picks another; the lead's
   guest gets the group's one confirmation and its one review request. The
   server's half is api/test (the lead route); this is the button's: one
   POST to this group's lead, naming the room pressed.
   ══════════════════════════════════════════════════════════════════ */

const room = (reservationId: string, guest: string, number: string): GroupRoom => ({
  reservationId, reference: `FH-${number}`, guest, room: number, roomType: "Deluxe",
  checkIn: "2026-08-25", checkOut: "2026-08-27", nights: 2, status: "confirmed",
  agreedRate: 3000, routed: false, balance: 0, adults: 2, children: 0,
});

const GROUP: GroupDetail = {
  id: "grp-1", name: "Sharma Wedding", blockCode: null, company: null, notes: null,
  leadId: "res-a",
  rooms: [room("res-a", "Asha Sharma", "201"), room("res-b", "Ravi Sharma", "202")],
  master: null, guestBalance: 0,
};

const posted: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true } as never;
    }
    return GROUP as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the group panel's lead", () => {
  it("makes the pressed room the lead: one POST to this group's lead, naming that room", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/h/5EL/groups/grp-1"]}>
          <Routes><Route path="/h/:code/groups/:id" element={<GroupPanelPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    /* The lead already leads, so its own button is not offered. */
    expect((await screen.findByRole("button", { name: "Asha Sharma leads the group" }))
      .hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ravi Sharma leads the group" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      path: "/api/hotels/5EL/groups/grp-1/lead",
      body: { reservationId: "res-b" },
    });
  });
});
