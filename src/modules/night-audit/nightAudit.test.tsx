import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import NightAuditPage from "@/modules/night-audit/pages/NightAudit";
import type { NightAuditState } from "@/modules/night-audit/data/nightAudit";

/* ══════════════════════════════════════════════════════════════════
   THE RUN BUTTON SENDS THE DAY THE SCREEN SAYS IT IS CLOSING — NA-2

   The server refuses to close a day that is already closed, but only
   if it is told which day the person meant. A button that sends no
   date is answered the old way: the server closes whatever day IT is
   on, which for a screen that did not see the day close is tomorrow.
   So the half of the fix that lives here is the half that makes the
   other half work, and this test is what keeps it. Run against the
   page before the change and seen to fail (night-audit CHANGELOG,
   16 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

const SHOWN = "2026-09-16";
const REFUSAL = "16 September was already closed. Reload to see today.";

const checklist: NightAuditState = {
  businessDate: SHOWN,
  nextBusinessDate: "2026-09-17",
  checks: [],
  canRun: { allowed: true },
  lastRun: "16 Sep 2026",
};

beforeEach(() => {
  startSignedIn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Night audit screen", () => {
  it("sends the day it shows, and shows the server's refusal", async () => {
    const posted: Array<{ path: string; body: unknown }> = [];

    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.split("?")[0]!;
      if (path === `/api/hotels/${HOTEL}/night-audit` && !init?.method) {
        return checklist as never;
      }
      if (path === `/api/hotels/${HOTEL}/night-audit/run` && init?.method === "POST") {
        posted.push({
          path,
          body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
        });
        /* What the server answers a stale screen. */
        throw new ApiError(409, REFUSAL, { ok: false, reason: REFUSAL, businessDate: SHOWN });
      }
      throw new ApiError(500, `Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/h/${HOTEL}/night-audit`]}>
          <Routes>
            <Route path="/h/:code/night-audit" element={<NightAuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const button = await screen.findByRole("button", { name: "Run night audit" });
    /* The day the person is looking at, in the words they read. */
    expect(document.body.textContent).toContain("closing Wednesday, 16 September 2026");

    fireEvent.click(button);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body, "Run sent no date, so the server closes its own day")
      .toEqual({ businessDate: SHOWN });

    /* Refused, and said so — the server's own sentence, not a status code. */
    expect(await screen.findByText(REFUSAL)).toBeTruthy();
  });
});
