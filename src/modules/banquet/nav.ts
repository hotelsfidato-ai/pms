import { PartyPopper, Building2 } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Banquet's menu entries — absent at a property with no hall (the
   section's module gate in `navigation.ts`). */
export const nav: ServiceNavEntry[] = [
  /* The diary first, because the question is almost always "is the
     hall free" and only then "what is booked". */
  { section: "banquet", order: 10,
    label: "Diary", to: "/h/:code/banquet", icon: PartyPopper, resource: "reservation",
    keywords: ["banquet", "function", "wedding", "event"] },
  { section: "banquet", order: 20,
    label: "Halls and packages", to: "/h/:code/banquet/setup", icon: Building2, resource: "room_config" },
];
