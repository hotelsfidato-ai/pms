import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import NightAuditPage from "@/modules/night-audit/pages/NightAudit";
import type { ClosedDay, NightAuditState } from "@/modules/night-audit/data/nightAudit";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT SCREEN

   NA-2 — the Run button sends the day the screen says it is closing.
   The server refuses a day already closed only if it is told which day
   the person meant; the half of the fix that lives here is the half
   that makes the other half work.

   D17-12 — a day already closed changes nothing and SHOWS THE RECORD
   THAT WAS MADE. D17-13 — the closed days are listed: who ran each,
   rooms posted, revenue and no-shows, with a dash where the record
   holds nothing.

   Each was run against the page before its change and seen to fail
   (night-audit CHANGELOG, 16 and 17 September).
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

/* A refusal WITH its payload. The shared test setup (`src/test/setup.ts`)
   replaces ApiError with a stub whose constructor takes no body, so
   `new ApiError(409, sentence, body)` arrives with no body at all and the
   screen cannot see the record. The real class keeps it as `this.body` —
   checked in the built bundle on 17 September — so it is attached here the
   same way. Reported to the master; the stub is core. */
const refusalWith = (status: number, message: string, body: unknown) =>
  Object.assign(new ApiError(status, message), { body });

/* Testing Library waits one second by default. On 17 September this
   file failed under a busy machine (every gate running at once) waiting
   for the Run button, and passed three times alone — a wait too short
   for the machine, not a fault in the page. */
const SLOW = { timeout: 10_000 };
/* And vitest's own limit on a test is five seconds — shorter than one of
   those waits, so the test would still be killed first. */
const TEST_LIMIT = { timeout: 30_000 };

const SHOWN = "2026-09-16";
const REFUSAL = "16 September was already closed. Reload to see today.";

const checklist: NightAuditState = {
  businessDate: SHOWN,
  nextBusinessDate: "2026-09-17",
  checks: [],
  canRun: { allowed: true },
  lastRun: "16 Sep 2026",
};

const madeByPriya: ClosedDay = {
  businessDate: SHOWN,
  ranBy: "Priya Nair",
  startedAt: "2026-09-16T17:40:00.000Z",
  completedAt: "2026-09-16T17:41:00.000Z",
  roomsPosted: 12,
  revenuePosted: 38400,
  noShows: 1,
};

/* A day closed before anybody was recorded, holding no figures at all. */
const nobodyRecorded: ClosedDay = {
  businessDate: "2026-09-10",
  ranBy: null,
  startedAt: "2026-09-10T10:31:00.000Z",
  completedAt: "2026-09-10T10:31:00.000Z",
  roomsPosted: null,
  revenuePosted: null,
  noShows: null,
};

beforeEach(() => {
  startSignedIn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Answers the screen's three calls; anything else is a fault. */
function server({ closedDays, onRun }: {
  closedDays: ClosedDay[];
  onRun?: (body: unknown) => unknown;
}) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    if (method === "GET" && path === `/api/hotels/${HOTEL}/night-audit`) {
      return checklist as never;
    }
    if (method === "GET" && path === `/api/hotels/${HOTEL}/night-audit/runs`) {
      return closedDays as never;
    }
    if (method === "POST" && path === `/api/hotels/${HOTEL}/night-audit/run` && onRun) {
      return onRun(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body) as never;
    }
    throw new ApiError(500, `Unexpected request: ${method} ${url}`);
  });
}

function renderScreen() {
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
}

describe("the Night audit screen", TEST_LIMIT, () => {
  it("sends the day it shows, and shows the record of a day already closed", async () => {
    const posted: unknown[] = [];
    server({
      closedDays: [],
      onRun: (body) => {
        posted.push(body);
        /* What the server answers a stale screen, or a second press. */
        throw refusalWith(409, REFUSAL, {
          ok: false, reason: REFUSAL, businessDate: SHOWN,
          alreadyClosed: true, record: madeByPriya,
        });
      },
    });
    renderScreen();

    const button = await screen.findByRole("button", { name: "Run night audit" }, SLOW);
    /* The day the person is looking at, in the words they read. */
    expect(document.body.textContent).toContain("closing Wednesday, 16 September 2026");

    fireEvent.click(button);

    await waitFor(() => expect(posted).toHaveLength(1), SLOW);
    expect(posted[0], "Run sent no date, so the server closes its own day")
      .toEqual({ businessDate: SHOWN });

    /* Refused in the server's words — and the record that was made. */
    expect(await screen.findByText(REFUSAL, {}, SLOW)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Nothing was run again.");
    expect(text).toContain("Ran by Priya Nair");
    expect(text).toContain("rooms posted 12");
    expect(text).toMatch(/room revenue ₹\s?38,400/);
    expect(text).toContain("no-shows 1");
  });

  it("lists the closed days, with a dash where the record holds nothing", async () => {
    server({ closedDays: [madeByPriya, nobodyRecorded] });
    renderScreen();

    expect(await screen.findByText("Closed days", {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Priya Nair").length).toBeGreaterThan(0), SLOW);

    const text = document.body.textContent ?? "";
    expect(text).toContain("16 Sep 2026");
    expect(text).toContain("10 Sep 2026");
    expect(text).toMatch(/₹\s?38,400/);

    /* The older day recorded nobody and no figures: dashes, never a
       name or a zero. Rows are drawn as a table and, for phones, as
       cards, so each row's cells appear twice in the document. */
    const rows = Array.from(document.querySelectorAll("tr"))
      .filter((tr) => tr.textContent?.includes("10 Sep 2026"));
    expect(rows.length, "no table row for 10 Sep").toBeGreaterThan(0);
    const cells = Array.from(rows[0]!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells).toEqual(["10 Sep 2026", "-", expect.any(String), "-", "-", "-"]);
  });

  it("says what belongs in the list when no day has been closed", async () => {
    server({ closedDays: [] });
    renderScreen();
    expect(await screen.findByText("No day closed yet", {}, SLOW)).toBeTruthy();
  });
});
