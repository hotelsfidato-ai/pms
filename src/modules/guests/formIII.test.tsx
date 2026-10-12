import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, TEST_HOTEL, startSignedIn, withTestHotel } from "@/test/app";
import { TEST_DOCUMENT } from "@/lib/testHotel";
import FormCPage from "@/modules/guests/pages/FormC";
import { formIIIMissing, particularsPayload } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   FORM III ON THE SCREEN (D27-25)

   Immigration and Foreigners Rules 2025, Rule 17, and the owner's
   answers of 27 September: the law's own fields before check-in, a
   citizen of Nepal or Bhutan asked no visa; the register runs the
   departure's clock too, takes a number per person, and warns that
   each foreigner in the room owes their own form. The server's half
   is api/test/modules/guests/formIII.test.ts.
   ══════════════════════════════════════════════════════════════════ */

describe("what Form III needs before check-in", () => {
  const all = {
    visaNumber: "V1", visaType: "e-Tourist", phoneInIndia: "+91 1", arrivedFrom: "Delhi",
    purpose: "tourism", previousStay: "Delhi",
  };

  it("asks the law's six of a foreign guest with a passport", () => {
    expect(formIIIMissing({}, "GB", true)).toEqual([
      "Visa or OCI number", "Visa type", "Phone in India", "Arrived from",
      "Purpose of visit", "Previous place of stay",
    ]);
    expect(formIIIMissing(all, "GB", true)).toEqual([]);
  });

  it("asks nothing of an Indian guest, and no visa of Nepal, Bhutan or a skipped ID", () => {
    expect(formIIIMissing({}, "IN", true)).toEqual([]);
    for (const [nat, captured] of [["NP", true], ["BT", true], ["GB", false]] as const) {
      expect(formIIIMissing({}, nat, captured)).not.toContain("Visa or OCI number");
      expect(formIIIMissing({}, nat, captured)).toContain("Arrived from");
    }
  });

  it("sends only what was typed, and employment as a yes or no", () => {
    expect(particularsPayload({ gender: "female", arrivedFrom: " Delhi ", city: "",
                                employedInIndia: "no", mobileAbroad: "+44 7700 1" })).toEqual({
      identity: { gender: "female" },
      /* The four numbers belong to the visit, not the document. */
      visit: { arrivedFrom: "Delhi", employedInIndia: false, mobileAbroad: "+44 7700 1" },
    });
  });
});

/* ── The register ─────────────────────────────────────────────────── */

const ROW = {
  reservationId: "r1", guest: "Ana Lima", nationality: "BR", passport: "P1",
  room: "204", adults: 2, children: 0, arrived: "2026-09-25", checkOut: "2026-09-27",
  status: "checked_out", arrivedAt: "2026-09-25 14:05", departedAt: "2026-09-27 10:40",
  dueBy: "26 Sep 2026, 14:05", departureDueBy: "28 Sep 2026, 10:40",
  overdue: false, departureOverdue: false, arrivalNumbers: ["A-1"], departureNumbers: [],
  filed: true, reference: "A-1", purpose: "tourism", arrivedFrom: "Delhi",
};

let posted: { path: string; body: unknown } | null = null;

beforeEach(() => {
  startSignedIn();
  posted = null;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted = { path, body: JSON.parse(String(init.body)) };
      return { ok: true } as never;
    }
    return { note: "This system does not file.", premises: null, due: 1, overdue: 0,
             rows: [ROW] } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderRegister(code = HOTEL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/h/${code}/form-c`]}>
        <Routes><Route path="/h/:code/form-c" element={<FormCPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the Form III register", () => {
  it("runs the departure's clock and records its number as a departure", async () => {
    renderRegister();
    /* The list is drawn twice - the table, and the cards a phone shows. */
    expect((await screen.findAllByText(/by 28 Sep 2026, 10:40/)).length).toBeGreaterThan(0);

    /* The arrival has its number; the departure's button is the only
       "Record number" on the row. */
    fireEvent.click(screen.getAllByRole("button", { name: "Record number" })[0]!);
    fireEvent.change(screen.getAllByLabelText("FRRO departure number")[0]!,
      { target: { value: "D-9" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(posted).toEqual({
      path: `/api/hotels/${HOTEL}/form-c/r1`, body: { reference: "D-9", kind: "departure" },
    }));
  });

  it("warns that each foreigner in the room needs their own Form III", async () => {
    renderRegister();
    expect((await screen.findAllByText("Each foreigner in the room needs their own Form III."))
      .length).toBeGreaterThan(0);
  });

  it("prints a card in Form III's order with both signature lines", async () => {
    renderRegister();
    fireEvent.click((await screen.findAllByRole("button", { name: /Print the Form III card/ }))[0]!);
    const card = within(document.querySelector("[data-form-iii-card]") as HTMLElement);
    expect(card.getByText("Arrived from").nextSibling?.textContent).toBe("Delhi");
    expect(card.getByText("Time of arrival").nextSibling?.textContent).toBe("14:05");
    expect(card.getByText("Next destination").nextSibling?.textContent).toBe("-");
    expect(card.getByText("Guest's signature on arrival, and date")).toBeTruthy();
    expect(card.getByText("Guest's signature on departure, and date")).toBeTruthy();
    /* GU-4 (the owner, 28 September): the booking's length, worded so it
       cannot read as a second arrival date beside the real clock above. */
    expect(card.getByText("Length of stay").nextSibling?.textContent)
      .toBe("2 nights (booked), expected to leave 27 Sep 2026");
  });
});

/* A TEST HOTEL'S CARD (the owner's D27-296 (8)): TEST · NOT VALID across
   its head, so a practice guest's form is never filed; a real hotel's card
   carries no such line. */
describe("the Form III card in a test hotel", () => {
  const card = async () => {
    fireEvent.click((await screen.findAllByRole("button", { name: /Print the Form III card/ }))[0]!);
    return document.querySelector("[data-form-iii-card]") as HTMLElement;
  };

  it("says TEST · NOT VALID across its head", async () => {
    withTestHotel();
    renderRegister(TEST_HOTEL);
    expect((await card()).querySelector("[data-test-document]")?.textContent).toBe(TEST_DOCUMENT);
  });

  it("and a real hotel's does not", async () => {
    renderRegister();
    expect((await card()).textContent).not.toContain(TEST_DOCUMENT);
  });
});
