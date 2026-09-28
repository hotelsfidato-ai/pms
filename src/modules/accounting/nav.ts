import { Calculator } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";

/* Accounting export - BUILT, 19 September (D18-16). Until then this was a
   Coming soon page, and its entry sat in the section at the foot of the menu;
   a service that is built cannot also be coming soon, so it takes its place
   beside the reports it is made of. `navigation.test.ts`'s SOON list loses
   "Accounting export" in the same change, exactly as it lost "Purchasing"
   when that service landed on 18 September. */

/** The owner, an administrator and the general manager - the brief's line
    on who may hand the hotel's month to an accountant.

    NO NEW RESOURCE WAS INVENTED to say it. `report` is the resource this
    screen is about and those three already hold it; so do the hotel
    manager, the revenue manager and finance, which is wider than the
    owner asked for, so `canSee` narrows the entry to the three. Widening
    that is the owner's to do in `src/lib/permissions.ts` - the master's
    file - and not a side effect of adding a screen. The server refuses
    the other three as well (api/src/modules/accounting/routes.ts): a
    hidden menu entry has never been a permission. */
/* 28 September (D27-122): and the accountant, who the export is for. */
const EXPORTS_THE_BOOKS = (role: Role): boolean =>
  role === "owner" || role === "admin" || role === "gm" || role === "finance";

export const nav: ServiceNavEntry[] = [
  /* `listed: false`, like most of the Reports section: reachable by its
     address and by "Find a screen", not pinned into anybody's shortened
     menu. Those lists are the owner's own, chosen on 15 September, and
     adding to one is their call rather than this chat's.

     Order 140: the foot of the section, after the last report. 80 was
     taken by Yearly statistics and `navigation.test.ts` refused the
     clash - correctly, because two entries on one number order
     themselves by whichever service happens to be spread first. */
  { section: "reports", order: 140,
    label: "Accounting export", to: "/reports/accounting", icon: Calculator,
    resource: "report", canSee: EXPORTS_THE_BOOKS, listed: false,
    keywords: ["tally", "accounts", "ledger", "export", "accountant", "day book", "gst"] },
];
