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
   departure's clock too, takes a number per person, gives each foreigner
   a row of their own (D27-382) and warns of an adult not recorded. The
   server's half is api/test/modules/guests/formIII.test.ts and
   companions.test.ts.
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
  reservationId: "r1", guestId: "g1", companion: false, guest: "Ana Lima", nationality: "BR", passport: "P1",
  room: "204", adults: 2, recorded: 1, children: 0, arrived: "2026-09-25", checkOut: "2026-09-27",
  status: "checked_out", arrivedAt: "2026-09-25 14:05", departedAt: "2026-09-27 10:40",
  dueBy: "26 Sep 2026, 14:05", departureDueBy: "28 Sep 2026, 10:40",
  overdue: false, departureOverdue: false, arrivalNumbers: ["A-1"], departureNumbers: [],
  filed: true, reference: "A-1", purpose: "tourism", arrivedFrom: "Delhi",
};

let posted: { path: string; body: unknown } | null = null;
let put: { path: string; body: unknown } | null = null;
let rows: unknown[] = [ROW];
let unrecorded: unknown[] = [];

beforeEach(() => {
  startSignedIn();
  posted = null;
  put = null;
  rows = [ROW];
  unrecorded = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted = { path, body: JSON.parse(String(init.body)) };
      return { ok: true } as never;
    }
    if (init?.method === "PUT") {
      put = { path, body: JSON.parse(String(init.body)) };
      return { ok: true } as never;
    }
    return { note: "This system does not file.", premises: null, due: 1, overdue: 0, unrecorded, rows } as never;
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

  /* GUE-6 (D27-382): every foreigner their own row, and a warning for who is
     still to record, on a row or above the list. */
  describe("every adult in the room", () => {
    const BO = { ...ROW, guestId: "g2", companion: true, guest: "Bo Lima", passport: null,
                 arrivalNumbers: [], departureNumbers: [], recorded: 2 };

    it("warns of an adult not recorded, and only then", async () => {
      rows = [ROW, { ...ROW, reservationId: "r2", guest: "Cy Lima", adults: 1 }];
      renderRegister();
      await screen.findAllByText("Ana Lima");
      /* The list is drawn twice: one stay short, once in each. */
      expect(document.querySelectorAll("[data-form-iii-unrecorded]")).toHaveLength(2);
      expect(document.querySelector("[data-form-iii-unrecorded]")?.textContent).toBe("2 adults, 1 recorded");
    });

    it("says which rooms in house have nobody's row to carry the warning", async () => {
      unrecorded = [{ room: "101", adults: 2, recorded: 1 }];
      renderRegister();
      await screen.findAllByText("Ana Lima");
      expect(document.querySelector("[data-form-iii-in-house]")?.textContent)
        .toContain("room 101 (2 adults, 1 recorded)");
    });

    it("records a companion's number against them, and the lead's as it always was", async () => {
      rows = [ROW, BO];
      renderRegister();
      await screen.findAllByText("Bo Lima");
      const boRow = screen.getAllByText("Bo Lima").map((n) => n.closest("tr")).find(Boolean)!;
      fireEvent.click(within(boRow).getAllByRole("button", { name: "Record number" })[0]!);
      fireEvent.change(within(boRow).getByLabelText("FRRO arrival number"), { target: { value: "A-77" } });
      fireEvent.click(within(boRow).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(posted).toEqual({
        path: `/api/hotels/${HOTEL}/form-c/r1`,
        body: { reference: "A-77", kind: "arrival", guestId: "g2" },
      }));
    });

    it("completes a companion's own details", async () => {
      rows = [BO];
      renderRegister();
      fireEvent.click((await screen.findAllByRole("button", { name: "Complete details" }))[0]!);
      fireEvent.click(await screen.findByRole("button", { name: "Save" }));
      await waitFor(() => expect((put?.body as { guestId?: string })?.guestId).toBe("g2"));
    });
  });

  /* GUE-5 (D27-382): a passport skipped at check-in, recorded here. */
  describe("Complete details: the document", () => {
    const openDetails = async (row: Record<string, unknown>) => {
      rows = [row];
      renderRegister();
      fireEvent.click((await screen.findAllByRole("button", { name: "Complete details" }))[0]!);
      return screen.findByLabelText("Document") as Promise<HTMLSelectElement>;
    };

    it("takes the type and number, and sends them", async () => {
      const type = await openDetails({ ...ROW, passport: null, idType: null });
      fireEvent.change(type, { target: { value: "passport" } });
      fireEvent.change(screen.getByLabelText("Number"), { target: { value: "P1234567" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(put?.path).toBe(`/api/hotels/${HOTEL}/form-c/r1/details`));
      expect((put!.body as { identity: unknown }).identity)
        .toMatchObject({ idType: "passport", idNumber: "P1234567" });
    });

    it("asks what check-in asks: a wrong number stops Save, in the same words", async () => {
      const type = await openDetails({ ...ROW, passport: null, idType: null });
      fireEvent.change(type, { target: { value: "aadhaar" } });
      fireEvent.change(screen.getByLabelText("Number"), { target: { value: "1234" } });
      expect(document.querySelector("[data-id-wrong]")?.textContent).toMatch(/Aadhaar/);
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("sends no document it did not change", async () => {
      await openDetails({ ...ROW, passport: "P1", idType: "passport" });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(put).not.toBeNull());
      expect((put!.body as { identity: Record<string, unknown> }).identity["idNumber"]).toBeUndefined();
    });
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
