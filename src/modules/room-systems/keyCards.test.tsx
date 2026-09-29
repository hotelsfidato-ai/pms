import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { KeyCards } from "@/modules/room-systems";
import { keysKey, type StayKeys } from "@/modules/room-systems/data/keys";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE KEY-CARD PANEL (D27-178)

   Nothing at all where no lock system is connected and no card was ever
   cut; cards that stop before the stay ends say so; cutting sends how many
   and nothing about the room (the server decides it); a lock's refusal is
   shown in its own words.
   ══════════════════════════════════════════════════════════════════ */

let answer: StayKeys;
const posted: unknown[] = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, answer: "Stand-in: 2 cards for room 101." } as never;
    }
    return answer as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stay = { id: "stay-1", adults: 2 } as Stay;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><KeyCards hotelId="5EL" stay={stay} /></QueryClientProvider>);
  return qc;
}

describe("the key-card panel", () => {
  it("draws nothing where no lock is connected and no card was cut", async () => {
    answer = { connected: false, maxCards: 4, stayEnds: "2026-10-02T06:30:00Z", live: null, acts: [] };
    const qc = show();
    /* After the answer has arrived: before it, nothing is drawn anyway. */
    await waitFor(() => expect(qc.getQueryData(keysKey("5EL", "stay-1"))).toBeTruthy());
    expect(screen.queryByText("Key cards")).toBeNull();
  });

  it("warns when the cards stop before the stay ends, cuts by count only, and shows a refusal", async () => {
    answer = {
      connected: true, maxCards: 4,
      stayEnds: "2026-10-03T06:30:00Z",
      live: { room: "101", cards: 2, validUntil: "2026-10-02T06:30:00Z" },
      acts: [
        { act: "issue", why: "reissue", cards: 1, validUntil: "2026-10-03T06:30:00Z", room: "101",
          outcome: "failed", answer: "Encoder not answering", by: "Priya", at: "2026-09-30T14:00:00Z" },
        { act: "issue", why: "check_in", cards: 2, validUntil: "2026-10-02T06:30:00Z", room: "101",
          outcome: "done", answer: "ok", by: "Priya", at: "2026-09-30T08:00:00Z" },
      ],
    };
    show();
    expect(await screen.findByText(/They stop before the stay ends/)).toBeTruthy();
    expect(screen.getByText(/Encoder not answering/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cut new cards" }));
    await waitFor(() => expect(posted).toEqual([{ cards: 2, lost: false }]));
  });
});
