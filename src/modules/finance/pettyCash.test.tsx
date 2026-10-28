import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import CashieringPage from "./pages/Cashiering";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK AT THE FRONT DESK - the owner's D27-370

   A paid-out is recorded with its category (one of five, required) and,
   if taken, the photo of its bill; the list shows the category, a dash on
   one from before, and the photo to open or to add. The server's half:
   api/test/modules/finance/pettyCash.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const DRAWER = {
  businessDate: "2026-08-25", waiting: 0, colleagues: [], previous: null,
  shift: {
    id: "s1", openedAt: "2026-08-25T09:00:00Z", opening: 1000, receipts: [],
    movements: [
      { id: "m1", kind: "expense", amount: 200, reason: "Courier", recordedBy: "Test Reception", at: "10:00",
        approval: "pending", category: "Office", photo: false },
      { id: "m0", kind: "expense", amount: 90, reason: "Taxi", recordedBy: "Test Reception", at: "09:30",
        approval: null, category: null, photo: true },
    ],
    expected: 910, counted: null, variance: null, waiting: 200, varianceReason: null, denominations: [],
  },
};

type Call = { path: string; method: string; body: unknown };
let calls: Call[] = [];
let uploads: string[] = [];

beforeEach(() => {
  startSignedIn();
  calls = []; uploads = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path: url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return (method === "POST" ? { ok: true, id: "new-1" } : DRAWER) as never;
  });
  vi.spyOn(apiModule, "apiBase").mockResolvedValue("https://api.example.test");
  vi.spyOn(apiModule, "authHeaders").mockResolvedValue({});
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    uploads.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ ok: true, id: "att-1" }), { status: 200 });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/h/5EL/cashiering"]}>
        <Routes><Route path="/h/:code/cashiering" element={<CashieringPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Cashiering: a paid-out in the petty cash book (D27-370)", () => {
  it("shows each paid-out's category, a dash before it, and its photo or a way to add one", async () => {
    renderPage();
    expect(await screen.findByText("Paid out · Office · Test Reception · 10:00")).toBeTruthy();
    expect(screen.getByText("Paid out · - · Test Reception · 09:30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo of the bill" })).toBeTruthy();
  });

  it("adds a photo afterwards, through the paid-out's own door", async () => {
    renderPage();
    const input = await screen.findByLabelText("Add photo - Bill: Courier");
    fireEvent.change(input, { target: { files: [new File(["x"], "bill.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(uploads).toEqual(
      ["POST https://api.example.test/api/hotels/5EL/cashier-shift/movements/m1/photo"]));
  });

  it("will not record a paid-out until its category is chosen, then sends it with the photo", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: /Record/ }))[0]!);
    fireEvent.change(screen.getByLabelText("How much"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("What was it for"), { target: { value: "Light bulbs" } });
    const record = () => screen.getAllByRole("button", { name: "Record" }).at(-1)! as HTMLButtonElement;
    expect(record().disabled).toBe(true);
    expect([...(screen.getByLabelText("Category") as HTMLSelectElement).options].map((o) => o.value))
      .toEqual(["", "Kitchen", "Housekeeping", "Maintenance", "Office", "Other"]);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Maintenance" } });
    fireEvent.change(screen.getByLabelText("Photo of the bill"),
      { target: { files: [new File(["x"], "bill.jpg", { type: "image/jpeg" })] } });
    expect(record().disabled).toBe(false);
    fireEvent.click(record());
    await waitFor(() => expect(uploads).toEqual(
      ["POST https://api.example.test/api/hotels/5EL/cashier-shift/movements/new-1/photo"]));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      path: "/api/hotels/5EL/cashier-shift/movements", method: "POST",
      body: { kind: "expense", amount: 150, reason: "Light bulbs", category: "Maintenance" },
    });
  });

  it("asks no category of money in", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: /Record/ }))[0]!);
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "top_up" } });
    expect(screen.queryByLabelText("Category")).toBeNull();
  });
});
