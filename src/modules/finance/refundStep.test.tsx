import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as refunds from "@/modules/finance/data/refunds";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import { RefundStep } from "./flows/RefundStep";

/* ══════════════════════════════════════════════════════════════════
   THE REFUND STEP (the owner's D27-315 Part B)

   It says what is owed back, then one of three: a notice (a company's
   credit, a booking site's stay), who may give it, or Refund - offering
   only the ways and amounts the server allows, asking a reference for
   anything but cash, and saying in plain words that cash stops below
   ₹20,000 until the CA confirms it and that the receipt is not the GST
   voucher. The server's rules: api/test/modules/finance/refunds.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const BILL = {
  folioId: "folio-1", credit: 24000, notice: null,
  ways: [{ label: "Cash", kind: "cash", upTo: 19999.99 }, { label: "UPI", kind: "upi", upTo: 2000 }],
};
let sent: refunds.RefundInput | null = null;

beforeEach(() => {
  startSignedIn();
  sent = null;
  vi.spyOn(refunds, "giveRefund").mockImplementation(async (_h, _s, input) => {
    sent = input;
    return { ok: true, data: { id: "77" } };
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(options: refunds.RefundOptions) {
  vi.spyOn(refunds, "getRefundOptions").mockResolvedValue(options);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider><MemoryRouter>
        <RefundStep hotelId="5EL" stayId="stay-1" onDone={() => {}} />
      </MemoryRouter></TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("the refund step on an overpaid bill", () => {
  it("tells reception who gives refunds, and offers no button", async () => {
    show({ may: false, ceiling: 20000, bills: [BILL] });
    expect(await screen.findByText("₹24,000.00 is owed back to the guest.")).toBeTruthy();
    expect(screen.getByText(/given by the owner, an administrator, the general manager or the accountant/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
  });

  it("shows a company's or a booking site's notice instead", async () => {
    show({ may: true, ceiling: 20000, bills: [{ ...BILL, notice: "This credit is the company's." }] });
    expect(await screen.findByText("This credit is the company's.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
  });

  it("gives it back by UPI with a reference, saying the ceiling and the voucher in plain words", async () => {
    show({ may: true, ceiling: 20000, bills: [BILL] });
    fireEvent.click(await screen.findByRole("button", { name: /Refund/ }));
    expect(await screen.findByText(/Cash is given back only below ₹20,000 on a bill.*until the hotel's CA confirms it/)).toBeTruthy();
    expect(screen.getByText(/plain refund receipt\. The GST refund voucher \(Rule 51\) waits for the hotel's CA/)).toBeTruthy();
    /* Cash first: no reference asked, the most cash may give offered. */
    expect(screen.queryByLabelText("Reference")).toBeNull();
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("19999.99");

    fireEvent.change(screen.getByLabelText(/Back by/), { target: { value: "UPI" } });
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("2000");
    const give = screen.getByRole("button", { name: "Give refund" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Left a day early" } });
    expect(give.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "UPI 4471" } });
    expect(give.disabled).toBe(false);
    fireEvent.click(give);
    await waitFor(() => expect(sent).toEqual({
      folioId: "folio-1", method: "UPI", amount: 2000, reference: "UPI 4471", reason: "Left a day early",
    }));
    expect(await screen.findByText("Print the refund receipt")).toBeTruthy();
  });

  it("will not send more than the way allows", async () => {
    show({ may: true, ceiling: 20000, bills: [BILL] });
    fireEvent.click(await screen.findByRole("button", { name: /Refund/ }));
    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "Left early" } });
    expect((screen.getByRole("button", { name: "Give refund" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
