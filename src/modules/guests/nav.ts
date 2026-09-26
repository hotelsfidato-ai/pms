import { Users, Building2, Plug, ShieldAlert } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { can } from "@/lib/permissions";

/* Guests and companies — entries in three sections (Guests & CRM,
   Configuration, Finance). Assembled by `navigation.ts`. Guests and
   Companies and agents moved from Bookings to Guests & CRM on 21 September
   (the owner's decision). */
export const nav: ServiceNavEntry[] = [
  { section: "guests-crm", order: 10, workingMenus: ["front_desk"],
    label: "Guests", to: "/guests", icon: Users, resource: "customer", matchPrefix: true },
  /* ⚠ THIS SAID "BOOKING SOURCES" AND THERE ARE NOW TWO OF THOSE.
     It was renamed from "Companies" for a good reason at the time —
     somebody looking for their OTA performance read "Companies" and
     went past it, because no screen answered that question. One does
     now, under Configuration, and two identical labels meaning two
     different things is worse than the problem the rename solved.

     "Companies and agents" is what the rows actually are, and it is
     the same vocabulary as the booking form's Business source field.
     Found by auditing the navigation against itself on 9 September;
     I introduced the collision the day before and did not look. */
  { section: "guests-crm", order: 20,
    label: "Companies and agents", to: "/companies", icon: Building2, resource: "company",
    keywords: ["travel agent", "corporate", "ota"], matchPrefix: true },
  /* `commission` rather than `rate`: the list is where a booking
     came from and the screen is where its commission is agreed.
     A clerk does not see it — they pick from the list on the
     booking form, which is not gated here. */
  { section: "configuration", order: 40,
    label: "Booking sources", to: "/h/:code/booking-sources", icon: Plug, resource: "commission",
    keywords: ["channel", "ota", "commission", "source"] },
  /* Form C is a COMPLIANCE obligation about guests, not a finance
     document — but it is filed by the same person who bills, at the
     same desk, and burying it under Reports is how a 24-hour
     deadline gets missed. It sits where somebody will see it.
     D25-38: it shows passport numbers, so only the people who check guests in
     see it - who may record Form C, the server's own rule (roleGate GUEST_ID). */
  { section: "finance", order: 60,
    label: "Form C", to: "/h/:code/form-c", icon: ShieldAlert, resource: "customer",
    canSee: (role) => can(role, "edit", "customer"),
    keywords: ["foreign", "frro", "passport"] },
];
