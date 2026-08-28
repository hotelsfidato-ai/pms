import { describe, expect, it } from "vitest";
import { describeError } from "./States";

/* ══════════════════════════════════════════════════════════════════
   ERROR INTERPRETATION

   "Something went wrong. This is usually temporary." was shown for a
   missing Firestore index — which is permanent, and which Firestore
   tells you exactly how to fix. The old copy sent people to retry
   forever instead.
   ══════════════════════════════════════════════════════════════════ */

describe("describeError", () => {
  it("recognises a missing index and extracts the console link", () => {
    const result = describeError(
      new Error(
        "FirebaseError: The query requires an index. You can create it here: " +
          "https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc",
      ),
    );
    expect(result.title).toContain("index");
    expect(result.indexUrl).toBe(
      "https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc",
    );
  });

  it("recognises a permissions refusal and points at the fix", () => {
    const result = describeError(new Error("Missing or insufficient permissions."));
    expect(result.title).toContain("access");
    expect(result.message).toContain("role");
  });

  it("recognises being offline", () => {
    const result = describeError(new Error("Failed to get document because the client is offline"));
    expect(result.title).toContain("connection");
  });

  /* ⚠️ Falls back to the raw message rather than a reassuring one. An
     unrecognised error the reader can quote beats a tidy sentence. */
  it("passes an unknown error through verbatim", () => {
    expect(describeError(new Error("Some novel failure")).message).toBe("Some novel failure");
  });

  it("says nothing when there is no error", () => {
    expect(describeError(null)).toEqual({});
    expect(describeError(undefined)).toEqual({});
  });
});
