import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   LEADS AND WHATSAPP (D27-170)

   What a person is left looking at, against made-up leads shaped like the
   server's answer - never a real guest:

     "Book this lead" carries the lead's short-lived token and NOTHING a
       guest could be known by: no name, no phone in the address.
     Not connected says so, and shows no list.

   Every test uses its own property code: the app's query cache lives as
   long as this file (reputation.test.tsx, the same trap).
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({ connected: true }));

vi.mock("@/modules/leads/data/leads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/leads/data/leads")>();
  return {
    ...actual,
    getLeads: async () => ({
      connected: control.connected,
      inApp: control.connected,
      more: null,
      leads: control.connected ? [{
        ref: "tok_made_up_22_chars__", name: "Test Guest", phone: "+910000000001",
        status: "NEW", category: null, channel: "meta_ads", bookingRef: null, bookingValue: null,
        doNotContact: false, receivedAt: "2026-09-29T04:00:00.000Z",
        lastMessageAt: "2026-09-29T04:05:00.000Z", lastMessage: "Room for two?",
      }] : [],
    }),
    getConversation: async () => ({
      replyUrl: "https://leads.example.test/inbox/x",
      messages: [{ direction: "in", kind: "text", body: "Room for two?", at: "2026-09-29T04:00:00.000Z" }],
    }),
  };
});

const open = (code: string) => {
  go(`/h/${code}/leads`);
  render(<App />);
};

beforeEach(() => {
  startSignedIn();
  signedIn({
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222",
      email: "owner@fidato.in", fullName: "Group Owner", isGroupAdmin: true,
      hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }],
    },
  });
  control.connected = true;
});

describe("Leads and WhatsApp", () => {
  it("books a lead by its token, with no name or phone in the address", async () => {
    open("LD1");
    fireEvent.click(await screen.findByText("Test Guest"));
    const book = await screen.findByRole("link", { name: /Book this lead/i });
    const href = book.getAttribute("href")!;
    expect(href).toBe("/h/LD1/book?lead=tok_made_up_22_chars__");
    expect(href).not.toMatch(/910000000001|Test|Guest/);
    expect(await screen.findByText("Room for two?", { selector: "li p" })).toBeTruthy();
  });

  it("says it is not connected, and shows no list", async () => {
    control.connected = false;
    open("LD2");
    expect(await screen.findByText("Not connected yet")).toBeTruthy();
    expect(screen.queryByText("Enquiries")).toBeNull();
  });
});
