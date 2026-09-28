import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";
import { TooltipProvider } from "@/components/ui";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE BILL TAB'S MONEY CONTROLS - QA FI-4, FI-5, FI-6, FI-11 (28 September)

   A reversal asks "are you sure" with a required reason (D27-117), and a
   payment's only for the owner, an administrator, the GM or the accountant
   (D27-125); a charge is more than zero; the running "bal" ends at the
   balance; the charge's preview never shows the last amount's rate. The
   server's half is api/test/modules/finance/billControls.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "208", status: "in-house", arrival: "2026-09-20", departure: "2026-09-22",
} as unknown as Stay;

const line = (id: string, over: Record<string, unknown>) => ({
  id, folioId: "f-1", stayId: "stay-1", billTo: "guest", company: null,
  businessDate: "2026-09-21", category: "food", description: `Line ${id}`,
  amount: 0, tax: 0, kind: "charge", reversed: false, createdAt: "2026-09-21T10:00:00Z", user: "Test",
  ...over,
});

/* A room ₹6,000; coffee ₹150 + ₹7.50; UPI ₹1,000, reversed; a ₹50 charge
   + ₹2.50, reversed. Balance ₹6,157.50. */
const LINES = [
  line("1", { description: "Room 208", category: "room", amount: 6000 }),
  line("2", { description: "Two coffees", amount: 150, tax: 7.5 }),
  line("3", { description: "Received - UPI", category: "payment", kind: "payment", amount: -1000, reversed: true }),
  line("4", { description: "Late snack", amount: 50, tax: 2.5, reversed: true }),
  line("5", { description: "Reversal - Received - UPI", category: "payment", kind: "reversal", amount: 1000, reversalOf: "3" }),
  line("6", { description: "Reversal - Late snack", kind: "reversal", amount: -50, tax: -2.5, reversalOf: "4" }),
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function bill(role: Role, rates?: (amount: string) => unknown) {
  signedIn({ scope: {
    staffId: "44444444-4444-4444-4444-444444444444", email: `${role}@fidato.in`,
    fullName: role, isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url === "/api/hotels/5EL/stays/stay-1/postings") return LINES as never;
    if (url === "/api/hotels/5EL/stays/stay-1/folios") return [] as never;
    const rate = url.match(/\/tax\/room\/rate\?amount=(.*)$/);
    if (rate && rates) return rates(rate[1]!) as never;
    return new Promise(() => {}) as never;
  });
  vi.spyOn(postings, "reverseChargeAllowed").mockResolvedValue({ allowed: true });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-21" /></MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("the running balance (FI-6)", () => {
  it("ends at the balance after a reversed charge and a reversed payment", async () => {
    bill("front_desk");
    await screen.findByText("Room 208");
    const bals = screen.getAllByText(/^bal /).map((e) => e.textContent);
    expect(bals.at(-1)).toBe("bal ₹6,158");
  });
});

describe("a reversal (FI-5)", () => {
  it("asks first, and will not go without a reason", async () => {
    bill("front_desk");
    const back = vi.spyOn(postings, "reverseCharge").mockImplementation(() => new Promise(() => {}));
    const undo = await screen.findByRole("button", { name: "Reverse Two coffees" });
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(undo);
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Reverse" }) as HTMLButtonElement;
    expect(back, "reversed on one click").not.toHaveBeenCalled();
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Wrong room" } });
    fireEvent.click(go);
    await waitFor(() => expect(back).toHaveBeenCalledWith("5EL", "stay-1", "2", "Wrong room"));
  });

  it("of a payment is not reception's", async () => {
    const payment = { ...LINES[2]!, id: "7", description: "Received - Cash", reversed: false };
    LINES.push(payment);
    try {
      bill("front_desk");
      const undo = await screen.findByRole("button", { name: "Reverse Received - Cash" });
      await new Promise((r) => setTimeout(r, 50));
      expect((undo as HTMLButtonElement).disabled).toBe(true);
      cleanup();
      bill("gm");
      const gm = await screen.findByRole("button", { name: "Reverse Received - Cash" });
      await waitFor(() => expect((gm as HTMLButtonElement).disabled).toBe(false));
    } finally { LINES.pop(); }
  });
});

describe("Post a charge (FI-4, FI-11)", () => {
  it("will not post a negative amount", async () => {
    bill("front_desk", () => ({ rate: 5 }));
    fireEvent.click(await screen.findByRole("button", { name: /Add charge/ }));
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "QA negative test" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "-50" } });
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByRole("button", { name: "Post charge" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never shows the last amount's rate for a new amount", async () => {
    /* ₹8,000 answers 18%; ₹150's answer has not come back yet. */
    bill("front_desk", (amount) => (amount === "8000" ? { rate: 18 } : new Promise(() => {})));
    fireEvent.click(await screen.findByRole("button", { name: /Add charge/ }));
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "8000" } });
    await waitFor(() => expect(document.querySelector("[data-charge-rate]")?.textContent).toMatch(/18%/));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-charge-rate]")?.textContent).not.toMatch(/18%/);
  });
});
