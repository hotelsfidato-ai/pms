import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";
import { StayCompanions } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   EVERY ADULT IN THE ROOM (the owner's D27-382, GUE-6)

   On the screen: "2 adults, 1 recorded" as a warning; a person added,
   corrected or taken off on their own call; an ID as the desk's own rules
   have it, a foreigner's Form III boxes with nothing starred. The check-in
   window's own test is front desk's; the server's half is
   api/test/modules/guests/companions.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const ANA = {
  guestId: "g-ana", name: "Ana Lima", nationality: "BR", idType: "passport", idNumber: "P7654321",
  filed: false, visaNumber: "V1", arrivedFrom: "Delhi",
};
const RAVI = {
  guestId: "g-ravi", name: "Ravi Lima", nationality: "IN", idType: "aadhaar",
  idNumber: "XXXX XXXX 1234", filed: true,
};
const PEOPLE = {
  adults: 2, recorded: 1, lead: "Lead Guest", leadNationality: "IN", open: true, companions: [] as unknown[],
};

let people = PEOPLE;
let sent: { path: string; method: string; body: Record<string, unknown> | null }[] = [];

beforeEach(() => {
  startSignedIn();
  sent = [];
  people = PEOPLE;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init: RequestInit = {}) => {
    if (init.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
      return { ok: true } as never;
    }
    return (path.endsWith("/companions") ? people : []) as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const block = (adults?: number) => render(
  <QueryClientProvider client={client()}>
    <StayCompanions hotelId="5EL" stayId="stay-1" today="2026-09-27"
      {...(adults === undefined ? {} : { adults })} />
  </QueryClientProvider>,
);
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

describe("adults in the room", () => {
  it("warns of who is still to record, and follows the party the window has", async () => {
    block();
    expect(await screen.findByText("2 adults, 1 recorded")).toBeTruthy();
    cleanup();
    block(3);
    expect(await screen.findByText("3 adults, 1 recorded")).toBeTruthy();
  });

  it("adds an Indian adult with a name and an ID, on its own call", async () => {
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    expect(save().disabled, "a guest has a name").toBe(true);
    type(/^Full name/, "Asha Rao");
    type(/^Document/, "passport");
    type(/^Number/, "A1234567");
    fireEvent.click(save());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "POST", path: "/api/hotels/5EL/stays/stay-1/companions",
      body: { fullName: "Asha Rao", nationality: "IN", identity: { idType: "passport", idNumber: "A1234567" } },
    });
  });

  it("asks no reason for a missing ID: a name and a nationality can be saved", async () => {
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    type(/^Full name/, "Asha Rao");
    expect(screen.queryByLabelText(/Reason for skipping/)).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it("checks a typed ID by the desk's rules, in its words", async () => {
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    type(/^Full name/, "Asha Rao");
    type(/^Document/, "aadhaar");
    type(/^Number/, "1234");
    expect(document.querySelector("[data-id-wrong]")?.textContent).toMatch(/Aadhaar/);
    expect(save().disabled).toBe(true);
  });

  it("copies the lead's visit answers to a foreigner, and only those (D27-386)", async () => {
    people = { ...PEOPLE, leadVisit: { arrivedFrom: "Delhi", purpose: "Tourism", remarks: null } } as typeof PEOPLE;
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    type(/^Full name/, "Bo Lima");
    expect(screen.queryByRole("button", { name: "Same as the guest" }), "not for an Indian adult").toBeNull();
    type(/^Nationality/, "GB");
    fireEvent.click(screen.getByRole("button", { name: "Same as the guest" }));
    expect((screen.getByLabelText(/^Arrived from/) as HTMLInputElement).value).toBe("Delhi");
    fireEvent.click(save());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({ visit: { arrivedFrom: "Delhi", purpose: "Tourism" } });
  });

  it("offers no copy when the lead has answered nothing yet", async () => {
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    type(/^Nationality/, "GB");
    expect(screen.queryByRole("button", { name: "Same as the guest" })).toBeNull();
  });

  it("opens Form III's boxes for a foreigner, none of them holding up Save", async () => {
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Add an adult" }));
    type(/^Full name/, "Bo Lima");
    type(/^Nationality/, "GB");
    expect(document.querySelector("[data-form-iii]")).toBeTruthy();
    expect(screen.queryByText(/Starred fields are needed now/)).toBeNull();
    expect(save().disabled).toBe(false);
    type(/^Arrived from/, "Delhi");
    fireEvent.click(save());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({ nationality: "GB", visit: { arrivedFrom: "Delhi" } });
  });

  it("edits a person with their answers, sending a document only when one is typed", async () => {
    people = { ...PEOPLE, companions: [ANA] };
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Ana Lima" }));
    expect(document.querySelector("[data-companion-on-record]")?.textContent).toContain("Passport P7654321");
    expect((screen.getByLabelText(/^Arrived from/) as HTMLInputElement).value).toBe("Delhi");
    type(/^Full name/, "Ana Maria Lima");
    fireEvent.click(save());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: "PUT", path: "/api/hotels/5EL/stays/stay-1/companions/g-ana" });
    expect((sent[0]!.body!["identity"] as Record<string, unknown>)["idNumber"]).toBeUndefined();
    expect(sent[0]!.body).toMatchObject({ fullName: "Ana Maria Lima", identity: { visaNumber: "V1" } });
  });

  it("asks before it removes anybody", async () => {
    people = { ...PEOPLE, companions: [ANA] };
    block();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Ana Lima" }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: "DELETE", path: "/api/hotels/5EL/stays/stay-1/companions/g-ana" });
  });

  it("says a filed person is the register's, shows the masked number, offers neither", async () => {
    people = { ...PEOPLE, recorded: 2, companions: [RAVI] };
    block();
    expect(await screen.findByText(/Form III filed: corrected on the register/)).toBeTruthy();
    expect(screen.getByText(/XXXX XXXX 1234/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Ravi Lima" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Ravi Lima" })).toBeNull();
  });

  it("adds nobody to a booking that did not go ahead", async () => {
    people = { ...PEOPLE, open: false, companions: [ANA] };
    block();
    await screen.findByText("Ana Lima");
    expect(screen.queryByRole("button", { name: "Add an adult" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Ana Lima" })).toBeNull();
  });

  it("draws nothing, and asks nothing, for a role that may not read an ID (D25-38)", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "h@fidato.in", fullName: "Housekeeping",
      isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }],
    } });
    block();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-stay-companions]")).toBeNull();
    expect(vi.mocked(apiModule.api).mock.calls.filter(([p]) => String(p).endsWith("/companions"))).toEqual([]);
  });
});
