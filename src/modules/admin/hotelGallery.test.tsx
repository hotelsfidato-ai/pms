import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { HotelGalleryCard } from "./components/HotelGalleryCard";

/* The hotel's photos on Settings → Property (the owner's D27-243): the
   owner, an administrator or the GM adds, captions, orders and deletes;
   everybody else who opens Settings sees them. Each is drawn from the
   bytes the server kept, as an <img>. */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const sent: { path: string; method: string; body: unknown }[] = [];

function serve(photos: { id: string; caption: string | null }[]) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, id: "new" } as never;
    }
    if (path === "/api/hotels/AGR/gallery") {
      return { photos: photos.map((p) => ({ ...p, width: 1600, height: 1067 })), most: 20 } as never;
    }
    const one = /\/gallery\/([^/]+)$/.exec(path);
    if (one) return { type: "image/jpeg", data: btoa(`picture ${one[1]}`) } as never;
    return new Promise(() => {}) as never;
  });
}

function as(role: Role) {
  signedIn({ scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <HotelGalleryCard hotelCode="AGR" />
  </QueryClientProvider>,
);

beforeEach(() => { sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the hotel's photos on Settings", () => {
  it("shows each photo from the server's bytes, with its caption and the count", async () => {
    as("gm");
    serve([{ id: A, caption: "The pool at dusk" }, { id: B, caption: null }]);
    show();
    const pool = await screen.findByRole("img", { name: "The pool at dusk" });
    await waitFor(() => expect(pool.getAttribute("src")).toBe(`data:image/jpeg;base64,${btoa(`picture ${A}`)}`));
    expect(screen.getByRole("img", { name: "Photo 2" })).toBeTruthy();
    expect(screen.getByText("2 of 20 photos")).toBeTruthy();
  });

  it("adds a picked photo as a JPEG's bytes", async () => {
    as("gm");
    serve([]);
    show();
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
    const file = new File(["a picture"], "pool.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose photos to add"), { target: { files: [file] } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ path: "/api/hotels/AGR/gallery", method: "POST", body: { data: btoa("a picture") } });
  });

  it("moves, captions and - once asked again - deletes", async () => {
    as("gm");
    serve([{ id: A, caption: "The pool at dusk" }, { id: B, caption: null }]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Move photo 2 earlier" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: "/api/hotels/AGR/gallery/order", method: "PUT", body: { ids: [B, A] } }));

    fireEvent.change(screen.getByLabelText("Caption for photo 2"), { target: { value: "Rooftop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save caption for photo 2" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/AGR/gallery/${B}`, method: "PATCH", body: { caption: "Rooftop" } }));

    fireEvent.click(screen.getByRole("button", { name: "Delete photo 1" }));
    expect(sent.some((s) => s.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete photo 1" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/AGR/gallery/${A}`, method: "DELETE", body: undefined }));
  });

  it("shows reception the photos and nothing to change them with", async () => {
    as("front_desk");
    serve([{ id: A, caption: "The pool at dusk" }]);
    show();
    expect(await screen.findByRole("img", { name: "The pool at dusk" })).toBeTruthy();
    expect(screen.getByText("The pool at dusk")).toBeTruthy();
    expect(screen.queryByLabelText("Choose photos to add")).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete|Move|Save caption/ })).toBeNull();
  });
});
