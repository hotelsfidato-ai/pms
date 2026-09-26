import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRole, useSession } from "./session";
import { useUi } from "./ui";
import type { ApiHotel } from "./api";

/* POS-18 (D26-13): the role is the one at the property IN VIEW — the code in
   the address — as the server asks it, not the property chosen at sign-in. */
describe("useRole", () => {
  it("reads the role at the property in the address", () => {
    const hotel = (id: string, code: string) => ({ id, code, name: code } as ApiHotel);
    useSession.setState({
      hotels: [hotel("h-a", "AAA"), hotel("h-b", "BBB")],
      hotelId: "h-a",
      scope: {
        staffId: "s1", email: "x@test", fullName: "X", isGroupAdmin: false,
        hotels: [{ hotelId: "h-a", role: "front_desk" }, { hotelId: "h-b", role: "pos" }],
      },
    });

    useUi.setState({ hotelId: "BBB" });
    expect(renderHook(() => useRole()).result.current).toBe("pos");

    useUi.setState({ hotelId: "AAA" });
    expect(renderHook(() => useRole()).result.current).toBe("front_desk");
  });
});
