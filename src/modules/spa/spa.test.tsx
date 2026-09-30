import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, AGRA_HOTEL, startSignedIn, signedIn } from "@/test/app";
import { clockDate, clockTime, shiftDay } from "@/modules/spa/data/spa";
import SpaDiaryPage from "@/modules/spa/pages/SpaDiary";
import SpaSetupPage from "@/modules/spa/pages/SpaSetup";

/* ══════════════════════════════════════════════════════════════════
   THE SPA SCREENS — the owner's D18-6, D18-8 and D18-21

   What is proved here is WHAT A PERSON IS LEFT LOOKING AT, never that a
   booking went out (MEMORY 291):

     an unpriced treatment reads "-" and nowhere ₹0
     the diary's OWN refusal reaches the screen, naming the therapist,
       the guest and the hour — not a sentence this screen wrote
     the tax refusal naming where GST is set reaches it too (D18-21)
     a read that failed says so, and never "nothing booked today"
     housekeeping sees the diary and is not offered a booking (D18-21)
     a time is shown as the PROPERTY sent it, whatever zone this
       machine is in (113, root MEMORY 297)

   The server is stubbed per path and made to refuse on purpose. Each of
   these was run against the code before the guard it proves, and seen
   to fail — the list is in this service's CHANGELOG.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => { startSignedIn(); });

afterEach(() => {
  vi.restoreAllMocks();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

/** Answers each request by its path; anything unlisted is a fault, so a
    screen reaching somewhere nobody expected shows up as one. */
function server(routes: Record<string, () => unknown>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    const path = url.split("?")[0]!;
    const answer = routes[path];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
}

function renderAt(path: string, route: string, element: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DIARY = `/api/hotels/${HOTEL}/spa`;
const TREATMENTS = `/api/hotels/${HOTEL}/spa/treatments`;
const THERAPISTS = `/api/hotels/${HOTEL}/spa/therapists`;
const STAYS = `/api/hotels/${HOTEL}/stays`;
const BOOK = `/api/hotels/${HOTEL}/spa/appointments`;

const diaryPage = () => renderAt(`/h/${HOTEL}/spa`, "/h/:code/spa", <SpaDiaryPage />);
const setupPage = () =>
  renderAt(`/h/${HOTEL}/spa/setup`, "/h/:code/spa/setup", <SpaSetupPage />);

/** The refusal the server hands back, in the shape `call()` reads. */
const refuse = (status: number, sentence: string) => () => {
  throw new ApiError(status, sentence, { reason: sentence });
};

/* ⚠ ELEVEN O'CLOCK AT THE HOTEL, with no offset — exactly what
   `app.hotel_clock` writes. If anything on the screen parses this into a
   Date it becomes eleven o'clock HERE, and the whole day moves by
   whatever this machine's zone happens to be. */
const ELEVEN = "2026-09-19T11:00";

const aTherapist = (over: Record<string, unknown> = {}) => ({
  id: "th-1", name: "Priya", appointments: [], ...over,
});

const anAppointment = (over: Record<string, unknown> = {}) => ({
  id: "ap-1", status: "booked", startsAt: ELEVEN, endsAt: "2026-09-19T12:00",
  treatment: "Aromatherapy massage", minutes: 60,
  guestName: "Mr Sharma", room: "204", amount: 2500, settlement: null, ...over,
});

const diary = (therapists: unknown[]) => () => ({
  businessDate: "2026-09-19", from: "2026-09-19", to: "2026-09-19", therapists,
});

describe("the spa price list", () => {
  it("shows an unpriced treatment as a dash, never ₹0", async () => {
    server({
      [TREATMENTS]: () => ({
        treatments: [
          { id: "t-1", name: "Aromatherapy massage", minutes: 60,
            price: 2500, isActive: true, notes: null },
          /* Entered, never priced. The owner's oldest rule. */
          { id: "t-2", name: "Foot reflexology", minutes: 30,
            price: null, isActive: true, notes: null },
        ],
      }),
      [THERAPISTS]: () => ({ therapists: [] }),
    });
    setupPage();

    const unpriced = (await screen.findByText("Foot reflexology"))
      .closest("li") as HTMLElement;
    expect(within(unpriced).getByText("-")).toBeTruthy();
    expect(within(unpriced).queryByText(/₹/)).toBeNull();

    /* And the priced one still prints its figure, so the dash is the
       NULL and not the screen having given up on money. */
    const priced = screen.getByText("Aromatherapy massage").closest("li") as HTMLElement;
    expect(within(priced).getByText("₹2,500")).toBeTruthy();
  });

  it("says a read that failed did not load - never 'nothing on the list'", async () => {
    server({
      [TREATMENTS]: refuse(500, "Request failed (500)."),
      [THERAPISTS]: () => ({ therapists: [] }),
    });
    setupPage();

    expect(await screen.findByText(/could not be loaded|did not load/i)).toBeTruthy();
    expect(screen.queryByText("Nothing on the list yet")).toBeNull();
  });
});

describe("the spa diary", () => {
  it("shows the time the PROPERTY sent, whatever zone this machine is in", async () => {
    server({ [DIARY]: diary([aTherapist({ appointments: [anAppointment()] })]) });
    diaryPage();

    /* Eleven at the hotel is eleven on the screen. Parsed into a Date it
       would be eleven HERE, which is a different hour at the property. */
    expect(await screen.findByText(/11:00 AM → 12:00 PM/)).toBeTruthy();
  });

  it("draws a therapist with nothing booked rather than dropping them", async () => {
    server({ [DIARY]: diary([aTherapist(), aTherapist({ id: "th-2", name: "Anjali" })]) });
    diaryPage();

    expect(await screen.findByText("Priya")).toBeTruthy();
    expect(screen.getByText("Anjali")).toBeTruthy();
    expect(screen.getAllByText("Free all day.").length).toBe(2);
  });

  it("shows an unpriced appointment as a dash, and says it cannot be closed", async () => {
    server({
      [DIARY]: diary([aTherapist({ appointments: [anAppointment({ amount: null })] })]),
    });
    diaryPage();

    const row = (await screen.findByText("Aromatherapy massage"))
      .closest("li") as HTMLElement;
    expect(within(row).getByText("-")).toBeTruthy();
    expect(within(row).queryByText(/₹/)).toBeNull();
    expect(within(row).getByText(/cannot be closed for money/)).toBeTruthy();
  });

  it("says a read that failed did not load - never 'nothing booked'", async () => {
    server({ [DIARY]: refuse(500, "Request failed (500).") });
    diaryPage();

    expect(await screen.findByText(/could not be loaded|did not load/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing booked/)).toBeNull();
    expect(screen.queryByText("Free all day.")).toBeNull();
  });

  it("shows the property's switch refusal as the server wrote it", async () => {
    const off = "This property has no spa. Turn it on in the property's "
      + "settings if that is wrong.";
    server({ [DIARY]: refuse(403, off) });
    diaryPage();

    expect(await screen.findByText(off)).toBeTruthy();
  });

  /* D18-21: housekeeping SEES the diary and does not touch it. The
     server refuses them the booking route as well, which is the half
     that matters; this only stops offering a door that would refuse. */
  it("lets housekeeping look and does not offer them a booking", async () => {
    signedIn({
      scope: {
        staffId: "33333333-3333-3333-3333-333333333333",
        email: "housekeeping@fidato.in", fullName: "Housekeeper",
        isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }],
      },
    });
    server({ [DIARY]: diary([aTherapist({ appointments: [anAppointment()] })]) });
    diaryPage();

    expect(await screen.findByText("Aromatherapy massage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Book a treatment/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByText(/sees the diary and does not book/)).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE REFUSALS THAT MUST ARRIVE WHOLE

   Both of these are sentences the DATABASE or the finance door wrote,
   and both name the thing to do next. A screen that replaced them with
   "that could not be booked" would throw away the only actionable half —
   which is the whole reason `app.book_spa_appointment` raises a named
   exception instead of letting the exclusion constraint answer.
   ══════════════════════════════════════════════════════════════════ */

async function fillTheBooking() {
  fireEvent.click(await screen.findByRole("button", { name: /Book a treatment/ }));

  /* ⚠ WAIT FOR THE OPTIONS, not for the box. The three lists are three
     reads, and a `change` to a value no option carries leaves the select
     on "" — the test then proves the screen's own "Which guest is this
     for?" and never reaches the server at all. */
  await screen.findByRole("option", { name: /Mr Sharma/ });
  await screen.findByRole("option", { name: /Aromatherapy/ });
  await screen.findByRole("option", { name: "Priya" });

  fireEvent.change(screen.getByLabelText("Which guest"), { target: { value: "stay-1" } });
  fireEvent.change(screen.getByLabelText("Which treatment"), { target: { value: "t-1" } });
  fireEvent.change(screen.getByLabelText("Which therapist"), { target: { value: "th-1" } });
  fireEvent.change(screen.getByLabelText("What time"), { target: { value: "11:00" } });

  fireEvent.click(screen.getByRole("button", { name: "Book it" }));
}

const booking = (onPost: () => unknown) => ({
  [DIARY]: diary([aTherapist()]),
  [STAYS]: () => [{
    id: "stay-1", hotelId: HOTEL, reference: "RES-1", guest: "Mr Sharma",
    roomNumber: "204", roomType: "Deluxe", status: "in-house",
  }],
  [TREATMENTS]: () => ({
    treatments: [{ id: "t-1", name: "Aromatherapy massage", minutes: 60,
                   price: 2500, isActive: true, notes: null }],
  }),
  [THERAPISTS]: () => ({ therapists: [{ id: "th-1", name: "Priya", isActive: true }] }),
  [BOOK]: onPost,
});

describe("what the desk is told when a booking is refused", () => {
  it("shows the diary's own sentence, naming the booking in the way", async () => {
    /* Written by `app.book_spa_appointment`, word for word. */
    const clash = "Priya is already with Mrs Rao: Aromatherapy massage at 19 Sep 11:00";
    server(booking(refuse(409, clash)));
    diaryPage();

    await fillTheBooking();

    expect(await screen.findByText(clash)).toBeTruthy();
    /* And nothing of this screen's own invention beside it. */
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });

  it("shows the tax refusal naming where GST is set (D18-21)", async () => {
    const noRate = "This property has not set a GST rate for the spa, so a "
      + "treatment cannot be billed. Set it under System → Administration → Configuration, in the GST card.";
    server(booking(refuse(409, noRate)));
    diaryPage();

    await fillTheBooking();

    expect(await screen.findByText(noRate)).toBeTruthy();
  });

  it("asks for the missing answer itself before troubling the server", async () => {
    const post = vi.fn(() => ({ ok: true, id: "ap-9" }));
    server(booking(post));
    diaryPage();

    fireEvent.click(await screen.findByRole("button", { name: /Book a treatment/ }));
    await screen.findByLabelText("Which guest");
    fireEvent.click(screen.getByRole("button", { name: "Book it" }));

    expect(await screen.findByText("Which guest is this for?")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE PROPERTY'S CLOCK, READ AS A STRING (113, root MEMORY 297)

   These three build no Date from what the server sent, which is the
   whole point: `new Date("2026-09-19T11:00")` is eleven o'clock in THIS
   browser's zone, and the hotel's server runs in GMT.
   ══════════════════════════════════════════════════════════════════ */
describe("a time belongs to the property", () => {
  it("reads the hour the server wrote, and never parses it", () => {
    expect(clockTime("2026-09-19T11:00")).toBe("11:00 AM");
    expect(clockTime("2026-09-19T00:30")).toBe("12:30 AM");
    expect(clockTime("2026-09-19T12:05")).toBe("12:05 PM");
    expect(clockTime("2026-09-19T23:45")).toBe("11:45 PM");
    /* A value that is not the shape the server promised is a dash, not
       a thrown RangeError that unmounts the screen (`format.ts`). */
    expect(clockTime(null)).toBe("-");
    expect(clockTime("nonsense")).toBe("-");
  });

  it("reads the date the server wrote", () => {
    expect(clockDate("2026-09-19")).toBe("19 Sep 2026");
    expect(clockDate("2026-01-01T09:00")).toBe("1 Jan 2026");
    expect(clockDate(undefined)).toBe("-");
  });

  it("steps a day without going through the browser's midnight", () => {
    expect(shiftDay("2026-09-19", 1)).toBe("2026-09-20");
    expect(shiftDay("2026-09-19", -1)).toBe("2026-09-18");
    /* Month and year ends, where day arithmetic usually breaks. */
    expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });
});
