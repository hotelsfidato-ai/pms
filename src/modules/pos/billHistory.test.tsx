import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import { mayReach } from "@/components/app/navigation";
import type { Order } from "@/modules/pos/data/till";
import BillHistoryPage from "@/modules/pos/pages/BillHistory";

/* ══════════════════════════════════════════════════════════════════
   BILL HISTORY (the owner's D27-370, 27 October)

   Opens on today's business day, sends what was typed to the Till's
   earlier-bills route, says when the answer was cut at its cap, opens a
   bill on the bill's own paper and prints it again through the Till's
   reprint, and downloads the list on screen as a file Excel opens.
   ══════════════════════════════════════════════════════════════════ */

const API = `/api/hotels/${HOTEL}`;
const PAID = {
  id: "o-9", orderNo: "20260822-4", outlet: "REST", outletName: "Restaurant", hotelName: "5 Elements",
  hotelCity: null, hotelGstin: null, hotelFssai: null, table: "T2", status: "settled",
  businessDate: "2026-08-22", paymentMethod: "upi", openedBy: "Ravi", settledBy: "Ravi",
  eventId: null, eventTitle: null, tenders: [], abandonedReason: null, discount: 0, roundOff: 0,
  net: 320, taxable: 320, tax: 16, gross: 336, payable: 336, billsPrinted: 1, taxes: [],
  lines: [{ id: "l-1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5, note: null, voided: false,
            kotStatus: "sent", addedBy: "Ravi", parentLineId: null, isAddon: false, variationId: null }],
} as unknown as Order;

const row = (over: Record<string, unknown>) => ({
  id: "o-9", orderNo: "20260822-4", outlet: "REST", table: "T2", status: "settled",
  businessDate: "2026-08-22", gross: 336, payable: 336, paymentMethod: "upi", modes: ["upi"],
  openedAt: "20:15", settledAt: "21:40", lines: 1, waiter: "Ravi", guest: "Asha Rao", phone: "98765 43210",
  stayGuest: null, room: null, ...over,
});
let answer: { bills: unknown[]; capped: boolean; cap: number; outlets: unknown[] };
const asked: string[] = [];

beforeEach(() => {
  startSignedIn();
  withDemoHotel();
  asked.length = 0;
  answer = {
    bills: [row({}), row({ id: "o-8", orderNo: "20260822-3", status: "void", modes: ["cash"], guest: null, phone: null }),
            row({ id: "o-7", orderNo: "20260822-2", status: "no_charge", modes: [], paymentMethod: null }),
            /* Charged to a room: the stay's guest and room (D27-372). */
            row({ id: "o-6", orderNo: "20260822-1", modes: ["room"], paymentMethod: "room", guest: null, phone: null,
                  stayGuest: "Meera Iyer", room: "204" })],
    capped: false, cap: 500, outlets: [{ code: "REST", name: "Restaurant" }, { code: "BAR", name: "Bar" }],
  };
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    const path = url.split("?")[0];
    if (path === `${API}/till/bills`) return answer as never;
    if (path === `${API}/till/waiters`) return { waiters: [{ id: "11111111-2222-3333-4444-555555555555", name: "Ravi" }] } as never;
    if (path === `${API}/till/orders/o-9`) return PAID as never;
    if (path === `${API}/till/orders/o-9/bill-print`) {
      return { ok: true, heading: "duplicate", sentTo: { name: "Bar PC", online: true }, jobId: "7" } as never;
    }
    return new Promise(() => {}) as never;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/pos/${HOTEL}/bill-history`]}>
        <Routes><Route path="/pos/:code/bill-history" element={<BillHistoryPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const tableRows = () => Array.from(document.querySelectorAll("table tbody tr")) as HTMLElement[];

describe("Bill history", () => {
  it("opens on today's business day and lists paid, VOID and NC bills with who, how and how much", async () => {
    show();
    await vi.waitFor(() => expect(tableRows()).toHaveLength(4));
    expect(asked).toContain(`GET ${API}/till/bills?from=2026-08-25&to=2026-08-25`);
    const [paid, voided, nc, room] = tableRows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    /* The time it was settled, so labelled (D27-372). */
    expect(document.querySelector("thead")!.textContent).toContain("Date and time settled");
    expect(room.textContent).toContain("Meera Iyer");
    expect(room.textContent).toContain("Room 204");
    for (const text of ["20260822-4", "22 Aug 2026 · 21:40", "Restaurant", "T2", "Asha Rao", "98765 43210", "Ravi", "UPI", "₹336.00", "Paid"]) {
      expect(paid.textContent, text).toContain(text);
    }
    expect(voided.textContent).toContain("VOID");
    expect(voided.textContent).toContain("Cash");
    expect(nc.textContent).toContain("NC");
    expect(nc.textContent, "a bill given free has no value").not.toContain("₹");
    expect(screen.getByText("4 bills.")).toBeTruthy();
  });

  it("sends every filter it was given, and asks nothing when there is nothing to look for", async () => {
    show();
    await vi.waitFor(() => expect(tableRows()).toHaveLength(4));
    const form = document.querySelector("[data-bill-filters]") as HTMLElement;
    const type = (label: string, value: string) =>
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    type("From", "2026-08-01");
    type("To", "2026-08-20");
    type("Bill number", "R-12");
    type("Table", "T2");
    type("Guest name, phone or room", "asha");
    type("Paid by", "card");
    type("Waiter", "11111111-2222-3333-4444-555555555555");
    type("Outlet", "BAR");
    fireEvent.click(within(form).getByRole("button", { name: /Show bills/ }));
    const want = new URLSearchParams({
      from: "2026-08-01", to: "2026-08-20", no: "R-12", table: "T2", guest: "asha", mode: "card",
      waiter: "11111111-2222-3333-4444-555555555555", outlet: "BAR",
    }).toString();
    await vi.waitFor(() => expect(asked).toContain(`GET ${API}/till/bills?${want}`));

    const before = asked.length;
    fireEvent.click(within(form).getByRole("button", { name: "Clear" }));
    fireEvent.click(within(form).getByRole("button", { name: /Show bills/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Pick the dates, or type a bill number, a table or a guest.");
    expect(asked.length, "nothing asked").toBe(before);

    type("From", "2026-08-20");
    type("To", "2026-08-01");
    fireEvent.click(within(form).getByRole("button", { name: /Show bills/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("The first date is after the last.");
  });

  it("says so when the answer was cut at its cap", async () => {
    answer.capped = true;
    show();
    const note = await vi.waitFor(() => {
      const n = document.querySelector("[data-bill-count]");
      if (!n) throw new Error("no count yet");
      return n as HTMLElement;
    });
    expect(note.textContent).toBe("Showing the first 500 bills. More matched: narrow the dates or add a filter to see the rest.");
  });

  it("opens the whole bill on the bill's own paper and prints it again through the Till's reprint", async () => {
    show();
    await vi.waitFor(() => expect(tableRows()).toHaveLength(4));
    fireEvent.click(tableRows()[0]!);
    const dialog = await screen.findByRole("dialog");
    await vi.waitFor(() => expect(within(dialog).getByText("Paneer Tikka")).toBeTruthy());
    expect(dialog.querySelector("[data-bill-heading]")?.getAttribute("data-bill-heading")).toBe("duplicate");
    fireEvent.click(within(dialog).getByRole("button", { name: /Print the bill/ }));
    await vi.waitFor(() => expect(asked).toContain(`POST ${API}/till/orders/o-9/bill-print`));
  });

  it("downloads the list on screen as a file Excel opens: bare numbers, NC blank, the dates it covers in the name", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: (b: Blob) => { blobs.push(b); return "blob:bills"; }, revokeObjectURL: vi.fn(),
    }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    show();
    await vi.waitFor(() => expect(tableRows()).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: /Download to Excel/ }));
    await vi.waitFor(() => expect(names).toHaveLength(1));
    expect(names).toEqual(["5el-bill-history-2026-08-25-to-2026-08-25.csv"]);
    const lines = (await blobs[0]!.text()).replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Bill,Date,Settled at,Outlet,Table,Guest,Room,Phone,Waiter,Paid by,Total,State");
    expect(lines[1]).toBe("20260822-4,2026-08-22,21:40,Restaurant,T2,Asha Rao,,98765 43210,Ravi,UPI,336.00,Paid");
    expect(lines[2]).toBe("20260822-3,2026-08-22,21:40,Restaurant,T2,,,,Ravi,Cash,336.00,VOID");
    expect(lines[3]).toBe("20260822-2,2026-08-22,21:40,Restaurant,T2,Asha Rao,,98765 43210,Ravi,,,NC");
    expect(lines[4]).toBe("20260822-1,2026-08-22,21:40,Restaurant,T2,Meera Iyer,204,,Ravi,To a room,336.00,Paid");
  });

  it("is offered to the managers, the Accountant and Reception only (D27-372)", () => {
    for (const role of ["owner", "admin", "gm", "hotel_manager", "finance", "front_desk"] as const) {
      expect(mayReach(role, "/pos/5EL/bill-history"), role).toBe(true);
    }
    for (const role of ["pos", "bar", "chef", "kitchen_manager", "housekeeping", "read_only", "revenue_manager", "stores"] as const) {
      expect(mayReach(role, "/pos/5EL/bill-history"), role).toBe(false);
    }
    /* The waiter and the bar keep the Till, and its one-day search. */
    expect(mayReach("pos", "/pos/5EL/till")).toBe(true);
    expect(mayReach("bar", "/pos/5EL/till")).toBe(true);
  });
});
