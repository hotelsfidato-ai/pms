import { MessageCircle } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Leads and WhatsApp - BUILT 29 September (D27-168, D27-170): the leads
   app's enquiries, read live, under Sales and marketing.

   WHO SEES IT is `resource: "customer"`, the Guests permission (D27-170:
   everyone who sees guests sees leads). It widens nobody: the same people
   already open Guests and read the same kind of names and numbers.

   In nobody's working menu (`workingMenus` absent): staff work leads in the
   leads app itself; here it is a view. Find a screen reaches it. */
export const nav: ServiceNavEntry[] = [
  { section: "sales-marketing", order: 10,
    label: "Leads and WhatsApp", to: "/h/:code/leads", icon: MessageCircle, resource: "customer",
    keywords: ["enquiries", "whatsapp", "meta ads", "inbox", "follow-up", "sales", "leads"] },
];
