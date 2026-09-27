import { MessageCircle } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Leads and WhatsApp — not built. Its page sits under Sales and marketing,
   marked "Not built yet" (D27-87), for the owner, admins and general managers
   only. Assembled by `navigation.ts`. When the service is built its real
   screens take its place and the mark goes. */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 10, notBuilt: true,
    label: "Leads and WhatsApp", to: "/coming-soon/leads", icon: MessageCircle, resource: "integration",
    canSee: seesComingSoon, keywords: ["enquiries", "whatsapp", "meta ads", "inbox", "follow-up", "sales"] },
];
