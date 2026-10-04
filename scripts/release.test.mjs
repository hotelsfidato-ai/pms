import { it, expect } from "vitest";
import { copyName, gatesRefusal, firebaseSettings } from "./release.mjs";

/* The pure parts of scripts/release.mjs: the release copy's folder, the
   reading of .local/gates/progress.txt, and the .env lines it copies. */

const C = "6f12b0e4" + "a".repeat(32);
const steps = (codes) =>
  ["web types", "api types", "strip", "web tests", "api tests", "database", "replay", "pg16"]
    .map((s, i) => `  ${s.padEnd(10)} exit ${codes[i] ?? 0}  ${i}s`).join("\n");

it("names the release copy after the branch", () => {
  expect(copyName("release/all-4oct")).toBe("release-all-4oct");
  expect(copyName("release/x/y")).toBe("release-x-y");
});

it("accepts only a full, clean, green, finished run on exactly this commit", () => {
  expect(gatesRefusal(`commit ${C} full\n${steps([])}\n`, C)).toBeNull();
  expect(gatesRefusal(`commit ${C} full\r\n${steps([]).replaceAll("\n", "\r\n")}`, C)).toBeNull();

  // progress.txt from before gates.sh recorded the commit (the 4 Oct file)
  expect(gatesRefusal(steps([]), C)).toMatch(/records no commit/);
  expect(gatesRefusal(`commit ${"b".repeat(40)} full\n${steps([])}`, C)).toMatch(/not on 6f12b0e4/);
  expect(gatesRefusal(`commit ${C} quick\n${steps([])}`, C)).toMatch(/quick run/);
  expect(gatesRefusal(`commit ${C} full dirty\n${steps([])}`, C)).toMatch(/uncommitted/);
  expect(gatesRefusal(`commit ${C} full\n${steps([0, 0, 0, 0, 1])}`, C)).toBe("is red: api tests");
  // a run still in flight has only its first steps
  expect(gatesRefusal(`commit ${C} full\n${steps([]).split("\n").slice(0, 4).join("\n")}`, C))
    .toBe("has not finished: no api tests, database, replay, pg16 yet");
});

it("takes only the VITE_FIREBASE_ lines of a .env, quotes off the values", () => {
  const fb = firebaseSettings("VITE_FIREBASE_API_KEY=\"k1\"\nVITE_ALLOW_DEV_AUTH=1\r\nVITE_FIREBASE_PROJECT_ID=p1\nVITE_API_URL=x\n");
  expect(fb.lines).toEqual(['VITE_FIREBASE_API_KEY="k1"', "VITE_FIREBASE_PROJECT_ID=p1"]);
  expect(fb.value("VITE_FIREBASE_API_KEY")).toBe("k1");
  expect(fb.value("VITE_FIREBASE_PROJECT_ID")).toBe("p1");
  expect(fb.value("VITE_FIREBASE_APP_ID")).toBe("");
});
