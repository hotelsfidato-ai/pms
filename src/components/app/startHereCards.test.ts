import { it, expect } from "vitest";
import { START_HERE } from "./startHereCards";

/* The owner's D27-314 (3): the card names the button the screen has. New
   booking's button says "Save booking" (D27-163); "Confirm the booking" is
   the waiting booking's action, not this one. */
it("reception's card ends a booking with New booking's own button, Save booking", () => {
  const book = START_HERE.front_desk!.tasks.find((t) => t.job === "Take a booking")!;
  expect(book.how).toBe("Fill in the guest and the nights, then Save booking.");
});
