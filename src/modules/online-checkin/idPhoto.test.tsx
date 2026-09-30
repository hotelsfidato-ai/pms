import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import * as uploadModule from "@/modules/online-checkin/data/upload";
import GuestPage from "@/modules/online-checkin/pages/GuestPage";
import DeskPage from "@/modules/online-checkin/pages/Desk";
import { AddIdPhotoAtDesk } from "@/modules/online-checkin";
import { signedIn, AGRA_HOTEL } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE ID PHOTO, ON THE SCREENS (D27-207 to D27-212)

   The screen's half of the door's rules (api/test/guestIdPhoto.test.ts
   keeps the server's): the notice and the Aadhaar rule come BEFORE the
   file button; nothing is sent without a photo and the tick; the guest's
   page never asks for the image back; the desk's screen fetches one only
   when somebody presses Show, and only where the server offered it.

   `api` and the form upload are stubbed per path: an unlisted call fails
   the test rather than answering empty. Every name and file is made up.
   ══════════════════════════════════════════════════════════════════ */

const TOKEN = "a-token-from-the-desk";
const OPEN = `/api/guest/${TOKEN}`;
const UNLOCK = "this-phone-only-unlock-0123456789abcdefgh";

const BOOKING = {
  kind: "booking" as const,
  hotel: { code: "5EL", name: "5 Elements Akkalkot" },
  room: null, occupied: true,
  booking: { reference: "FH-2609-5001", guestName: "A. Guest", checkIn: "2026-08-25", checkOut: "2026-08-27", status: "confirmed" },
  verified: true, phoneHint: "…4321", emailHint: null, canSendCodes: true, cannotSend: null,
  googleClientId: null, offers: [] as string[],
};
const DETAILS_WAITING = { sent: { status: "waiting", submittedAt: "2026-08-24T09:00:00Z", idType: "passport", idLastFour: "0001" } };
const PHOTO = { offered: true, maySend: true, contact: "02181 000000", sent: null as unknown, removed: null as string | null };

type Answer = (init?: RequestInit) => unknown;
function server(routes: Record<string, Answer>) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = routes[url.split("?")[0]!];
    if (!answer) throw new apiModule.ApiError(500, `the page called ${url}`);
    return answer(init) as never;
  });
}
/** The form upload, stood in for: it keeps what was sent. */
function uploads(answer: () => unknown = () => ({ sent: true, added: true })) {
  const sent: { url: string; form: FormData; headers: Record<string, string> }[] = [];
  vi.spyOn(uploadModule, "upload").mockImplementation(async (base, path, form, headers) => {
    sent.push({ url: `${base}${path}`, form, headers: Object.fromEntries(new Headers(headers ?? {})) });
    return answer() as never;
  });
  return sent;
}

function open(path: string, route: string, page: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={page} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const openGuest = () => open(`/g/${TOKEN}`, "/g/:token", <GuestPage />);
const guestDoor = (photo: unknown, more: Record<string, Answer> = {}) => ({
  [OPEN]: () => BOOKING,
  [`${OPEN}/details`]: () => DETAILS_WAITING,
  [`${OPEN}/id-photo`]: () => photo,
  [`${OPEN}/bill`]: () => { throw new apiModule.ApiError(409, "not yet"); },
  [`${OPEN}/requests`]: () => ({ offers: [], requests: [] }),
  ...more,
});
const aPhoto = (name = "IMG_0001.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], name, { type: "image/jpeg" });
const choose = (label: string, file: File) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* jsdom without storage */ }
  localStorage.setItem(`guest-unlock:${TOKEN.slice(0, 12)}`, UNLOCK);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the guest's own page", () => {
  it("says what is asked, the Aadhaar rule and who sees it BEFORE the file button, and needs the tick", async () => {
    const sent = uploads();
    let stored = false;
    server(guestDoor(null, {
      [`${OPEN}/id-photo`]: () => (stored ? { ...PHOTO, sent: { sides: ["front"], at: "2026-08-24T09:05:00Z" } } : PHOTO),
    }));
    openGuest();

    expect(await screen.findByRole("heading", { name: "A photo of your ID (optional)" })).toBeTruthy();
    const notice = document.querySelector("[data-id-photo-notice]")!;
    expect(notice.textContent).toContain("Cover the first 8 digits before you take the photo");
    expect(notice.textContent).toContain("A photo showing the full number will be removed");
    expect(notice.textContent).toContain("the front desk and managers of 5 Elements Akkalkot. Nobody else. It is stored encrypted.");
    expect(notice.textContent).toContain("contact 5 Elements Akkalkot at 02181 000000.");
    const front = screen.getByLabelText("Front of the ID");
    expect(notice.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the notice comes before the file button").toBeTruthy();
    expect((front as HTMLInputElement).accept, "a phone is asked for a JPEG or a PNG").toBe("image/jpeg,image/png");
    expect(screen.getByText("You can skip this and show your ID at the desk.")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Send the photo" }) as HTMLButtonElement;
    expect(button.disabled, "nothing chosen, nothing agreed").toBe(true);
    choose("Front of the ID", aPhoto());
    expect(button.disabled, "a photo, and still no tick").toBe(true);
    fireEvent.click(screen.getByLabelText("I agree to 5 Elements Akkalkot keeping this photo of my ID."));
    expect(button.disabled).toBe(false);

    stored = true;
    fireEvent.click(button);
    expect(await screen.findByText("Photo sent")).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${OPEN}/id-photo`);
    expect(sent[0]!.headers["authorization"], "with this phone's unlock").toBe(`Guest ${UNLOCK}`);
    expect(sent[0]!.form.get("agreed")).toBe("yes");
    expect(sent[0]!.form.get("front")).toBeInstanceOf(Blob);
    expect(sent[0]!.form.get("back"), "no back chosen, none sent").toBeNull();
    expect(screen.queryByLabelText("Front of the ID"), "and the form is put away").toBeNull();
  });

  it("is not drawn where the hotel takes none, nor before the details are sent", async () => {
    server(guestDoor({ ...PHOTO, offered: false }));
    openGuest();
    await screen.findByText("Verified on this phone");
    await screen.findByText(/Passport ending 0001/);
    expect(screen.queryByRole("heading", { name: "A photo of your ID (optional)" })).toBeNull();
    cleanup();

    server(guestDoor({ ...PHOTO, maySend: false }, { [`${OPEN}/details`]: () => ({ sent: null }) }));
    openGuest();
    await screen.findByLabelText("Your ID");
    expect(screen.queryByRole("heading", { name: "A photo of your ID (optional)" })).toBeNull();
  });

  it("says why the desk removed one, in the door's words, and asks again", async () => {
    const why = "The front desk removed your photo because the Aadhaar number was not covered. "
      + "Send it again with the first 8 digits hidden.";
    server(guestDoor({ ...PHOTO, removed: why }));
    openGuest();
    expect(await screen.findByText(why)).toBeTruthy();
    expect(screen.getByLabelText("Front of the ID")).toBeTruthy();
  });

  it("knows only that a photo is there, and never asks the door for it back", async () => {
    const spy = server(guestDoor({ ...PHOTO, sent: { sides: ["front", "back"], at: "2026-08-24T09:05:00Z" } }));
    openGuest();
    expect(await screen.findByText("Front and back sent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send a different photo" })).toBeTruthy();
    expect(document.querySelector("[data-id-photo] img"), "no image of it on the page").toBeNull();
    const asked = new Set(spy.mock.calls.map((c) => String(c[0])));
    expect([...asked].filter((u) => u.includes("id-photo"))).toEqual([`${OPEN}/id-photo`]);

    /* Once the desk has checked the details, nothing more is asked. */
    cleanup();
    server(guestDoor({ ...PHOTO, maySend: false, sent: { sides: ["front"], at: "2026-08-24T09:05:00Z" } }));
    openGuest();
    expect(await screen.findByText("Photo sent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send a different photo" })).toBeNull();
  });

  it("prints the door's refusal of a photo, and keeps what was chosen", async () => {
    uploads(() => { throw new apiModule.ApiError(400, "That file is not a photo we can take. Send a JPEG or a PNG."); });
    server(guestDoor(PHOTO));
    openGuest();
    await screen.findByLabelText("Front of the ID");
    choose("Front of the ID", aPhoto());
    fireEvent.click(screen.getByLabelText("I agree to 5 Elements Akkalkot keeping this photo of my ID."));
    fireEvent.click(screen.getByRole("button", { name: "Send the photo" }));
    expect(await screen.findByText("That file is not a photo we can take. Send a JPEG or a PNG.")).toBeTruthy();
    expect(screen.getByLabelText("Front of the ID")).toBeTruthy();
  });
});

describe("the desk's screen", () => {
  const DESK = "/api/hotels/5EL/online-checkin";
  const WAITING = {
    id: "sub-1", guest: "A. Guest", reference: "FH-2609-5001", idType: "passport",
    idNumber: "P1234567", passportExpiry: null, visaNumber: null, visaExpiry: null,
    addressLine: null, city: null, country: null, submittedAt: "2026-08-25T09:00:00Z", more: {},
    photo: { id: "photo-1", sides: ["front", "back"], at: "2026-08-25T09:02:00Z" } as unknown,
  };
  const view = (over: Record<string, unknown> = {}) => ({
    waiting: [WAITING], requests: [], rooms: [],
    idPhotos: { on: true, off: null, keeper: false }, ...over,
  });
  const openDesk = () => open("/h/5EL/online-checkin", "/h/:code/online-checkin", <DeskPage />);
  const IMAGE = "data:image/jpeg;base64,/9j/4AAQ";

  it("fetches the photo only when the clerk presses Show, and drops it on Hide", async () => {
    const spy = server({
      [DESK]: () => view(),
      [`${DESK}/id-photos/photo-1`]: () => ({ photos: [{ side: "front", image: IMAGE }, { side: "back", image: IMAGE }] }),
    });
    openDesk();
    const show = await screen.findByRole("button", { name: "Show the photo" });
    expect(screen.getByText(/ID photo: front and back, sent/)).toBeTruthy();
    expect(spy.mock.calls.map((c) => c[0]), "nothing fetched by opening the screen").toEqual([DESK]);

    fireEvent.click(show);
    const front = await screen.findByAltText("The front of the guest's ID");
    expect(front.getAttribute("src")).toBe(IMAGE);
    expect(screen.getByAltText("The back of the guest's ID")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide the photo" }));
    await waitFor(() => expect(screen.queryByAltText("The front of the guest's ID")).toBeNull());
  });

  it("removes an unmasked one with its reason, after asking", async () => {
    const REMOVE = `${DESK}/id-photos/photo-1/remove`;
    const spy = server({ [DESK]: () => view(), [REMOVE]: () => ({ removed: true, deletedFromDrive: true }) });
    openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Remove the photo" }));
    expect(await screen.findByText(/own page says why and asks for another/)).toBeTruthy();
    expect(spy.mock.calls.map((c) => c[0]), "nothing removed by opening the question").not.toContain(REMOVE);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove the photo" }).at(-1)!);
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === REMOVE)?.[1]?.body)
      .toBe(JSON.stringify({ reason: "not_masked" })));
  });

  it("says the photo cannot be fetched, in the server's words, and leaves Confirm where it was", async () => {
    const cannot = "The photo cannot be fetched right now. The typed details are still here; try the photo again in a few minutes.";
    server({
      [DESK]: () => view(),
      [`${DESK}/id-photos/photo-1`]: () => { throw new apiModule.ApiError(503, cannot); },
    });
    openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Show the photo" }));
    expect(await screen.findByText(cannot)).toBeTruthy();
    expect(screen.getByText("P1234567"), "the typed details are still there").toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm against the ID" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says ID photos are off where the hotel has no password, and offers none", async () => {
    const off = "ID photos are off for this hotel: its password, or the photo store, is not in the server's settings.";
    server({ [DESK]: () => view({ idPhotos: { on: false, off, keeper: false } }) });
    openDesk();
    expect(await screen.findByText(off)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the photo" })).toBeNull();
  });

  it("shows the kept photos only to a keeper, with Try again where Drive has not deleted one", async () => {
    server({ [DESK]: () => view() });
    openDesk();
    await screen.findByRole("button", { name: "Show the photo" });
    expect(screen.queryByRole("heading", { name: "ID photos kept" }), "reception is not shown the list").toBeNull();
    cleanup();

    const KEPT = `${DESK}/id-photos`;
    const REMOVE = `${DESK}/id-photos/kept-2/remove`;
    const spy = server({
      [DESK]: () => view({ waiting: [], idPhotos: { on: true, off: null, keeper: true } }),
      [KEPT]: () => ({ photos: [
        { id: "kept-1", guest: "B. Guest", reference: "FH-2609-5002", sides: ["front"], at: "2026-08-25T10:00:00Z", addedBy: "Desk Clerk", notYetDeleted: false },
        { id: "kept-2", guest: "C. Guest", reference: "FH-2609-5003", sides: ["front"], at: "2026-08-25T11:00:00Z", addedBy: null, notYetDeleted: true },
      ] }),
      [REMOVE]: () => ({ removed: true, deletedFromDrive: true }),
    });
    openDesk();
    expect(await screen.findByRole("heading", { name: "ID photos kept" })).toBeTruthy();
    expect(await screen.findByText(/added by Desk Clerk/)).toBeTruthy();
    expect(screen.getByText(/sent by the guest/)).toBeTruthy();
    expect(screen.getByText("Removed here, but not yet deleted from Drive.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Show the photo" }), "only the one still kept").toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(spy.mock.calls.map((c) => c[0])).toContain(REMOVE));
  });

  it("asks a keeper why before deleting a kept photo", async () => {
    const REMOVE = `${DESK}/id-photos/kept-1/remove`;
    const spy = server({
      [DESK]: () => view({ waiting: [], idPhotos: { on: true, off: null, keeper: true } }),
      [`${DESK}/id-photos`]: () => ({ photos: [
        { id: "kept-1", guest: "B. Guest", reference: "FH-2609-5002", sides: ["front"], at: "2026-08-25T10:00:00Z", addedBy: null, notYetDeleted: false },
      ] }),
      [REMOVE]: () => ({ removed: true, deletedFromDrive: true }),
    });
    openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the photo" }));
    const confirm = screen.getAllByRole("button", { name: "Delete the photo" }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled, "no reason, no delete").toBe(true);
    fireEvent.change(screen.getByLabelText("Why"), { target: { value: "The guest asked for it to be deleted" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === REMOVE)?.[1]?.body)
      .toBe(JSON.stringify({ reason: "The guest asked for it to be deleted" })));
  });
});

describe("the desk adds a photo at check-in (D27-210)", () => {
  const DESK = "/api/hotels/5EL/online-checkin";
  const openAt = () => open("/h/5EL/stays", "/h/:code/stays", <AddIdPhotoAtDesk stayId="stay-1" />);
  const desk = (idPhotos: unknown) => ({ [DESK]: () => ({ waiting: [], requests: [], rooms: [], idPhotos }) });

  it("says the Aadhaar rule, needs the guest's yes, and sends to the stay's own route", async () => {
    signedIn();   // reception
    const sent = uploads();
    server(desk({ on: true, off: null, keeper: false }));
    openAt();

    expect(await screen.findByText(/cover the first 8 digits before you take the photo/)).toBeTruthy();
    const front = screen.getByLabelText("Front of the ID") as HTMLInputElement;
    expect(front.getAttribute("capture"), "the clerk photographs the ID in their hand").toBe("environment");
    const button = screen.getByRole("button", { name: "Add the photo" }) as HTMLButtonElement;
    choose("Front of the ID", aPhoto());
    choose("Back, if it has one", aPhoto("IMG_0002.jpg"));
    expect(button.disabled, "not without the guest's yes").toBe(true);
    fireEvent.click(screen.getByLabelText("The guest agreed to the hotel keeping this photo"));
    fireEvent.click(button);

    expect(await screen.findByText(/Added. It is kept, encrypted, for the owner/)).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/hotels/5EL/stays/stay-1/id-photo");
    expect(sent[0]!.form.get("agreed")).toBe("yes");
    expect(sent[0]!.form.get("back")).toBeInstanceOf(Blob);
    expect(document.querySelector("[data-add-id-photo] img"), "it is not fetched back").toBeNull();
  });

  it("says ID photos are off, in the server's words, where the hotel has no password", async () => {
    signedIn();
    const off = "ID photos are off for this hotel: its password, or the photo store, is not in the server's settings.";
    server(desk({ on: false, off, keeper: false }));
    openAt();
    expect(await screen.findByText(off)).toBeTruthy();
    expect(screen.queryByLabelText("Front of the ID")).toBeNull();
  });

  it("draws nothing, and asks nothing, for a role that is not the desk's", async () => {
    signedIn({ scope: {
      staffId: "33333333-3333-3333-3333-333333333333", email: "hk@fidato.in", fullName: "HK",
      isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }],
    } });
    const spy = server({});
    const { container } = render(<div />);
    openAt();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("[data-add-id-photo]")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });
});
