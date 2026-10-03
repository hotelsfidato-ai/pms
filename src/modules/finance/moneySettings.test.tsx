import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { payingWays } from "@/lib/rules";
import PaymentMethodsPage from "./pages/money/PaymentMethods";
import ExtraChargesPage from "./pages/money/ExtraCharges";

/* ══════════════════════════════════════════════════════════════════
   MONEY IN THE SETTINGS CONSOLE - the owner's D27-259 (191)
   ══════════════════════════════════════════════════════════════════ */

const METHODS = {
  defaultMethod: "UPI",
  kinds: { cash: "Cash", upi: "UPI", city_ledger: "Bill to company" },
  methods: [
    { id: "m1", label: "Cash", kind: "cash", isActive: true, used: true },
    { id: "m2", label: "UPI", kind: "upi", isActive: true, used: false },
    { id: "m3", label: "Agoda", kind: "city_ledger", isActive: true, used: false },
  ],
};
const CHARGES = {
  earlyCheckinCharge: null, lateCheckoutCharge: 1000,
  charges: [
    { id: "c1", name: "Welcome drink", description: null, rate: null, category: "beverage",
      isTransport: false, isActive: true, used: false },
    { id: "c2", name: "Airport pickup", description: null, rate: 1000, category: "misc",
      isTransport: true, isActive: true, used: true },
  ],
};

const show = (page: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{page}</MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(startSignedIn);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the screens' ways of paying (Q1, Q2)", () => {
  it("are the hotel's own that are On; an advance leaves out Bill to company", () => {
    const rules = { paymentMethods: [{ label: "Cash", kind: "cash" }, { label: "Agoda", kind: "city_ledger" }] };
    expect(payingWays(rules)).toEqual(["Cash", "Agoda"]);
    expect(payingWays(rules, false)).toEqual(["Cash"]);
    /* An older server sends no list: the five every hotel started with. */
    expect(payingWays(undefined, false)).toEqual(["Cash", "UPI", "Credit Card", "Debit Card"]);
  });
});

describe("Money › Payment methods", () => {
  it("says what each is in the books, marks the default, and deletes only one never used", async () => {
    vi.spyOn(apiModule, "api").mockResolvedValue(METHODS as never);
    show(<PaymentMethodsPage />);
    /* Each row's switch says whose it is, for a screen reader. */
    expect(await screen.findByRole("switch", { name: "Agoda" })).toBeTruthy();
    expect(screen.getByText("Bill to company")).toBeTruthy();
    expect(screen.getByText("Default").closest("p")?.textContent).toContain("UPI");
    expect(screen.queryByRole("button", { name: "Delete Cash" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete UPI" })).toBeTruthy();
  });
});

describe("Money › Extra charges and Pickup and drop", () => {
  it("shows an unpriced charge as included, never ₹0, and keeps pickups on their own page", async () => {
    vi.spyOn(apiModule, "api").mockResolvedValue(CHARGES as never);
    show(<ExtraChargesPage />);
    expect(await screen.findByRole("button", { name: "Edit Welcome drink" })).toBeTruthy();
    expect(screen.getByText(/Included, no charge/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Airport pickup" })).toBeNull();
    cleanup();
    show(<ExtraChargesPage transport />);
    expect(await screen.findByRole("button", { name: "Edit Airport pickup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Welcome drink" })).toBeNull();
  });
});
