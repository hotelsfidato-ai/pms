import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { CreditNoteFlow, CREDIT_NOTE_WHO } from "@/modules/finance/flows/CreditNoteFlow";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   D22-33, THE OWNER, 22 SEPTEMBER: a credit note is issued by the owner, an
   administrator, the GM and the accountant - no longer reception or the
   hotel manager. The server asks `approve` on an invoice (roleGate.ts);
   the button asks the same grant, and says who may where it cannot.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

const as = (role: Role) => signedIn({
  scope: {
    staffId: "22222222-2222-2222-2222-222222222222",
    email: "someone@fidato.in", fullName: "Someone", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

const draw = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <CreditNoteFlow hotelId="AGR" number="AGR/2026-27/00042" total="₹4,200.00" />
  </QueryClientProvider>,
);

describe("D22-33 - who may cancel an invoice", () => {
  it.each(["finance", "gm", "admin", "owner"] as const)("%s may", (role) => {
    as(role);
    draw();
    const button = screen.getByRole("button", { name: /Cancel this invoice/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(CREDIT_NOTE_WHO)).toBeNull();
  });

  it.each(["front_desk", "hotel_manager"] as const)("%s sees the button disabled, with who may", (role) => {
    as(role);
    draw();
    const button = screen.getByRole("button", { name: /Cancel this invoice/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(CREDIT_NOTE_WHO)).toBeDefined();
  });
});
