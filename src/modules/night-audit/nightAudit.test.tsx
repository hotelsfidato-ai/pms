import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
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
function server({ closedDays, onRun, state = checklist }: {
  closedDays: ClosedDay[];
  onRun?: (body: unknown) => unknown;
  state?: NightAuditState;
}) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    if (method === "GET" && path === `/api/hotels/${HOTEL}/night-audit`) {
      return state as never;
    }
    if (method === "GET" && path === `/api/hotels/${HOTEL}/night-audit/runs`) {
      return closedDays as never;
    }
    if (method === "GET" && path === `/api/hotels/${HOTEL}/night-audit/undos`) {
      return [] as never;
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

    /* D27-117 (QA NA-1): it asks first, naming the day, and sends nothing
       until the person says yes. It used to close the day on one click. */
    const sure = await screen.findByRole("button", { name: /^Close 16 Sep/ }, SLOW) as HTMLButtonElement;
    expect(document.body.textContent).toContain("Close Wednesday, 16 September 2026?");
    expect(posted, "the day was closed before anybody confirmed").toHaveLength(0);
    /* D27-389: the second layer - Close stays off until the box is ticked. */
    expect(sure.disabled, "Close was on before the box was ticked").toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(sure.disabled).toBe(false);
    fireEvent.click(sure);

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

  it("warns the GM inside 16 hours, and sends the reason they give", async () => {
    const posted: unknown[] = [];
    server({
      closedDays: [],
      state: {
        ...checklist, calendarDate: SHOWN, lastCompletedAt: "2026-09-16T18:06:00.000Z",
        early: { lastAt: "2026-09-16T18:06:00.000Z", lastClock: "23:36 on 16 Sep", hours: 0.1, may: "warning" },
      },
      onRun: (body) => { posted.push(body); return { ok: true, businessDate: SHOWN }; },
    });
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: "Run night audit" }, SLOW));
    const sure = await screen.findByRole("button", { name: /^Close 16 Sep/ }, SLOW) as HTMLButtonElement;
    expect(document.body.textContent).toContain("Warning: the last audit finished at 23:36 on 16 Sep, 0.1 hours ago");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(sure.disabled, "Close was on with no reason").toBe(true);
    fireEvent.change(screen.getByLabelText(/Why now/), { target: { value: "Rerun after a power cut" } });
    expect(sure.disabled).toBe(false);
    fireEvent.click(sure);
    await waitFor(() => expect(posted).toHaveLength(1), SLOW);
    expect(posted[0]).toEqual({ businessDate: SHOWN, reason: "Rerun after a power cut" });
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
    /* The last cell is Correct's: empty for the clerk these tests sign in as;
       before it Why early, empty for a day that waited its 16 hours. */
    expect(cells).toEqual(["10 Sep 2026", "-", expect.any(String), "-", "-", "-", "", ""]);
  });

  it("says what belongs in the list when no day has been closed", async () => {
    server({ closedDays: [] });
    renderScreen();
    expect(await screen.findByText("No day closed yet", {}, SLOW)).toBeTruthy();
  });

  /* D27-305: the server refuses them (roleGate CLOSE_DAY, `invoice` create),
     so the screen does not offer it. Reception, the default here, does. */
  it.each(["revenue_manager", "read_only"] as const)("does not offer Run night audit to %s", async (role) => {
    signedIn({
      scope: {
        staffId: "44444444-4444-4444-4444-444444444444", email: "x@fidato.in",
        fullName: "Test", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
      },
    });
    server({ closedDays: [] });
    renderScreen();

    expect(await screen.findByText(/Run the audit and roll to/, {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run night audit" })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   CORRECTING A CLOSED DAY (D22-18; the owner's D24-1 to D24-8)
   ══════════════════════════════════════════════════════════════════ */

const corrected: ClosedDay = { ...madeByPriya, corrections: 1, correctedRevenue: 37900 };
const july: ClosedDay = { ...nobodyRecorded, businessDate: "2026-07-31" };

const asGm = () => signedIn({
  scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "gm@fidato.in",
    fullName: "Test GM", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "gm" }],
  },
});

describe("correcting a closed day", TEST_LIMIT, () => {
  it("shows a corrected day as old → new; reception sees its corrections and no Correct", async () => {
    server({ closedDays: [corrected, nobodyRecorded] });
    renderScreen();

    await waitFor(() => expect(screen.getAllByText("Priya Nair").length).toBeGreaterThan(0), SLOW);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/₹\s?38,400 → ₹\s?37,900/);
    expect(screen.getAllByText("Corrected").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "Correct" })).toHaveLength(0);
    /* The corrected day only - the other has nothing to show. Twice per row:
       the table and the phone's card. */
    expect(screen.getAllByRole("button", { name: "Corrections" }).length).toBe(2);
  });

  it("the GM chooses a charge, and Save waits for a reason; an invoiced bill and an old day are refused on sight", async () => {
    asGm();
    const posted: unknown[] = [];
    server({ closedDays: [madeByPriya, july] });
    const plain = vi.mocked(apiModule.api).getMockImplementation()!;
    vi.mocked(apiModule.api).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `/api/hotels/${HOTEL}/night-audit/days/${SHOWN}/charges`) {
        return {
          charges: [
            { id: "71", description: "Room 204 · 1 night", kind: "room", guest: "Asha Rao",
              amount: 3000, tax: 150, invoice: null, vatBill: null },
            { id: "72", description: "Room 205 · 1 night", kind: "room", guest: "Ravi Iyer",
              amount: 3000, tax: 150, invoice: "FH/26-27/0042", vatBill: null },
          ],
          corrections: [],
        } as never;
      }
      if (url === `/api/hotels/${HOTEL}/night-audit/days/${SHOWN}/corrections`) {
        posted.push(JSON.parse(String(init?.body)));
        return { ok: true, id: "c1" } as never;
      }
      return plain(url, init);
    });
    renderScreen();

    const buttons = await screen.findAllByRole("button", { name: "Correct" }, SLOW);
    /* July is older than last month (D24-5): offered, off, with the reason. */
    expect(buttons.filter((b) => (b as HTMLButtonElement).disabled).length).toBeGreaterThan(0);
    fireEvent.click(buttons.find((b) => !(b as HTMLButtonElement).disabled)!);

    await screen.findByText("Room 204 · 1 night", {}, SLOW);
    expect(screen.getByText("This bill has tax invoice FH/26-27/0042. Issue a credit note instead.")).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.disabled)).toEqual([false, true]);

    fireEvent.click(radios[0]!);
    fireEvent.change(screen.getByLabelText(/The right figure/), { target: { value: "2500" } });
    const save = screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement;
    expect(save.disabled, "Save before a reason").toBe(true);

    fireEvent.change(screen.getByLabelText(/Why it was wrong/), { target: { value: "Corporate rate" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(posted).toEqual([
      { postingId: "71", newAmount: 2500, reason: "Corporate rate" },
    ]), SLOW);
  });

  it("lists every other charge by its kind; drinks with a VAT bill are refused on sight; their tax is kept (D25-5, D25-7, D25-9)", async () => {
    asGm();
    server({ closedDays: [madeByPriya] });
    const plain = vi.mocked(apiModule.api).getMockImplementation()!;
    vi.mocked(apiModule.api).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `/api/hotels/${HOTEL}/night-audit/days/${SHOWN}/charges`) {
        return {
          charges: [
            { id: "81", description: "Restaurant - R0012", kind: "restaurant", guest: "Asha Rao",
              amount: 400, tax: 20, invoice: null, vatBill: null },
            { id: "82", description: "Restaurant - R0012 (VAT 10%)", kind: "restaurant", guest: "Asha Rao",
              amount: 500, tax: 50, invoice: null, vatBill: "VAT/AGR/2026-27/0003" },
            { id: "83", description: "Minibar", kind: "minibar", guest: "Ravi Iyer",
              amount: 120, tax: 6, invoice: null, vatBill: null },
          ],
          corrections: [],
        } as never;
      }
      return plain(url, init);
    });
    renderScreen();

    fireEvent.click((await screen.findAllByRole("button", { name: "Correct" }, SLOW))[0]!);
    await screen.findByText("Restaurant - R0012", {}, SLOW);
    expect(screen.getAllByText("Restaurant bill · Asha Rao")).toHaveLength(2);
    expect(screen.getByText("Minibar · Ravi Iyer")).toBeTruthy();
    expect(screen.getByText("This bill has VAT bill VAT/AGR/2026-27/0003. Cancel the VAT bill instead.")).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.disabled)).toEqual([false, true, false]);

    fireEvent.click(radios[0]!);
    expect(screen.getByText("The tax stays at the rate it was charged at.")).toBeTruthy();
  });
});
