import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { GallerySection } from "./GallerySection";

/* The hotel's photos on the guest's page (D27-243): behind the code, its
   own section, each picture an <img> on the link's own address (as the logo
   is), and nothing at all when the hotel has none (rule 8). */

const TOKEN = "tok-123";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function serve(photos: { id: string; caption: string | null }[]) {
  vi.spyOn(apiModule, "apiBase").mockResolvedValue("https://api.example.test");
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    if (path === `/api/guest/${TOKEN}/gallery`) {
      return { photos: photos.map((p) => ({ ...p, width: 1600, height: 1067 })) } as never;
    }
    return new Promise(() => {}) as never;
  });
}

const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <GallerySection token={TOKEN} hotel="5 Elements Akkalkot" onUnlockGone={() => {}} />
  </QueryClientProvider>,
);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the hotel's photos on the guest's page", () => {
  it("shows each photo from the link's own address, lazily, with its caption", async () => {
    serve([{ id: A, caption: "The pool at dusk" }, { id: B, caption: null }]);
    show();
    expect(await screen.findByRole("heading", { name: "Photos of 5 Elements Akkalkot" })).toBeTruthy();
    const pool = await screen.findByRole("img", { name: "The pool at dusk" });
    expect(pool.getAttribute("src")).toBe(`https://api.example.test/api/guest/${TOKEN}/gallery/${A}`);
    expect(pool.getAttribute("loading")).toBe("lazy");
    expect(screen.getByText("The pool at dusk")).toBeTruthy();
    /* A photo with no caption is decorative: the heading says what it is. */
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(2));
  });

  it("draws nothing when the hotel has no photos", async () => {
    serve([]);
    const { container } = show();
    await waitFor(() => expect(apiModule.api).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });
});
