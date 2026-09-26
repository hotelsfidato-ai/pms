import { describe, it, expect } from "vitest";
import { mayReach } from "@/components/app/navigation";
import { ROLES } from "@/lib/permissions";

/* D25-38 (the owner, 25 September): guests' passport, visa and ID details
   are for the people who check guests in - the owner, an administrator, the
   GM, the hotel manager and reception. The server refuses everybody else
   (api/src/roleGate.ts, READ_RULES); the menu, the route guard and the
   reports list, which all ask `mayReach`, must not offer them the door. */
describe("the two screens that show passport numbers", () => {
  it("are reachable by the check-in roles only", () => {
    for (const path of ["/h/:code/form-c", "/reports/c-form"]) {
      expect(ROLES.filter((role) => mayReach(role, path)), path)
        .toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk"]);
    }
  });
});
