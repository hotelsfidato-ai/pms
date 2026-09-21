import { UserRoundSearch, Combine } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesGuest360 } from "./access";

/* Central CRM — its home is the "Guests & CRM" section (the owner, 21
   September, D21-79), after the guest list, companies and agents, guest
   messages and reviews. Built 21 September (docs/briefs/crm.md).

   `customer` is the resource both screens are about, and the owner, an
   administrator and the GM already hold it - so do reception and the hotel
   manager, which is wider than D21-4 allows, so `canSee` narrows each entry
   to the three. The server refuses the others too (people.ts), and so does
   the database under it: a hidden menu entry has never been a permission. */
export const nav: ServiceNavEntry[] = [
  { section: "guests-crm", order: 50,
    label: "Guest 360", to: "/crm/guests", icon: UserRoundSearch, resource: "customer",
    canSee: seesGuest360, matchPrefix: true,
    keywords: ["crm", "guest history", "blacklist", "customer", "stay history", "no offers"] },
  { section: "guests-crm", order: 60,
    label: "Possible same person", to: "/crm/same-person", icon: Combine, resource: "customer",
    canSee: seesGuest360,
    keywords: ["duplicate", "duplicates", "merge", "join", "same guest", "crm"] },
];
