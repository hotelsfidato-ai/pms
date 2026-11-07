import { MessageSquareHeart, Star } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { FEEDBACK_ROLES } from "../../../api/src/modules/reputation/feedbackRoles.ts";

/* Reviews — BUILT, 19 September (D18-14). Its entry left the Coming soon
   section and took its place in "Front desk", beside Arrivals, In house and
   Walk-ins: it is a list of DEPARTURES and something the desk does with one,
   not a report somebody reads.

   WHO SEES IT is `resource: "customer"` - the Guests permission - and that is
   the owner's answer of 19 September, asked with a recommendation. It widens
   NOBODY: the owner, an administrator, the general manager, the hotel manager,
   reception, the accountant and a viewer can already open the Guests screen
   and read the same names, numbers and stays. A resource of its own would have
   meant a new column in `src/lib/permissions.ts`, which is the master's file
   and the owner's decision, to say something the matrix already says.

   Who may ASK, as opposed to LOOK, is a different question with a different
   answer, and it is asked of the server rather than of a menu: the accountant
   and a viewer hold `customer: view` and not `customer: create`, so they read
   the list and send nothing. Who may set the LINK is narrower again - the
   owner and an administrator.

   NOT IN RECEPTION'S WORKING MENU (`workingMenus` absent). The owner's shorter
   menu is the eight screens a clerk uses in a shift; asking for a review is
   not one of them, and nothing is lost because Find a screen still reaches it
   under the words somebody would type. */
/* 21 September: moved from Front desk to Guests & CRM, with what else the
   system knows about a guest (the owner's decision). Same resource. */
export const nav: ServiceNavEntry[] = [
  { section: "guests-crm", order: 40,
    label: "Reviews", to: "/h/:code/reviews", icon: Star, resource: "customer",
    keywords: ["reputation", "google reviews", "tripadvisor", "feedback", "ratings", "review link"] },
  /* D27-383 item 10: what guests answered after check-out - for the owner, an
     administrator and the GM, the server's own list (feedbackRoles.ts). */
  { section: "guests-crm", order: 45,
    label: "Guest feedback", to: "/h/:code/feedback", icon: MessageSquareHeart, resource: "customer",
    canSee: (role) => FEEDBACK_ROLES.includes(role),
    keywords: ["survey", "feedback survey", "guest scores", "comments", "satisfaction"] },
];
