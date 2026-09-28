import { CreditCard } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Online payments — not built. Its page sits at the foot of Finance, marked
   "Not built yet" (D27-87), for the owner, admins and general managers only.
   Assembled by `navigation.ts`. When the service is built its real screens
   take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "finance", order: 90, notBuilt: true,
    label: "Online payments", to: "/coming-soon/payments", icon: CreditCard, resource: "integration",
    canSee: seesComingSoon, keywords: ["payment gateway", "razorpay", "upi link", "deposit", "refund"] },
];
