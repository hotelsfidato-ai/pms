import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import Documents from "./pages/property/Documents";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS › DOCUMENTS (the owner's D27-344, D27-348)

   Each document's own component, drawn with the hotel's header and a
   made-up guest, SAMPLE · NOT VALID and no GSTIN; Print a sample prints
   only the sample. Nothing is saved or sent.
   ══════════════════════════════════════════════════════════════════ */

const PROPERTY = {
  id: "h1", code: "AGR", name: "Agra Test Hotel", city: "Agra", state: "Uttar Pradesh", gstin: "09ABCDE1234F1Z5",
  phone: "+91 562 000 0000", email: "desk@example.test", addressLine: "1 Fort Road", isActive: true, rooms: 10,
  roomTypes: ["Deluxe"], website: null, pan: null, fssaiNumber: null, housePolicies: ["Photo ID at check-in."],
};

function open() {
  signedIn({ scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in", fullName: "Owner",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }],
  } });
  useUi.setState({ hotelId: "AGR" });
  const sent: string[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") sent.push(path);
    if (path === "/api/admin/hotels/AGR") return { property: PROPERTY, staff: [], grantableRoles: [] } as never;
    return { name: "Fidato Hotels", logo: null } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Documents /></MemoryRouter>
    </QueryClientProvider>,
  );
  return sent;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const sample = () => document.querySelector("[data-documents-sample]")!;

describe("Settings › Documents", () => {
  it("draws the tax invoice with the hotel's header, a made-up guest, SAMPLE · NOT VALID and no GSTIN", async () => {
    const sent = open();
    await screen.findAllByText("Agra Test Hotel");
    expect(sample().querySelector("[data-invoice-sheet]")).toBeTruthy();
    expect(sample().querySelector("[data-test-document]")!.textContent).toBe("SAMPLE · NOT VALID");
    expect(sample().textContent).toContain("A. Sample Guest");
    expect(sample().textContent).not.toContain("09ABCDE1234F1Z5");
    expect(screen.getByText(/Issued and printed by itself when the guest checks out/)).toBeTruthy();
    expect(sent, "nothing is saved").toEqual([]);
  });

  it.each([
    ["Proforma bill", "Proforma Bill"],
    ["Registration card", "Registration Card"],
    ["Restaurant bill", "Paneer Tikka"],
  ])("draws the %s's sample", async (tab, words) => {
    open();
    await screen.findAllByText("Agra Test Hotel");
    fireEvent.mouseDown(screen.getByRole("tab", { name: tab }));
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(await screen.findAllByText(words)).not.toHaveLength(0);
    expect(sample().textContent).toContain("SAMPLE · NOT VALID");
    expect(sample().textContent).not.toContain("09ABCDE1234F1Z5");
  });

  it("prints only the sample, in the hotel's copies", async () => {
    open();
    await screen.findAllByText("Agra Test Hotel");
    const printed: string[][] = [];
    vi.spyOn(window, "print").mockImplementation(() => {
      printed.push([...document.querySelectorAll(".invoice-print [data-invoice-copy]")].map((e) => e.textContent ?? ""));
    });
    fireEvent.click(screen.getByRole("button", { name: /Print a sample/ }));
    expect(printed).toEqual([["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR SUPPLIER"]]);
  });
});
