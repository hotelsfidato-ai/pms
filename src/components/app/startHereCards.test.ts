import { it, expect } from "vitest";
import { START_HERE, START_HERE_ON } from "./startHereCards";

/* The owner's D27-314 (3): the card names the button the screen has. New
   booking's button says "Save booking" (D27-163); "Confirm the booking" is
   the waiting booking's action, not this one. */
it("reception's card ends a booking with New booking's own button, Save booking", () => {
  const book = START_HERE.front_desk!.tasks.find((t) => t.job === "Take a booking")!;
  expect(book.how).toBe("Fill in the guest and the nights, then Save booking.");
});

/* The owner's D27-329 (3): the Bar person gets the Start here card the
   waiter has, on the same screens - the same jobs and buttons; their
   orders go to the bar, so the second job says so. */
it("gives the Bar the waiter's card, on the waiter's screens", () => {
  const bar = START_HERE.bar!;
  const waiter = START_HERE.pos!;
  expect(bar.intro).toBe(waiter.intro);
  expect(bar.tasks.map((t) => [t.to, t.how])).toEqual(waiter.tasks.map((t) => [t.to, t.how]));
  expect(bar.tasks.map((t) => t.job)).toEqual(["Open a table", "Send an order to the bar", "Settle a bill"]);
  expect(START_HERE_ON.bar).toEqual(START_HERE_ON.pos);
});
