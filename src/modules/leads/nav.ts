import { MessageCircle } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { seesComingSoon } from "@/lib/permissions";

/* Leads and WhatsApp — not built. Its Coming soon page sits in the section the owner
   chose on 16 September: one section at the foot of the menu, for the owner,
   admins and general managers only. Assembled by `navigation.ts`. When the
   service is built its real screens take their place in a working section. */
export const nav: ServiceNavEntry[] = [
  { section: "coming-soon", order: 110,
    label: "Leads and WhatsApp", to: "/coming-soon/leads", icon: MessageCircle, resource: "integration",
    canSee: seesComingSoon, keywords: ["enquiries", "whatsapp", "meta ads", "inbox", "follow-up", "sales"] },
];
