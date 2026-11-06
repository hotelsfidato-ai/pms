import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/permissions";
import { HOTEL, AGRA_HOTEL, startSignedIn, withDemoHotel } from "@/test/app";
import PurchasingPage from "@/modules/purchasing/pages/Purchasing";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING · SUPPLIER DUES, ON THE SCREEN (the owner's D27-370)

   The accountant, the GM, the owner and an Admin see the tab: each unpaid
   credit bill under its supplier, the supplier's total and the total owed,
   a bill past its due date in red; Record payment sends how, the reference
   and the date. The Inventory Manager has no such tab, even by its address.
   The server's half: api/test/modules/purchasing/supplierDues.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const paid = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@/modules/purchasing/data/purchasing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/purchasing/data/purchasing")>()),
  getPurchasing: async () => ({
    me: { mayRaise: false, maySetRequesters: false }, stores: [], suppliers: [], items: [], requests: [] }),
  getSupplierDues: async () => ({
    today: "2026-10-27",
    suppliers: [{ id: "sup-ak", name: "Akkalkot Traders" }, { id: "sup-bw", name: "Bharat Wines" }],
    bills: [
      bill({ id: "s1", supplierId: "sup-ak", supplier: "Akkalkot Traders", billNo: "AT-771", billDate: "2026-09-18",
        amount: "3100.00", dueOn: "2026-10-18", from: { kind: "order", id: "o1", reference: "PO-5EL-2609-0001" } }),
      /* Part-paid: 400 paid, 500.50 left (D27-372). */
      bill({ id: "s2", supplierId: "sup-ak", supplier: "Akkalkot Traders", billNo: "AT-802", billDate: "2026-10-20",
        amount: "900.50", owed: "500.50", paid: "400.00", status: "part-paid", dueOn: "2026-11-19",
        from: { kind: "order", id: "o2", reference: "PO-5EL-2610-0004" },
        /* The bill against its order (D27-383 item 11): two differences, the first payment confirmed. */
        differences: [
          { lineId: "l1", item: "Basmati rice", unit: "kg", kind: "quantity", billed: "12.000", against: "10.000" },
          { lineId: "l1", item: "Basmati rice", unit: "kg", kind: "price", billed: "95.00", against: "90.00" },
        ],
        payments: [{ id: "p1", paidOn: "2026-10-22", method: "cash", reference: null, amount: "400.00", tds: null,
          handedOverBy: "Ravi", recordedBy: "Test Accountant", reversed: false, differencesSeenBy: "Test Accountant" }] }),
      bill({ id: "s3", supplierId: "sup-bw", supplier: "Bharat Wines", billNo: "B-312", billDate: "2026-10-21",
        amount: "8000.00", dueOn: "2026-11-20", from: { kind: "bar" } }),
    ],
    /* A credit note against Bharat Wines, not one bill: it lowers the supplier's total. */
    credits: [{ id: "c1", supplierId: "sup-bw", supplier: "Bharat Wines", noteNo: "BW-CN-9", noteDate: "2026-10-25",
      amount: "1000.00", issuedBy: "supplier", reason: "Two cases returned" }],
  }),
  paySupplierDue: async (_h: string, id: string, input: unknown) => { paid.calls.push({ id, ...(input as object) }); return { ok: true }; },
  addSupplierCreditNote: async (_h: string, input: unknown) => { paid.calls.push({ credit: input }); return { ok: true }; },
  reverseSupplierEntry: async (_h: string, input: unknown) => { paid.calls.push({ reverse: input }); return { ok: true }; },
}));

function bill(b: Record<string, unknown>) {
  return { owed: b["amount"], paid: "0.00", tds: "0.00", credited: "0.00", status: "unpaid", replaces: null,
           differences: [], payments: [], creditNotes: [], ...b };
}

function as(role: Role) {
  startSignedIn();
  const s = useSession.getState();
  useSession.setState({ scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] } });
  withDemoHotel();
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/h/${HOTEL}/purchasing?tab=dues`]}>
        <Routes><Route path="/h/:code/purchasing" element={<PurchasingPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { paid.calls = []; vi.stubGlobal("fetch", () => new Promise(() => {})); });
afterEach(() => {
  vi.unstubAllGlobals();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe("Purchasing · Supplier dues (D27-370)", () => {
  it("the accountant sees each supplier's bills and totals, overdue in red, and records a payment", async () => {
    as("finance");
    open();
    /* What is left: 3,100 + 500.50 + 8,000 - the 1,000 credit note = 10,600.50. */
    expect((await screen.findByText(/Owed to suppliers/)).closest("[data-dues-total]")!.textContent)
      .toBe("Owed to suppliers: ₹10,600.50 · 3 bills");
    expect([...document.querySelectorAll("[data-supplier-total]")].map((e) => e.textContent))
      .toEqual(["₹3,600.50", "₹7,000.00"]);
    expect(document.querySelector("[data-bill='AT-802'] [data-left]")!.textContent).toBe("₹500.50Part-paid");
    expect(screen.getByText(/Paid ₹400.00 on 22 Oct 2026 by Cash · handed over by Ravi/)).toBeTruthy();
    const late = document.querySelector("[data-bill='AT-771'] [data-overdue]")!;
    expect(late.textContent).toBe("18 Oct 2026 · overdue");
    expect(late.className).toContain("text-brand-red-700");
    expect(document.querySelector("[data-bill='AT-802'] [data-overdue]")).toBeNull();

    const row = document.querySelector("[data-bill='AT-771']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog");
    const pay = () => fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect((within(dialog).getByLabelText("Amount paid") as HTMLInputElement).value, "all that is left").toBe("3100.00");
    pay();
    expect((await within(dialog).findByRole("alert")).textContent).toBe("How was it paid? Cash, cheque, bank or UPI.");
    fireEvent.change(within(dialog).getByLabelText("How"), { target: { value: "cheque" } });
    pay();
    expect(within(dialog).getByRole("alert").textContent, "a cheque needs its number (D27-372)")
      .toBe("Type the cheque, UTR or UPI reference.");
    fireEvent.change(within(dialog).getByLabelText(/Reference/), { target: { value: "CHQ 004512" } });
    fireEvent.change(within(dialog).getByLabelText("Amount paid"), { target: { value: "3069" } });
    fireEvent.change(within(dialog).getByLabelText(/Handed over by/), { target: { value: "Suresh" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "TDS deducted" }));
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "194C" } });
    fireEvent.change(within(dialog).getByLabelText("Rate, %"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("TDS amount"), { target: { value: "31" } });
    pay();
    await vi.waitFor(() => expect(paid.calls).toEqual([
      { id: "s1", amount: 3069, method: "cheque", reference: "CHQ 004512", paidOn: "2026-10-27", handedOverBy: "Suresh",
        tds: { section: "194C", rate: 1, amount: 31 } }]));
  });

  it("a bill that differs from its order is flagged, and paying it asks the payer to confirm (D27-383 item 11)", async () => {
    as("finance");
    open();
    await screen.findByText(/Owed to suppliers/);
    expect(document.querySelector("[data-bill='AT-802'] [data-bill-differs]")!.textContent).toBe(
      "Differs from the order: Basmati rice: billed 12 kg, 10 kg came; Basmati rice: ₹95.00 a kg on the bill, ₹90.00 agreed");
    expect(document.querySelector("[data-bill='AT-771'] [data-bill-differs]"), "a bill like its order: no flag").toBeNull();
    expect(screen.getByText(/handed over by Ravi · differences from the order seen by Test Accountant$/)).toBeTruthy();

    paid.calls.length = 0;
    const row = document.querySelector("[data-bill='AT-802']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Record payment" }));
    const dialog = await screen.findByRole("dialog");
    expect([...dialog.querySelectorAll("[data-pay-differences] li")].map((l) => l.textContent)).toEqual([
      "Basmati rice: billed 12 kg, 10 kg came", "Basmati rice: ₹95.00 a kg on the bill, ₹90.00 agreed"]);
    fireEvent.change(within(dialog).getByLabelText("How"), { target: { value: "cash" } });
    fireEvent.change(within(dialog).getByLabelText(/Handed over by/), { target: { value: "Suresh" } });
    const pay = () => fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    pay();
    expect((await within(dialog).findByRole("alert")).textContent)
      .toBe("Tick that you have seen how this bill differs from its order, then record the payment.");
    expect(paid.calls, "not sent").toEqual([]);
    fireEvent.click(within(dialog).getByRole("checkbox",
      { name: "I have seen these differences, and this bill is to be paid as it is" }));
    pay();
    await vi.waitFor(() => expect(paid.calls).toEqual([{ id: "s2", amount: 500.5, method: "cash", reference: null,
      paidOn: "2026-10-27", handedOverBy: "Suresh", tds: null, differencesSeen: true }]));
  });

  it("a credit note on a bill, and a payment reversed with a reason (D27-372)", async () => {
    as("finance");
    open();
    await screen.findByText(/Owed to suppliers/);
    paid.calls.length = 0;
    const row = document.querySelector("[data-bill='B-312']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Credit note" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Number"), { target: { value: "BW-CN-10" } });
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByLabelText("What it is for"), { target: { value: "Short supply" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record credit note" }));
    await vi.waitFor(() => expect(paid.calls).toEqual([{ credit: { billId: "s3", supplierId: null, issuedBy: "supplier",
      noteNo: "BW-CN-10", noteDate: "2026-10-27", amount: 500, reason: "Short supply" } }]));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    paid.calls.length = 0;
    const payment = screen.getByText(/Paid ₹400.00 on 22 Oct 2026/).closest("tr") as HTMLElement;
    fireEvent.click(within(payment).getByRole("button", { name: "Reverse" }));
    dialog = await screen.findByRole("dialog", { name: /Reverse the payment of ₹400.00/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Say why it is reversed.");
    fireEvent.change(within(dialog).getByLabelText("Why"), { target: { value: "Entered on the wrong bill" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reverse" }));
    await vi.waitFor(() => expect(paid.calls).toEqual([
      { reverse: { kind: "payment", id: "p1", reason: "Entered on the wrong bill", correct: null } }]));
  });

  it("the Inventory Manager has no Supplier dues tab, even by its address", async () => {
    as("stores");
    open();
    await screen.findByText("Nothing has been asked for yet");
    expect(screen.queryByRole("tab", { name: "Supplier dues" })).toBeNull();
    expect(screen.queryByText(/Owed to suppliers/)).toBeNull();
  });
});
