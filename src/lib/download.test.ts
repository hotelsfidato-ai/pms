import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadFile, filenameFrom, ApiError } from "./api";

/* src/test/setup.ts stands a stub in for the whole API client; this file tests the real one. */
vi.unmock("@/lib/api");

/* ══════════════════════════════════════════════════════════════════
   A FILE FROM THE API - downloadFile (src/lib/api.ts)

   Reports as PDF, .xlsx and CSV are fetched with the sign-in and saved
   under the name the server gives. A refusal or a dead line is an error
   with a sentence, and nothing is saved.
   ══════════════════════════════════════════════════════════════════ */

const PATH = "/api/hotels/5EL/reports/monthly-statistics.csv?month=2026-08";
let calls: Array<{ url: string; init?: RequestInit }>;
let click: ReturnType<typeof vi.spyOn>;

function answer(file: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/config.json") return new Response("", { status: 404 });
    calls.push({ url, init });
    return file();
  });
}

beforeEach(() => {
  calls = [];
  URL.createObjectURL = vi.fn(() => "blob:report");
  URL.revokeObjectURL = vi.fn();
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloading a file", () => {
  it("reads the name the server gave", () => {
    expect(filenameFrom('attachment; filename="5EL-monthly-statistics-2026-08.pdf"'))
      .toBe("5EL-monthly-statistics-2026-08.pdf");
    expect(filenameFrom(null)).toBeNull();
  });

  it("saves the file under that name, fetched without a JSON content type", async () => {
    let saved = "";
    click.mockImplementation(function (this: HTMLAnchorElement) { saved = this.download; });
    answer(() => new Response("Monthly Statistics\r\n", {
      status: 200,
      headers: { "content-disposition": 'attachment; filename="5EL-monthly-statistics-2026-08.csv"' },
    }));
    await expect(downloadFile(PATH)).resolves.toBe("5EL-monthly-statistics-2026-08.csv");
    expect(saved).toBe("5EL-monthly-statistics-2026-08.csv");
    expect(calls[0]!.url.endsWith(PATH)).toBe(true);
    expect((calls[0]!.init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("gives the server's sentence when it refuses, and saves nothing", async () => {
    answer(() => new Response(JSON.stringify({ error: "Downloading reports is for the owner." }), { status: 403 }));
    const failure = await downloadFile(PATH).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).message).toBe("Downloading reports is for the owner.");
    expect(click).not.toHaveBeenCalled();
  });

  it("says so when the server cannot be reached, and saves nothing", async () => {
    answer(() => { throw new TypeError("Failed to fetch"); });
    const failure = await downloadFile(PATH).catch((e: unknown) => e);
    expect((failure as ApiError).status).toBe(0);
    expect((failure as ApiError).message).toContain("the file was not downloaded");
    expect(click).not.toHaveBeenCalled();
  });
});
