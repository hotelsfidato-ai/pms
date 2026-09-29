import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";
import { CompanyDialog } from "@/modules/contracts";

/* ══════════════════════════════════════════════════════════════════
   ADD COMPANY (D27-184, C-6 and C-7)

   Reception adds a company with its name, GSTIN and address only: no kind,
   contact or credit on the form, and none sent. The owner sees credit. A
   GSTIN with a wrong check digit is caught before the button.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<Record<string, unknown>> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") posted.push(JSON.parse(String(init.body)));
    return { ok: true, id: "co-1" } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <CompanyDialog hotelId="5EL" open onOpenChange={() => {}} />
  </QueryClientProvider>,
);
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { selector: "input" }), { target: { value } });
const add = () => screen.getByRole("button", { name: "Add company" }) as HTMLButtonElement;

describe("Add company", () => {
  it("reception: name, GSTIN and address only, and a mistyped GSTIN stops it", async () => {
    open();
    expect(screen.queryByText("Credit allowed")).toBeNull();
    expect(screen.queryByLabelText(/^Contact person/)).toBeNull();

    type(/^Name/, "Tata Motors");
    type(/^GSTIN/, "27AAPFU0939F1ZW");
    expect(add().disabled).toBe(true);
    expect(screen.getByText(/a character is mistyped/)).toBeTruthy();

    type(/^GSTIN/, "27AAPFU0939F1ZV");
    type(/^Billing address/, "1 Station Road");
    type(/^PIN code/, "411001");
    fireEvent.click(add());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      name: "Tata Motors", kind: "corporate", gstin: "27AAPFU0939F1ZV",
      addressLine: "1 Station Road", pincode: "411001",
      creditAllowed: false, creditDays: null, creditLimit: null, contactName: null,
    });
  });

  it("the owner also sets the kind, the contact and credit", () => {
    signedIn({ scope: { staffId: "o", email: "owner@fidato.in", fullName: "Owner",
                        isGroupAdmin: true, hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }] } });
    open();
    expect(screen.getByText("Credit allowed")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Travel agent" })).toBeTruthy();
    expect(screen.getByLabelText(/^Contact person/)).toBeTruthy();
  });
});
