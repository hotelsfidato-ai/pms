import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { navigationFor } from "@/components/app/navigation";

/* ══════════════════════════════════════════════════════════════════
   THE BOOK IS KEPT CURRENT (the owner's D27-293)

   "Make it like a book, and it needs to be updated." A change to a screen
   updates its chapter in the same commit (AGENTS.md, CLAUDE.md); this is the
   check that stops the gates when that is forgotten:

   1. Every menu screen in the part of the menu a WRITTEN chapter covers is
      named in that chapter. A chapter covers its whole part, so a new screen
      added to the restaurant's menu fails here until A8 says what it is.
      As each chapter is written, its part joins COVERS.
   2. docs/manual/manual.html is the chapters as they are: built by
      docs/manual/tools/build.mjs, never edited by hand.
   3. Every picture a chapter shows is in docs/manual/img.
   ══════════════════════════════════════════════════════════════════ */

const MANUAL = join(__dirname, "..", "..", "docs", "manual");

/** The menu's sections (navigation.ts keys) and the chapter that covers each. */
const COVERS: Record<string, string> = {
  "home": "a1",
  /* A1.10 names all nine and says which chapter holds each (A3, Check-in, is not
     written yet; Walk-ins and Online check-in are described in A1.10 itself). */
  "front-desk": "a1",
  "bookings": "a2",
  "guests-crm": "a10",
  "sales-marketing": "a14",
  "across-properties": "a16",
  "configuration": "a2",
  "inventory": "a15",
  "distribution": "a15",
  "store-and-equipment": "a9",
  "finance": "a4",
  "point-of-sale": "a8",
  "banquet": "a13",
  "laundry": "a13",
  "spa": "a13",
  "reports": "a11",
  "system": "a12",
  "settings-property": "a17",
  "settings-rooms": "a17",
  "settings-rates": "a17",
  "settings-money": "a17",
  "settings-lists": "a17",
  "settings-front-desk": "a17",
  "settings-messages": "a17",
  "settings-people": "a17",
  "settings-connections": "a17",
};

const chapter = (file: string) => {
  const path = join(MANUAL, "chapters", `${file}.html`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the manual is kept current (D27-293)", () => {
  it("names every menu screen of each part a written chapter covers", () => {
    const sections = navigationFor("owner", "5EL");
    const missing: string[] = [];
    for (const [key, file] of Object.entries(COVERS)) {
      const html = chapter(file);
      expect(html, `chapters/${file}.html covers ${key} but is not there`).not.toBeNull();
      const section = sections.find((s) => s.key === key);
      expect(section, `no menu section ${key}`).toBeTruthy();
      const words = text(html!);
      for (const item of section!.items) {
        if (!words.includes(item.label)) missing.push(`${item.label} (${key}) is not in chapters/${file}.html`);
      }
    }
    expect(missing, "a menu screen with no word in its chapter - write it in, then build").toEqual([]);
  });

  it("manual.html is built from the chapters as they are", () => {
    /* Throws (exit 1) with the reason when it is out of date. */
    const out = execFileSync(process.execPath, [join(MANUAL, "tools", "build.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
  });

  it("every picture a chapter shows is in docs/manual/img", () => {
    const files = new Set(readdirSync(join(MANUAL, "img")));
    const missing = readdirSync(join(MANUAL, "chapters"))
      .flatMap((f) => [...readFileSync(join(MANUAL, "chapters", f), "utf8").matchAll(/src="img\/([^"]+)"/g)]
        .map((m) => m[1]!).filter((img) => !files.has(img)).map((img) => `${f}: img/${img}`));
    expect(missing).toEqual([]);
  });
});
