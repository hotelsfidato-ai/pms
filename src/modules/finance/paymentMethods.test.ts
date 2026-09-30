import { describe, it, expect } from "vitest";
import { PAYMENT_METHODS } from "@/lib/rules";
import { PAYMENT_METHOD } from "../../../api/src/modules/finance/paymentMethods.ts";

/* THE SCREENS OFFER ONLY WHAT THE SERVER TAKES (the owner, 30 September).
   New booking's advance, the bill's Settle and a function's bill all draw
   their "Paid by" list from PAYMENT_METHODS. It listed "Google Pay", which
   the server's payment door has never known: the booking saved and the
   advance was refused - "'Google Pay' is not a payment method". Both lists
   are read here, the real ones, so they cannot drift again. */
describe("the payment methods the screens offer", () => {
  it("are every one a method the server's payment door takes", () => {
    const refused = PAYMENT_METHODS.filter((m) => !(m in PAYMENT_METHOD));
    expect(refused, "offered on a screen, refused by the server").toEqual([]);
  });
});
