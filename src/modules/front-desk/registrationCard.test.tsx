import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { RegistrationCardSheet } from "./pages/RegistrationCard";
import type { RegistrationCard } from "./data/stays";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST REGISTRATION CARD (the owner's D27-344, D27-345)

   The old card's boxes, in Fidato's style: what the server sends, printed
   as sent (Aadhaar arrives as its last four), a dash for anything missing -
   the number of a stay checked in before the cards were numbered among them
   - a blank Remark, and the house policies over the signature.
   ══════════════════════════════════════════════════════════════════ */

const CARD: RegistrationCard = {
  hotel: { name: "5 Elements Akkalkot", address: "1 Ghat Road", city: "Akkalkot", state: "Maharashtra",
           phone: "+91 2181 220 555", email: null, website: null, gstin: "27ABCDE1234F1Z5" },
  housePolicies: ["Photo ID at check-in.", "No smoking in the rooms."],
  grCardNo: 421,
  stay: { reference: "FH-0007", roomType: "Deluxe", room: "204", adults: 2, children: 1, plan: "CP", nights: 2,
          arrival: "11 Oct 2026, 14:05", departure: "13 Oct 2026" },
  rate: "3699.00",
  guest: { title: "Mr", name: "A Test Guest", email: null, phone: "+91 98200 00000", nationality: "IN",
           address: { line: "12 Test Lane", city: "Pune", state: "Maharashtra", pincode: "411005", country: "IN" },
           idType: "aadhaar", idNumber: "XXXX XXXX 5674" },
  companions: [],
  company: null,
  agent: { name: "go-MMT", email: null, phone: null, voucher: "NH7712" },
  arrivedFrom: null,
  nextDestination: null,
};

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(async () => ({ name: "Fidato Hotels", logo: null }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const sheet = (card: RegistrationCard, test = false) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RegistrationCardSheet card={card} test={test} hotelCode="5EL" />
    </QueryClientProvider>,
  );
  return document.querySelector("[data-registration-card]")!;
};
const box = (label: string) => [...document.querySelectorAll("[data-registration-card] p")]
  .find((p) => p.textContent === label)!.nextElementSibling!.textContent;

describe("the registration card", () => {
  it("prints the guest, the stay, the agent and the ID as the server sent them", () => {
    sheet(CARD);
    expect(box("G.R. card no")).toBe("421");
    expect(box("Name")).toBe("Mr A Test Guest");
    expect(box("Address")).toBe("12 Test Lane, Pune, Maharashtra 411005, India");
    expect(box("Identity")).toBe("Aadhaar · XXXX XXXX 5674");
    expect(box("Nationality")).toBe("India");
    expect(box("Room")).toBe("Deluxe / 204");
    expect(box("Persons")).toBe("2 adults · 1 child");
    expect(box("Tariff")).toBe("₹3,699.00 a night, before GST (CP)");
    expect(box("Travel agent")).toBe("go-MMT");
    expect(box("Voucher no")).toBe("NH7712");
    /* Missing is a dash, never a guess. */
    expect(box("Billing company")).toBe("-");
    expect(box("Arriving from")).toBe("-");
  });

  /* D27-382: every adult in the room, their ID as the server masked it. */
  it("lists the other adults, and says nothing when there are none", () => {
    sheet({ ...CARD, companions: [
      { name: "Second Guest", nationality: "IN", idType: "aadhaar", idNumber: "XXXX XXXX 1234" },
      { name: "Third Guest", nationality: "GB", idType: null, idNumber: null },
    ] });
    const list = document.querySelector("[data-registration-companions]")!;
    expect(list.textContent).toContain("Second Guest · India · Aadhaar XXXX XXXX 1234");
    expect(list.textContent).toContain("Third Guest · United Kingdom · -");
    cleanup();
    sheet(CARD);
    expect(document.querySelector("[data-registration-companions]")).toBeNull();
  });

  it("prints a dash for a stay checked in before the cards were numbered", () => {
    sheet({ ...CARD, grCardNo: null });
    expect(box("G.R. card no")).toBe("-");
  });

  it("leaves the Remark blank and prints the house policies over the signature", () => {
    const card = sheet(CARD);
    expect(card.querySelector("[data-registration-remark]")!.textContent).toBe("Remark");
    expect([...card.querySelectorAll("[data-registration-policies] li")].map((li) => li.textContent))
      .toEqual(["Photo ID at check-in.", "No smoking in the rooms."]);
    expect(card.textContent).toContain("Guest signature");
    expect(card.textContent).toContain("please initial in this box");
  });

  it("carries no GSTIN on a test hotel's card", () => {
    const card = sheet(CARD, true);
    expect(card.textContent).not.toContain("GSTIN");
  });
});
