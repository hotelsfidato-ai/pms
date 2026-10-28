import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { DayEnd } from "@/modules/pos/data/till";
import DayEndPage from "@/modules/pos/pages/DayEnd";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK IN THE RESTAURANT - the owner's D27-370

   Close restaurant day › Cash › Record › Expense: a category of five,
   required, and the photo of the bill, optional - the desk's two fields,
   one copy (finance's front door). The server's half:
   api/test/modules/finance/pettyCash.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const DAY: DayEnd = {
  outlet: { code: "REST", name: "Fidato Restaurant" }, businessDate: "2026-08-25",
  summary: { settledOrders: 0, settledValue: 0, abandonedOrders: 0, abandonedValue: 0,
             compOrders: 0, discountGiven: 0, byMethod: {} },
  blockers: [], struck: [],
  movements: [{ id: "p1", kind: "expense", amount: 300, reason: "Vegetables", recordedBy: "Chef", at: "11:00",
                approval: "pending", category: "Kitchen", photo: false }],
  cash: { opening: 1000, expected: 1000, counted: null, variance: null, waiting: 300,
          varianceReason: null, denominations: [] },
  opened: true, closedAt: null, closedBy: null,
};

let posts: { path: string; body: unknown }[] = [];
let uploads: string[] = [];

beforeEach(() => {
  startSignedIn();
  posts = []; uploads = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ path: url, body: JSON.parse(String(init.body)) });
      return { ok: true, id: "new-2" } as never;
    }
    if (url.startsWith(`/api/hotels/${HOTEL}/till/day-end`)) return DAY as never;
    return { ok: true } as never;
  });
  vi.spyOn(apiModule, "apiBase").mockResolvedValue("https://api.example.test");
  vi.spyOn(apiModule, "authHeaders").mockResolvedValue({});
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    uploads.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Close restaurant day, Cash: an expense in the petty cash book (D27-370)", () => {
  it("shows the category, and records a new one only with a category, its photo after it", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/day-end`]}>
          <Routes><Route path="/pos/:code/day-end" element={<DayEndPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /What is in the tin/ }));
    expect(await screen.findByText("Expense · Kitchen · Chef · 11:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Record/ })[0]!);
    fireEvent.change(screen.getByLabelText("How much"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("What was it for"), { target: { value: "Gas cylinder" } });
    const record = () => screen.getAllByRole("button", { name: "Record" }).at(-1)! as HTMLButtonElement;
    expect(record().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Kitchen" } });
    fireEvent.change(screen.getByLabelText("Photo of the bill"),
      { target: { files: [new File(["x"], "bill.png", { type: "image/png" })] } });
    fireEvent.click(record());
    await waitFor(() => expect(uploads).toEqual(
      ["POST https://api.example.test/api/hotels/5EL/till/day-end/movements/new-2/photo"]));
    expect(posts).toEqual([{ path: `/api/hotels/${HOTEL}/till/day-end/movements`,
      body: { kind: "expense", amount: 120, reason: "Gas cylinder", category: "Kitchen" } }]);
  });
});
