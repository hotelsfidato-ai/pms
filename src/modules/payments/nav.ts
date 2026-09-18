import { CreditCard } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Online payments — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 150,
    label: "Online payments", to: "/coming-soon/payments", icon: CreditCard, resource: "integration",
    canSee: seesComingSoon, keywords: ["payment gateway", "razorpay", "upi link", "deposit", "refund"] },
];
