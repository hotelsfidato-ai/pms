import { CalendarCheck, CalendarRange, Users, BookOpen, Home } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Front desk's menu entries. Where each sits, and who works from it, is
   declared here; `navigation.ts` assembles every service's entries into the
   one menu. The words and the order are the owner's (clarity plan, 15 Sep). */
export const nav: ServiceNavEntry[] = [
  /* Housekeeping's too: the owner's D22-19, 22 September. */
  { section: "home", order: 20, workingMenus: ["front_desk", "housekeeping"],
    label: "Rooms", to: "/h/:code/stay", icon: Home, resource: "dashboard",
    keywords: ["house", "board", "tape chart", "vacant", "empty", "free"] },
  { section: "home", order: 30, workingMenus: ["front_desk"],
    label: "Calendar", to: "/h/:code/calendar", icon: CalendarRange, resource: "reservation",
    keywords: ["tape chart", "stay view", "fortnight"] },
  {
    section: "front-desk", order: 10, workingMenus: ["front_desk"],
    label: "Arrivals", to: "/h/:code/arrivals", icon: CalendarCheck,
    resource: "reservation",
    keywords: ["arriving", "check in", "coming"], matchPrefix: true,
    children: [
      { label: "Today", to: "/h/:code/arrivals", icon: CalendarCheck, resource: "reservation" },
      { workingMenus: ["front_desk"],
        label: "Upcoming", to: "/h/:code/arrivals/upcoming", icon: CalendarRange, resource: "reservation" },
    ],
  },
  {
    section: "front-desk", order: 20, workingMenus: ["front_desk"],
    label: "In house", to: "/h/:code/in-house", icon: Users,
    resource: "reservation",
    keywords: ["occupied", "staying", "current stays"], matchPrefix: true,
    children: [
      { label: "In house now", to: "/h/:code/in-house", icon: Users, resource: "reservation" },
      { workingMenus: ["front_desk"],
        label: "Due out", to: "/h/:code/in-house/due-out", icon: CalendarRange, resource: "reservation" },
    ],
  },
  { section: "front-desk", order: 30, workingMenus: ["front_desk"],
    label: "Walk-ins", to: "/h/:code/walk-ins", icon: BookOpen, resource: "reservation",
    keywords: ["walk in", "walkin"] },
];
