import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import App from "@/App";
import { go, startSignedIn, signedIn, AGRA_HOTEL, withTestHotel } from "@/test/app";
import { TEST_DOCUMENT } from "@/lib/testHotel";

/* ══════════════════════════════════════════════════════════════════
   LAUNDRY — the owner's D17-54, D18-5, D18-7 and D18-8

   What is proved here is what a PERSON is left looking at, never that a
   docket reached the server (MEMORY 291):

     an item nobody has priced shows a dash and NOWHERE a zero
     a bag holding one has no total, and is not offered to a bill
     the hotel's own linen offers NO way to charge it to anybody (D18-5)
     a guest's priced bag does offer one, and it goes through the API
     whose it is has NO default - the dialog refuses before it sends
     a read that failed says so, and never "nothing has gone to the
       laundry", which is the bag somebody then collects twice

   The reads are switched per test; the writes are spies.

   ⚠ EVERY TEST USES ITS OWN PROPERTY CODE, and the detail tests their
   own docket id. The application's query cache lives as long as this
   file (App.tsx makes it once, staleTime Infinity), so two tests
   sharing a key means the second reads what the first cached and the
   controls above it do nothing. A code per test is one word and cannot
   go wrong; ordering the tests around a shared cache is what goes wrong
   later. Learnt the expensive way by the purchasing chat.
   ══════════════════════════════════════════════════════════════════ */

const control = vi.hoisted(() => ({
  list: "rows" as "rows" | "empty" | "unreachable",
  charged: [] as string[],
  collected: [] as unknown[],
  returned: [] as unknown[],
  chargeRefusal: null as string | null,
}));

vi.mock("@/modules/laundry/data/laundry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/modules/laundry/data/laundry")>();
  const { ApiError } = await import("@/lib/api");
  const unreachable = () =>
    new ApiError(0, "Could not reach the server. Showing the last data received.");

  const docket = (over: Record<string, unknown> = {}) => ({
    id: "guest-priced", number: "LD-5EL-2609-0001", belongsTo: "guest",
    stayId: "stay-1", stayReference: "RES-0042", guestName: "Anita Desai",
    roomNumber: "204", status: "open", businessDate: "2026-09-19",
    collectedAt: "2026-09-19T09:00:00.000Z", returnedAt: null, notes: null,
    total: 240, pieces: 3, stillOut: 3, unpricedLines: 0, charged: false,
    ...over,
  });

  const shirt = (over: Record<string, unknown> = {}) => ({
    id: "l1", description: "Shirt", service: "wash", quantity: 2,
    returnedQuantity: 0, stillOut: 2, unitPrice: 80, ...over,
  });

  /* The id in the URL says which docket this is. */
  const DETAIL: Record<string, unknown> = {
    "guest-priced": { ...docket(), lines: [shirt(), shirt({ id: "l2", unitPrice: 80 })] },
    "guest-unpriced": {
      ...docket({ id: "guest-unpriced", number: "LD-5EL-2609-0002",
        total: null, unpricedLines: 1 }),
      lines: [shirt(), shirt({ id: "l2", description: "Saree", service: "dry_clean",
        unitPrice: null })],
    },
    "guest-charged": {
      ...docket({ id: "guest-charged", number: "LD-5EL-2609-0005", status: "returned",
        charged: true, stillOut: 0 }),
      lines: [shirt({ returnedQuantity: 2, stillOut: 0 })],
    },
    /* ⚠ PRICED ON PURPOSE. A hotel docket CAN have a total — its lines
       came off the same price list, and `app.laundry_docket_total` works
       one out the moment they are all priced. So whose it is has to be
       the ONLY thing keeping the charge away from it, or this test
       passes for the wrong reason and the guard is never exercised. */
    hotel: {
      ...docket({ id: "hotel", number: "LD-5EL-2609-0003", belongsTo: "hotel",
        stayId: null, stayReference: null, guestName: null, roomNumber: null,
        total: 400, pieces: 40, stillOut: 40, unpricedLines: 0 }),
      lines: [shirt({ id: "l3", description: "Bed sheet", quantity: 40,
        stillOut: 40, unitPrice: 10 })],
    },
  };

  return {
    ...actual,
    getPriceList: async () => {
      if (control.list === "unreachable") throw unreachable();
      return {
        items: control.list === "empty" ? [] : [
          { id: "p1", name: "Shirt", service: "wash", price: 80, isActive: true },
          /* Nobody has priced it. NOT 0 — that is a different answer. */
          { id: "p2", name: "Saree", service: "dry_clean", price: null, isActive: true },
          /* And 0 IS a price: somebody decided it is free. */
          { id: "p3", name: "Bed sheet", service: "wash", price: 0, isActive: true },
        ],
      };
    },
    getDockets: async () => {
      if (control.list === "unreachable") throw unreachable();
      return {
        businessDate: "2026-09-19",
        nextNumber: "LD-5EL-2609-0004",
        dockets: control.list === "empty" ? [] : [
          docket({ id: "hotel", number: "LD-5EL-2609-0003", belongsTo: "hotel",
            stayId: null, stayReference: null, guestName: null, roomNumber: null,
            status: "returned", total: null, pieces: 40, stillOut: 0 }),
          docket({ id: "guest-unpriced", number: "LD-5EL-2609-0002",
            total: null, unpricedLines: 1 }),
        ],
      };
    },
    getDocket: async (_code: string, id: string) => DETAIL[id] ?? DETAIL["guest-priced"],
    getStaysToChargeTo: async () => [
      { id: "stay-1", reference: "RES-0042", guest: "Anita Desai", roomNumber: "204" },
    ],
    createDocket: async (_code: string, input: unknown) => {
      control.collected.push(input);
      return { ok: true, data: { id: "guest-priced", number: "LD-5EL-2609-0004" } };
    },
    returnDocket: async (_code: string, _id: string, returned: unknown) => {
      control.returned.push(returned);
      return { ok: true, data: { stillOut: 0 } };
    },
    chargeDocket: async (_code: string, id: string) => {
      control.charged.push(id);
      return control.chargeRefusal === null
        ? { ok: true }
        : { ok: false, reason: control.chargeRefusal };
    },
  };
});

/* D18-8: reception and housekeeping run it, and no new roles were made.
   The default clerk is reception, which is the role this service is for. */
const as = (role: string) => signedIn({
  scope: {
    staffId: "55555555-5555-5555-5555-555555555555",
    email: "laundry-test@fidato.in", fullName: "Laundry Test", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }],
  },
});

beforeEach(() => {
  startSignedIn();
  control.list = "rows";
  control.charged.splice(0);
  control.collected.splice(0);
  control.returned.splice(0);
  control.chargeRefusal = null;
});

describe("laundry", () => {
  it("shows an item nobody has priced as a dash, and nowhere a zero", async () => {
    as("front_desk");
    go("/h/LA1/laundry/price-list");
    render(<App />);

    /* An unpriced item: the field is EMPTY and reads a dash. Not "0",
       which is a price somebody set meaning free - and the bed sheet
       below proves the two are told apart. */
    const saree = await screen.findByLabelText("Price for Saree, dry-clean");
    expect((saree as HTMLInputElement).value).toBe("");
    expect(saree.getAttribute("placeholder")).toBe("-");

    const shirt = screen.getByLabelText("Price for Shirt, wash");
    expect((shirt as HTMLInputElement).value).toBe("80");
    /* Free is 0 and says 0. A dash would lose a decision somebody made. */
    const sheet = screen.getByLabelText("Price for Bed sheet, wash");
    expect((sheet as HTMLInputElement).value).toBe("0");

    /* And the screen says what an unpriced item costs the hotel. */
    expect(screen.getByText(/One item has no price yet/)).toBeTruthy();
  });

  it("offers NO way to charge the hotel's own linen to anybody (D18-5)", async () => {
    as("front_desk");
    go("/h/LA2/laundry/hotel");
    render(<App />);

    /* Whose it is, said in the heading, in the facts and in the card
       that explains why there is no button - D18-5 is not a footnote. */
    expect((await screen.findAllByText("The hotel's own linen")).length)
      .toBeGreaterThan(1);
    /* The table refuses it and the route refuses before it, so the
       button is not there to be pressed. */
    expect(screen.queryByRole("button", { name: "Charge to the room" })).toBeNull();
    expect(screen.getByText(/never charged to anybody/)).toBeTruthy();
    expect(control.charged).toEqual([]);

    /* D27-316 (4): plain words for staff - no developer code, no talk of a
       table or of a button that is not there. */
    expect(screen.getByText("Counted out and back, never charged to anybody.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bD\d+-\d+\b/);
    expect(document.body.textContent).not.toContain("The table refuses");
  });

  it("says a charged docket is its own line on the folio, without a developer code (D27-316 (4))", async () => {
    as("front_desk");
    go("/h/LA6/laundry/guest-charged");
    render(<App />);

    expect(await screen.findByText("Already on the bill")).toBeTruthy();
    expect(screen.getByText(
      "It is its own line on the room's folio. A charge is reversed on the folio, never by cancelling the docket under it.",
    )).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bD\d+-\d+\b/);
  });

  it("does not offer a bill to a bag with anything unpriced in it", async () => {
    as("front_desk");
    go("/h/LA3/laundry/guest-unpriced");
    render(<App />);

    expect(await screen.findByText(/One thing in this bag has no price yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Charge to the room" })).toBeNull();

    /* The unpriced line reads a dash in BOTH money columns - never 0,
       and never blank, which reads as "nothing to pay". */
    const row = screen.getByText("Saree").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("-")).toHaveLength(2);
    expect(within(row).queryByText("₹0.00")).toBeNull();
  });

  it("charges a guest's priced bag through the API, and shows a refusal in its own words", async () => {
    as("front_desk");
    control.chargeRefusal =
      "Charging to the room is not connected yet: finance's door does not hand out a way to post a charge.";
    go("/h/LA4/laundry/guest-priced");
    render(<App />);

    const charge = await screen.findByRole("button", { name: "Charge to the room" });
    fireEvent.click(charge);

    /* It went through the service's route. Nothing here writes a folio. */
    await vi.waitFor(() => expect(control.charged).toEqual(["guest-priced"]));
    /* And the server's sentence is what the screen says, not a friendlier
       one this screen made up. */
    expect(await screen.findByText(/not connected yet/)).toBeTruthy();
  });

  it("says whose every docket is, in the list (D18-5)", async () => {
    as("housekeeping");
    go("/h/LA5/laundry");
    render(<App />);

    await screen.findByRole("table");
    const table = within(screen.getByRole("table"));
    const hotel = table.getByText("LD-5EL-2609-0003").closest("tr") as HTMLElement;
    expect(within(hotel).getByText("The hotel's own linen")).toBeTruthy();

    const guest = table.getByText("LD-5EL-2609-0002").closest("tr") as HTMLElement;
    expect(within(guest).getByText("Anita Desai · Room 204")).toBeTruthy();
    /* No total while something in it is unpriced — a dash, not a part. */
    expect(within(guest).getAllByText("-").length).toBeGreaterThan(0);
    expect(within(guest).queryByText("₹0.00")).toBeNull();
  });

  it("refuses a docket that does not say whose it is, before it is sent", async () => {
    as("front_desk");
    go("/h/LA6/laundry");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Collect a bag" }));
    const dialog = await screen.findByRole("dialog");
    /* NO DEFAULT. D18-5 is a NOT NULL column, and a default here would be
       this screen guessing whose bill something lands on. */
    expect((within(dialog).getByLabelText(/Whose is this/) as HTMLSelectElement).value).toBe("");
    /* Nothing else is asked until it is answered. */
    expect(within(dialog).queryByLabelText("What is on line 1")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Collect it" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(control.collected).toEqual([]);
  });

  it("collects a guest's bag, naming the stay", async () => {
    as("front_desk");
    go("/h/LA7/laundry");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Collect a bag" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Whose is this/),
      { target: { value: "guest" } });
    fireEvent.change(await within(dialog).findByLabelText(/Which stay/),
      { target: { value: "stay-1" } });
    fireEvent.change(within(dialog).getByLabelText("What is on line 1"),
      { target: { value: "p2" } });
    fireEvent.change(within(dialog).getByLabelText("How many on line 1"),
      { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Collect it" }));

    await vi.waitFor(() => expect(control.collected).toHaveLength(1));
    expect(control.collected).toEqual([{
      belongsTo: "guest",
      stayId: "stay-1",
      lines: [{ priceItemId: "p2", quantity: 2 }],
    }]);
  });

  it("says a read that failed did not load - never that nothing has gone to the laundry", async () => {
    as("front_desk");
    control.list = "unreachable";
    go("/h/LA8/laundry");
    render(<App />);

    expect(await screen.findByText("The dockets did not load")).toBeTruthy();
    expect(screen.queryByText("Nothing has gone to the laundry yet")).toBeNull();

    control.list = "empty";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    const first = await screen.findByRole("button", { name: "Collect a bag" });
    expect(screen.queryByText("The dockets did not load")).toBeNull();
    expect(first.getAttribute("data-variant")).toBe("primary");
  });
});

/* A TEST HOTEL'S DOCKET (the owner's D27-296 (8)): TEST · NOT VALID across
   its head; a real hotel's carries no such line. */
describe("a laundry docket in a test hotel", () => {
  it("says TEST · NOT VALID across its head", async () => {
    as("front_desk");
    withTestHotel({ code: "LA9", of: "AGR" });
    go("/h/LA9/laundry/guest-priced");
    render(<App />);
    await screen.findByRole("button", { name: "Charge to the room" });
    expect(document.querySelector("section [data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
  });

  it("and a real hotel's does not", async () => {
    as("front_desk");
    go("/h/LA10/laundry/guest-priced");
    render(<App />);
    await screen.findByRole("button", { name: "Charge to the room" });
    expect(document.querySelector("[data-test-document]")).toBeNull();
  });
});
